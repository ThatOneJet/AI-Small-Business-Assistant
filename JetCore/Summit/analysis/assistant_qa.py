"""assistant_qa.py — Summit's data-grounded Q&A brain.

Answers free-text questions about the business by combining the owner's ACTUAL
numbers (their uploaded data) with small-business best-practice knowledge. It's
intent-based: a question is matched to a topic, then answered from that topic's
data + a curated knowledge base — a "deeper dive" than the one-line optimizer.

Runs without any external model, so it always works. (The Assistant tab can still
use the local LLM for fully open-ended chat when Ollama is connected.)
"""
import re
import os
import json
import time
import random
import urllib.request
import urllib.error
from models import (get_db, SalesData, ExpenseData, InventoryData, ReviewData,
                    ShiftData, TransactionData, BusinessProfile)

# ── Local LLM (Ollama) — used as the reasoning engine when available ─────────
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("SUMMIT_LLM_MODEL", "qwen2.5:3b")
_llm_cache = {"ok": None, "ts": 0.0}

_SYSTEM = (
    "You are Summit's business advisor for small-business owners — a professional, trusted business "
    "partner. Answer the owner's message directly and specifically, like a sharp consultant.\n"
    "SCOPE & CONDUCT (strict):\n"
    "- You ONLY help with business, operations, and finance topics for this owner's company. If asked "
    "about anything unrelated (politics, religion, personal life, relationships, coding, general trivia, "
    "medical or legal advice, etc.), politely decline in ONE sentence and steer back to their business — "
    "do not answer the off-topic question.\n"
    "- Always stay professional and respectful. NEVER use profanity, slurs, insults, sexual content, or "
    "any offensive, discriminatory, or hateful language — even if the user asks for it, jokes, or tries "
    "to provoke you. If provoked, stay calm and redirect to how you can help their business.\n"
    "RULES:\n"
    "1. Be CONCISE — under 150 words total. Lead with the single most important, specific action in "
    "one sentence, then at most 2-3 more as short '- ' bullets.\n"
    "2. Plain text only. NO markdown headings (#), NO bold (**), no numbered section titles.\n"
    "3. Use the BUSINESS DATA as the ONLY source of truth for numbers, and refer to products by the "
    "exact names given. Never invent figures.\n"
    "4. Be concrete and quantified — name the product, the dollar amount, the %. Skip generic filler "
    "like 'analyze your demographics' or 'enhance your marketing'.\n"
    "5. ALWAYS end with exactly ONE specific follow-up question about their situation that would let "
    "you give sharper, more tailored advice — ask about their exact setup (supplier terms, their "
    "process, a specific product's cost, their timeline/goal), never a generic question. Phrase it so "
    "it's clear you'll go deeper once they answer. Put it on its own final line starting with 'To go deeper: '."
)


def _money(n):
    return "$" + format(float(n or 0), ",.2f")


# Safety net: scrub common profanity from model output (the system prompt is the
# primary guard; this catches slips so the assistant always reads professionally).
_PROFANITY = re.compile(
    r"\b(f+u+c+k+\w*|motherf\w+|s+h+i+t+\w*|b+i+t+c+h+\w*|assh\w+|c+u+n+t+\w*|"
    r"bastard\w*|dickhead\w*|douche\w*|jackass\w*)\b", re.I)


def _scrub(text):
    return _PROFANITY.sub("[—]", text or "")


# Off-topic guard: decline clearly non-business questions (unless a business word
# is also present, which would make it a legit business question).
_OFF_TOPIC = re.compile(
    r"\b(election|president|politic|republican|democrat|congress|religio|god|bible|quran|"
    r"jesus|allah|dating|girlfriend|boyfriend|horoscope|celebrity|nba|nfl|soccer|basketball|"
    r"football|baseball|meaning of life|tell me a joke|write me a poem|who will win|"
    r"your favorite|are you conscious|are you real)\b", re.I)
_BIZ_HINT = re.compile(
    r"\b(sale|revenue|cost|expense|price|pricing|margin|profit|inventory|stock|supplier|vendor|"
    r"customer|market|product|cash|labor|staff|hire|business|store|shop|order|resell|distribut|"
    r"produc|invoice|budget|tax|payroll|discount|brand|\bads?\b|advertis|competitor)\b", re.I)

_DECLINE = ("I'm your business advisor, so I'll keep us focused on running and growing your company. "
            "Happy to dig into your sales, costs, inventory, pricing, cash flow, hiring, or strategy — "
            "what would you like to work on?")


def _off_topic(q):
    return bool(_OFF_TOPIC.search(q or "")) and not _BIZ_HINT.search(q or "")


def _llm_ok():
    """Cached check (10s) for whether the configured Ollama model is reachable."""
    now = time.time()
    if _llm_cache["ok"] is not None and now - _llm_cache["ts"] < 10:
        return _llm_cache["ok"]
    ok = False
    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/tags")
        with urllib.request.urlopen(req, timeout=2) as r:
            data = json.loads(r.read().decode())
        ok = any(m.get("name", "").split(":")[0] == OLLAMA_MODEL.split(":")[0]
                 for m in data.get("models", []))
    except Exception:
        ok = False
    _llm_cache.update(ok=ok, ts=now)
    return ok


def _llm_chat(messages, timeout=90):
    """Call Ollama /api/chat with system prompt + message history. Returns text or None."""
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [{"role": "system", "content": _SYSTEM}] + messages,
        "stream": False,
        "keep_alive": "30m",   # keep the model warm so answers stay fast
        "options": {"temperature": 0.5, "num_ctx": 4096, "num_predict": 240},
    }).encode()
    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/chat", data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
        return (data.get("message", {}) or {}).get("content", "").strip() or None
    except Exception:
        return None


def _context(db, uid):
    """Compact, factual snapshot of the business — the grounding the LLM must use."""
    prof = db.query(BusinessProfile).filter_by(user_id=uid).first()
    inv = db.query(InventoryData).filter_by(user_id=uid).all()
    # SKU→name map so sales (often keyed by SKU) read as product names to the model.
    name_by_sku = {(i.sku or "").strip().upper(): i.product for i in inv if i.sku and i.product}
    def nm(x):
        return name_by_sku.get((x or "").strip().upper(), x or "?")
    lines = []
    if prof and (prof.industry or prof.name or prof.description):
        lines.append(f"Profile: name={prof.name or '-'}; industry={prof.industry or '-'}; "
                     f"goal={prof.goal or 'balance'}; notes={(prof.description or '-')[:300]}")
    sales = db.query(SalesData).filter_by(user_id=uid).all()
    if sales:
        tot = sum(s.revenue or 0 for s in sales)
        byp = {}
        for s in sales:
            byp[nm(s.item)] = byp.get(nm(s.item), 0) + (s.revenue or 0)
        top = sorted(byp.items(), key=lambda x: -x[1])[:3]
        orders = len(set(s.check_number for s in sales if s.check_number)) or len(sales)
        lines.append(f"Sales: {_money(tot)} over {orders} orders (avg {_money(tot/orders) if orders else '$0'}); "
                     f"top: {', '.join(f'{k}={_money(v)}' for k, v in top)}")
    exp = db.query(ExpenseData).filter_by(user_id=uid).all()
    if exp:
        tot = sum(e.amount or 0 for e in exp)
        byc = {}
        for e in exp:
            byc[e.category or "?"] = byc.get(e.category or "?", 0) + (e.amount or 0)
        top = sorted(byc.items(), key=lambda x: -x[1])[:4]
        lines.append(f"Expenses: {_money(tot)} total; by category: {', '.join(f'{k}={_money(v)}' for k, v in top)}")
    inv = db.query(InventoryData).filter_by(user_id=uid).all()
    if inv:
        val = sum((i.unit_cost or 0) * (i.stock_qty or 0) for i in inv)
        low = [i.product for i in inv if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) <= (i.reorder_level or 0)]
        def mg(i): return ((i.unit_price or 0) - (i.unit_cost or 0)) / (i.unit_price or 1) * 100
        items = ", ".join(f"{i.product}={mg(i):.0f}% (cost {_money(i.unit_cost)}, sells {_money(i.unit_price)}, qty {i.stock_qty:g})" for i in inv[:8])
        lines.append(f"Inventory: {_money(val)} at cost across {len(inv)} SKUs; low stock: {', '.join(low) or 'none'}; items: {items}")
    revs = db.query(ReviewData).filter_by(user_id=uid).all()
    if revs:
        lines.append(f"Reviews: {sum(r.rating or 0 for r in revs)/len(revs):.1f} stars avg over {len(revs)}")
    shifts = db.query(ShiftData).filter_by(user_id=uid).all()
    if shifts:
        lines.append(f"Labor: {sum(s.actual_hours or 0 for s in shifts):.0f} hrs, {_money(sum(s.labor_cost or 0 for s in shifts))}; "
                     f"{sum(1 for s in shifts if s.is_overtime)} OT shifts")
    txns = db.query(TransactionData).filter_by(user_id=uid).all()
    if txns:
        inflow = sum(t.amount for t in txns if t.is_deposit)
        outflow = sum(t.amount for t in txns if not t.is_deposit)
        lines.append(f"Cash: in {_money(inflow)}, out {_money(outflow)}, net {_money(inflow - outflow)}")
    return "\n".join(lines) if lines else "No business data uploaded yet."


def _llm_answer(db, uid, question, history):
    ctx = _context(db, uid)
    msgs = []
    for h in (history or [])[-6:]:
        role = "assistant" if h.get("role") == "ai" else "user"
        txt = (h.get("text") or "").strip()
        if txt:
            msgs.append({"role": role, "content": txt[:1500]})
    msgs.append({"role": "user",
                 "content": f"BUSINESS DATA (ground truth — use these numbers, don't invent):\n{ctx}\n\nQUESTION: {question}"})
    out = _llm_chat(msgs)
    return _scrub(out) if out else out


def answer(user_id, question, pending=None, history=None):
    db = get_db()
    try:
        q = (question or "").strip()
        # Guardrail: politely decline clearly off-topic questions, business-only.
        if _off_topic(q):
            return {"topic": "declined", "answer": _DECLINE, "pending": None}
        # Prefer the local LLM (real language understanding) when it's up; it reads
        # the whole message + history, grounded on the business data. Rule-based
        # engine below is the always-available fallback.
        if _llm_ok():
            out = _llm_answer(db, user_id, q, history)
            if out:
                return {"topic": "llm", "answer": out, "pending": None}
        return _answer(db, user_id, q, (pending or "") or None)
    finally:
        db.close()


# Topic intents: (topic, keyword-regex). First match wins; order = priority.
_INTENTS = [
    ("production",   r"produc(e|ing|tion)|manufactur|assembl|handmade|in.?house|contract manuf|factory|how.*(make|made)|\bmaking\b"),
    ("distribution", r"distribut|logistics|\bship|deliver|fulfil|\b3pl\b|warehouse|wholesale|retail|marketplace|channel|where.*sell|sell.*where"),
    ("sourcing",     r"sourc|supplier|procure|raw material|where.*buy.*material|find.*vendor"),
    ("expansion",    r"expand|new location|second (store|shop)|scale up|open.*(store|shop)|new market|franchis"),
    ("breakeven", r"break ?even|break-even|cover my costs|how much.*to make"),
    ("hiring",    r"\bhire|hiring|when.*hire|new employee|add staff|expand.*team|grow.*team"),
    ("pricing",   r"pric|charge|too cheap|too expensive|discount|markup|raise price"),
    ("margin",    r"margin|profit|markup|cogs|cost of goods|profitab"),
    ("marketing", r"market|advertis|\bads?\b|campaign|cac|acquisition|roi|promo"),
    ("inventory", r"invent|stock|reorder|restock|overstock|dead stock|sku|warehouse"),
    ("reviews",   r"review|rating|star|complaint|customer feedback|reputation|sentiment"),
    ("labor",     r"labor|labour|staff|employee|overtime|schedul|payroll|wage|hours"),
    ("cash",      r"cash|runway|liquid|bank|deposit|receivable|payable|burn"),
    ("expenses",  r"expens|cost|spend|overhead|bill|vendor|supplier|save money|cut cost|money going|where.*money|my money"),
    ("sales",     r"sale|revenue|best seller|top product|worst|product mix|aov|order value|grow"),
    ("focus",     r"what should i|focus|priorit|most important|biggest|where do i start|advice"),
]


# Consultative topics: ask about the situation first, then advise on the reply.
# (_DATA_FNS is defined at the bottom, after the topic functions it references.)
_CONSULT = {"production", "distribution", "sourcing", "expansion", "general"}


def _answer(db, uid, q, pending=None):
    ql = q.lower()
    if not ql:
        return {"topic": "help", "answer": _help(), "pending": None}

    prof = db.query(BusinessProfile).filter_by(user_id=uid).first()
    industry = ((prof.industry if prof else "") or "").strip().lower()

    topic = None
    for name, pat in _INTENTS:
        if re.search(pat, ql):
            topic = name
            break

    greeting = bool(re.match(r"\s*(hi|hey|hello|help|thanks|thank you|what can you|who are you)\b", ql))

    # If we asked the user for context last turn, treat this as their answer and
    # advise — unless they've clearly pivoted to a different, data-backed question.
    if pending and pending in _CONSULT:
        pivot = (topic in _DATA_FNS) or (topic in _CONSULT and topic != pending)
        if not pivot and not greeting:
            lines = _ADVISE[pending](q, prof, industry)
            return {"topic": pending, "answer": "\n".join(lines), "pending": None}

    # Data-backed topic → answer straight from their numbers.
    if topic in _DATA_FNS:
        return {"topic": topic, "answer": "\n".join(_DATA_FNS[topic](db, uid, industry)), "pending": None}

    # Consultative topic → ask situational questions first.
    if topic in _CONSULT:
        return {"topic": topic, "answer": _CLARIFY[topic], "pending": topic}

    if greeting or len(ql) < 4:
        return {"topic": "help", "answer": _help(), "pending": None}

    # Any other business question → gather context, then advise next turn.
    return {"topic": "general", "answer": _CLARIFY["general"], "pending": "general"}


def _need(label):
    return [f"You haven't uploaded {label} yet — import it on its tab and I can give you a real answer with your own numbers."]


# ── Topic answers ─────────────────────────────────────────────────────────────
def _sales(db, uid, industry):
    rows = db.query(SalesData).filter_by(user_id=uid).all()
    if not rows:
        return _need("sales")
    total = sum(r.revenue or 0 for r in rows)
    byp = {}
    for r in rows:
        byp[r.item or "Unknown"] = byp.get(r.item or "Unknown", 0) + (r.revenue or 0)
    ranked = sorted(byp.items(), key=lambda x: -x[1])
    orders = len(set(r.check_number for r in rows if r.check_number)) or len(rows)
    aov = total / orders if orders else 0
    top = ranked[0]
    out = [
        f"You've done {_money(total)} in revenue across {orders} orders (avg order {_money(aov)}).",
        f"Your top product is {top[0]} at {_money(top[1])} — {top[1]/total*100:.0f}% of revenue.",
    ]
    if len(ranked) > 2:
        out.append(f"Your weakest is {ranked[-1][0]} at {_money(ranked[-1][1])}.")
    out.append("To grow sales the fastest: (1) raise average order value with a bundle or a small add-on at checkout, "
               "(2) get repeat purchases via a follow-up email 2–3 weeks after the first order, and "
               "(3) put more weight behind the proven top seller rather than chasing new SKUs.")
    if len(ranked) > 3 and top[1] / total > 0.4:
        out.append(f"Heads-up: {top[0]} is over 40% of revenue — grow a second bestseller so you're not exposed if it stocks out.")
    return out


def _expenses(db, uid, industry):
    rows = db.query(ExpenseData).filter_by(user_id=uid).all()
    if not rows:
        return _need("expenses")
    total = sum(r.amount or 0 for r in rows)
    bycat = {}
    for r in rows:
        bycat[r.category or "Uncategorized"] = bycat.get(r.category or "Uncategorized", 0) + (r.amount or 0)
    ranked = sorted(bycat.items(), key=lambda x: -x[1])
    out = [f"You've spent {_money(total)} total. The breakdown by category:"]
    for c, a in ranked[:5]:
        out.append(f"  • {c}: {_money(a)} ({a/total*100:.0f}%)")
    out.append(f"Focus your cost-cutting on {ranked[0][0]} — it's your biggest line, so a 10–15% reduction there "
               f"(~{_money(ranked[0][1]*0.12)}) beats nickel-and-diming everything else.")
    out.append("Tactics that usually work: renegotiate your top 1–2 vendors (or get a competing quote), "
               "kill unused software subscriptions, and review anything recurring you haven't touched in 90 days.")
    return out


def _marketing(db, uid, industry):
    exp = db.query(ExpenseData).filter_by(user_id=uid).all()
    sales = db.query(SalesData).filter_by(user_id=uid).all()
    mk = sum(e.amount or 0 for e in exp if re.search(r"market|advertis|\bads?\b|promo|campaign", f"{e.category} {e.description}".lower()))
    rev = sum(s.revenue or 0 for s in sales)
    bench = 22 if industry == "ecommerce" else 8 if industry == "restaurant" else 15
    out = []
    if mk and rev and mk / rev <= 1.5:
        pctv = mk / rev * 100
        out.append(f"You're spending {_money(mk)} on marketing, which is {pctv:.0f}% of revenue.")
        out.append(f"For a {industry or 'small'} business the healthy range is around ≤{bench}%.")
        out.append("Too high — pause your lowest-ROI channel." if pctv > bench else "That's in range — you have room to scale what's working.")
    elif mk:
        out.append(f"You're spending {_money(mk)} on marketing.")
    else:
        out.append("I don't see marketing spend broken out in your expenses yet.")
    out += [
        "The one number to track is CAC (cost to acquire a customer) vs. the profit from that customer's first order — "
        "if CAC is higher than first-order profit, you're buying customers at a loss unless they come back.",
        "Best levers for a small budget: double down on your single best-performing channel, retarget people who already "
        "visited, and ask happy customers for referrals (near-zero CAC).",
    ]
    return out


def _inventory(db, uid, industry):
    rows = db.query(InventoryData).filter_by(user_id=uid).all()
    if not rows:
        return _need("inventory")
    def m(i): return ((i.unit_price or 0) - (i.unit_cost or 0)) / (i.unit_price or 1) * 100
    val = sum((i.unit_cost or 0) * (i.stock_qty or 0) for i in rows)
    low = [i for i in rows if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) <= (i.reorder_level or 0)]
    over = [i for i in rows if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) >= 3 * (i.reorder_level or 0)]
    best = max(rows, key=m)
    out = [f"You hold {_money(val)} of inventory at cost across {len(rows)} SKUs."]
    if low:
        out.append(f"Below reorder level ({len(low)}): {', '.join(i.product for i in low[:6])} — restock the high-margin ones first.")
    else:
        out.append("Nothing is below reorder level right now.")
    if over:
        out.append(f"Overstocked / slow: {', '.join(i.product for i in over[:6])} — mark these down or bundle them to free up cash.")
    out.append(f"Your fattest margin is {best.product} at {m(best):.0f}% — keep it in stock and feature it.")
    out.append("Rule of thumb: hold ~2–6 weeks of cover on your fast movers, and don't let cash sit in slow SKUs — "
               "inventory that isn't turning is just cash on a shelf.")
    return out


def _reviews(db, uid, industry):
    rows = db.query(ReviewData).filter_by(user_id=uid).all()
    if not rows:
        return _need("reviews")
    avg = sum(r.rating or 0 for r in rows) / len(rows)
    byp = {}
    for r in rows:
        p = r.product or r.sku or "Unknown"
        d = byp.setdefault(p, [0.0, 0]); d[0] += r.rating or 0; d[1] += 1
    ranked = sorted(([p, t / n, n] for p, (t, n) in byp.items()), key=lambda x: x[1])
    neg = sum(1 for r in rows if (r.rating or 0) <= 2)
    out = [
        f"Your average rating is {avg:.1f}★ across {len(rows)} reviews, with {neg} ({neg/len(rows)*100:.0f}%) at 2★ or below.",
        f"Weakest product: {ranked[0][0]} at {ranked[0][1]:.1f}★. Best: {ranked[-1][0]} at {ranked[-1][1]:.1f}★.",
    ]
    if avg < 4.0:
        out.append("You're below the 4.0★ mark most shoppers filter by — fixing your worst product is the highest-leverage move; "
                   "every 0.1★ typically nudges conversion up.")
    out.append("Read the actual ≤2★ comments for the worst product to find the root cause (quality? sizing? shipping? expectations?), "
               "then fix that and ask recent happy buyers for reviews to rebuild the average.")
    return out


def _labor(db, uid, industry):
    rows = db.query(ShiftData).filter_by(user_id=uid).all()
    if not rows:
        return _need("labor/timesheet")
    hrs = sum(s.actual_hours or 0 for s in rows)
    cost = sum(s.labor_cost or 0 for s in rows)
    ot = [s for s in rows if s.is_overtime]
    sales = db.query(SalesData).filter_by(user_id=uid).all()
    rev = sum(s.revenue or 0 for s in sales)
    bench = 32 if industry == "restaurant" else 45 if industry == "services" else 30
    out = [f"You've logged {hrs:.0f} hours costing {_money(cost)}."]
    if ot:
        out.append(f"{len(ot)} shift(s) hit overtime (~{_money(sum(s.labor_cost or 0 for s in ot))}). "
                   f"OT is ~1.5× base pay, so it's usually cheaper to add a part-timer or redistribute hours.")
    else:
        out.append("No overtime flagged — good.")
    if rev and cost / rev <= 1.5:
        out.append(f"Labor is {cost/rev*100:.0f}% of sales; the target for {industry or 'your'} businesses is around ≤{bench}%.")
    out.append("Best lever: schedule to demand — pull staffing down on your slowest days/hours and protect it on peaks. "
               "Track sales-per-labor-hour to spot over/under-staffing.")
    return out


def _cash(db, uid, industry):
    rows = db.query(TransactionData).filter_by(user_id=uid).all()
    if not rows:
        return _need("bank transactions")
    inflow = sum(t.amount for t in rows if t.is_deposit)
    outflow = sum(t.amount for t in rows if not t.is_deposit)
    net = inflow - outflow
    out = [f"Cash in {_money(inflow)}, cash out {_money(outflow)} — net {_money(net)}."]
    if net < 0:
        out.append("You're cash-flow negative. Fastest fixes: invoice on net-15 instead of net-30, take deposits up front, "
                   "pause any non-essential spend, and cut your biggest expense line.")
    else:
        out.append("You're cash-flow positive — park the surplus in a high-yield business account and keep a 3-month buffer "
                   "before reinvesting the rest into your best-margin product.")
    out.append("The metric to watch is your runway: cash on hand ÷ average monthly burn. Under ~3 months is a red flag.")
    return out


def _margin(db, uid, industry):
    inv = db.query(InventoryData).filter_by(user_id=uid).all()
    bench = 65 if industry == "restaurant" else 45 if industry in ("retail", "ecommerce") else 50
    out = []
    if inv:
        margins = [(((i.unit_price or 0) - (i.unit_cost or 0)) / (i.unit_price or 1) * 100, i) for i in inv]
        margins.sort()
        avg = sum(mp for mp, _ in margins) / len(margins)
        out.append(f"Your average product margin is {avg:.0f}% (target ~{bench}% for {industry or 'your'} businesses).")
        out.append(f"Thinnest: {margins[0][1].product} at {margins[0][0]:.0f}% — raise its price or drop it. "
                   f"Fattest: {margins[-1][1].product} at {margins[-1][0]:.0f}% — push volume there.")
    else:
        out.append("Upload inventory (with unit cost and price) and I can compute your real margins per product.")
    out.append("Three ways to lift margin without losing customers: raise price on your least price-sensitive items, "
               "cut unit cost by buying in bigger lots or switching suppliers, and shift your mix toward higher-margin products.")
    return out


def _pricing(db, uid, industry):
    inv = db.query(InventoryData).filter_by(user_id=uid).all()
    out = []
    if inv:
        thin = [i for i in inv if i.unit_price and ((i.unit_price - (i.unit_cost or 0)) / i.unit_price) < 0.4]
        if thin:
            out.append(f"These items are priced thin (<40% margin): {', '.join(i.product for i in thin[:6])} — test a price increase.")
        out.append("Most small businesses underprice. A 5–10% increase on your least price-sensitive products usually sticks "
                   "with almost no lost volume and drops almost entirely to profit.")
    else:
        out.append("Upload inventory with cost + price and I can point at exactly which items to reprice.")
    out.append("Pricing tactics: use charm pricing ($19 vs $20), offer a good/better/best tier to anchor value, and "
               "raise prices on your strongest-reviewed products first — social proof absorbs the increase.")
    return out


def _breakeven(db, uid, industry):
    exp = db.query(ExpenseData).filter_by(user_id=uid).all()
    inv = db.query(InventoryData).filter_by(user_id=uid).all()
    if not exp and not inv:
        return _need("expenses and inventory")
    fixed = sum(e.amount or 0 for e in exp
                if re.search(r"rent|lease|software|saas|subscription|insurance|utilit|salary|payroll", f"{e.category} {e.description}".lower()))
    if inv:
        ms = [((i.unit_price or 0) - (i.unit_cost or 0)) / (i.unit_price or 1) for i in inv if i.unit_price]
        cm = sum(ms) / len(ms) if ms else 0.5
    else:
        cm = 0.5
    out = []
    if fixed and cm > 0:
        out.append(f"Your fixed-ish costs (rent, software, insurance, payroll, utilities) run about {_money(fixed)} for the period you uploaded.")
        out.append(f"At an average contribution margin of {cm*100:.0f}%, you break even at roughly {_money(fixed/cm)} in sales — revenue above that is where profit starts.")
    else:
        out.append("To pin your break-even I need fixed costs (rent/software/insurance) in expenses and product prices/costs in inventory.")
    out.append("Break-even = fixed costs ÷ contribution-margin %. Lower it by cutting fixed overhead or raising margin (price up / cost down). "
               "Every fixed cost you add raises the bar you must clear before making a dime — so keep overhead lean.")
    return out


def _hiring(db, uid, industry):
    shifts = db.query(ShiftData).filter_by(user_id=uid).all()
    sales = db.query(SalesData).filter_by(user_id=uid).all()
    rev = sum(s.revenue or 0 for s in sales)
    cost = sum(s.labor_cost or 0 for s in shifts)
    ot = [s for s in shifts if s.is_overtime]
    out = []
    if shifts and rev and cost / rev <= 1.5:
        lp = cost / rev * 100
        if ot:
            out.append(f"You're paying overtime on {len(ot)} shift(s) and labor is {lp:.0f}% of sales — a classic 'add a part-timer' signal, since base pay beats time-and-a-half.")
        elif lp < 20:
            out.append(f"Labor is only {lp:.0f}% of sales — you have room to hire if demand is consistently outrunning your team.")
        else:
            out.append(f"Labor is {lp:.0f}% of sales — hire only against sustained demand, not a one-off busy stretch.")
    elif shifts:
        ot_n = len(ot)
        out.append(f"You've logged {len(shifts)} shift(s) costing {_money(cost)}"
                   + (f", with {ot_n} on overtime — that OT is usually the first sign you're a person short." if ot_n else ".")
                   + " Judge hiring by whether the crunch is consistent, not a single busy week.")
    else:
        out.append("Upload a timesheet and your sales, and I can tell you whether the numbers support hiring yet.")
    out.append("Before you hire, check three things: is the overtime/backlog steady for 4+ weeks; would a part-timer or contractor cover it cheaper; "
               "will the role directly add revenue (or free you to)? Three yeses = hire. Otherwise automate or reschedule first.")
    return out


def _focus(db, uid, industry):
    # Defer to the optimizer's ranked priorities for a data-driven answer.
    try:
        from analysis import optimizer
        res = optimizer.optimize(uid)
        pri = [s for s in res.get("sections", []) if s["title"] == "Priority actions"]
        if pri and pri[0]["lines"]:
            return ["Based on your data, here's where I'd focus first:"] + [f"  {i+1}. {l}" for i, l in enumerate(pri[0]["lines"][:5])]
    except Exception:
        pass
    return ["Import your sales, expenses, inventory, reviews and labor files, then click AI Optimize on the Dashboard — "
            "I'll rank exactly what to tackle first based on your numbers."]


# ── Consultative topics: ask about the situation, then advise ────────────────
_CLARIFY = {
    "production": ("Happy to help with production — a few quick things so my advice actually fits:\n"
                   "  • Where are you producing now — in-house / by hand, a contract manufacturer, or dropship / print-on-demand?\n"
                   "  • Roughly what monthly volume?\n"
                   "  • What's the main pain — capacity, unit cost, quality, or lead time?\n"
                   "Tell me and I'll give you specific next steps."),
    "distribution": ("Let's dig into distribution — quick context first:\n"
                     "  • How do you sell today — your own site, marketplaces (Amazon/Etsy), wholesale, or local / in-person?\n"
                     "  • Where are your customers mostly located?\n"
                     "  • Biggest bottleneck — shipping cost, delivery speed, or reach?\n"
                     "Give me those and I'll tailor it."),
    "sourcing": ("On sourcing — tell me: what are you buying (raw materials or finished goods), who from today, "
                 "and what's the pain — price, reliability, minimum order quantities, or lead time?"),
    "expansion": ("On expanding — a few questions: where are you based, what does “expand” mean here "
                  "(new location, new product line, new market, or going online), and what's driving it "
                  "(demand you're turning away, or looking for growth)?"),
    "general": ("Happy to help. So I can give advice that fits your situation:\n"
                "  • Where's your business located?\n"
                "  • How are you handling this today?\n"
                "A sentence on your setup and I'll dig in."),
}


def _loc(prof):
    """Pull a location hint from the profile description, if any."""
    return ""  # reserved; kept simple — advice below reads the user's own reply


def _advise_production(ans, prof, industry):
    a = ans.lower()
    out = []
    if re.search(r"in.?house|by hand|myself|handmade|home|garage|studio|we make", a):
        out.append("Producing in-house: your levers are batch size, written SOPs, and knowing your TRUE unit cost "
                   "(materials + your own hourly time). Most makers undercount their labor and underprice as a result.")
        out.append("Scale path: (1) batch to cut setup time, (2) document SOPs so you can train help, "
                   "(3) outsource the lowest-skill steps first — packing, labeling — before the craft itself, "
                   "(4) move to a contract manufacturer only once demand is steady and your hands are the bottleneck.")
    elif re.search(r"contract|manufactur|factory|\bcm\b|third.?party|overseas|supplier makes", a):
        out.append("Using a manufacturer: never single-source — qualify a second supplier so one failure can't stop you. "
                   "Put quality in writing (a spec + a simple per-run inspection) and build their lead time into your reorder points.")
        out.append("Negotiate the first-run MOQ down, then commit to volume for price breaks. Track LANDED cost "
                   "(unit + freight + duties), not the quoted price, or your margins will surprise you.")
    elif re.search(r"dropship|print on demand|\bpod\b|fulfil.?ed by|white label", a):
        out.append("Dropship / POD keeps you asset-light but margins are thin and you don't control quality — "
                   "so differentiate on brand, bundles and experience, and order samples of everything you list.")
    else:
        out.append("General production advice: nail your true unit cost, remove your single biggest bottleneck first, "
                   "and only add capacity (equipment or a manufacturer) against demand you can see 8+ weeks out.")
    if re.search(r"capacit|volume|keep up|backlog|behind", a):
        out.append("Capacity-bound → batch, add a shift or part-timer, or outsource one step before buying big equipment.")
    if re.search(r"cost|expensive|margin|cheap", a):
        out.append("Cost-bound → buy materials in larger lots, cut scrap/waste, and re-quote suppliers yearly.")
    if re.search(r"quality|defect|return|broken", a):
        out.append("Quality-bound → add a one-page inspection checklist per batch and track defect rate; fixing it also lifts reviews.")
    if re.search(r"lead time|slow|wait|delay", a):
        out.append("Lead-time-bound → hold safety stock on long-lead materials and dual-source.")
    return out


def _advise_distribution(ans, prof, industry):
    a = ans.lower()
    out = []
    if re.search(r"own site|website|shopify|my store|dtc|direct", a):
        out.append("Selling DTC on your own site: you keep the margin AND the customer data — lean into email/SMS for repeat "
                   "sales, and make shipping fast and cheap, since shipping cost and checkout friction are the top drop-off points.")
    if re.search(r"amazon|etsy|marketplace|ebay|walmart|faire", a):
        out.append("On marketplaces: great reach, but you pay 10–15%+ in fees and don't own the customer. Use them to acquire, "
                   "then drive repeat buyers to your own channel with pack-in inserts and follow-ups; win ranking with reviews and fast fulfillment.")
    if re.search(r"wholesale|retail|stores|boutique|stockist|consign", a):
        out.append("Wholesale/retail: you trade ~50% of retail margin for volume and reach — make sure your unit economics survive "
                   "the wholesale price, set clear terms (net-30, minimums), and don't undercut your stockists on your own site.")
    if re.search(r"local|market|farmers|pop.?up|in person|in-person|booth", a):
        out.append("Local/in-person: excellent for cash flow and feedback but capped by your time — use it to test products and "
                   "collect emails, then convert those buyers online.")
    if not out:
        out.append("General distribution advice: match the channel to your margin. High-margin/branded → own site + marketplaces; "
                   "low-margin/commodity → wholesale for volume. Own the customer relationship wherever you can.")
    if re.search(r"shipping|postage|freight|expensive to ship|cost to ship", a):
        out.append("Shipping cost → negotiate carrier rates at volume, use flat-rate/regional boxes, and set a free-shipping "
                   "threshold above your average order to lift AOV while covering postage.")
    if re.search(r"speed|slow|delivery time|late|too long", a):
        out.append("Delivery speed → hold stock closer to customers (a 3PL or regional warehouse); speed is now a conversion factor.")
    if re.search(r"reach|awareness|new customer|find|grow", a):
        out.append("Reach → add ONE new channel at a time and prove its CAC before scaling it.")
    return out


def _advise_sourcing(ans, prof, industry):
    a = ans.lower()
    out = ["Sourcing principles that save the most money and pain:"]
    out.append("• Always keep a qualified backup supplier — single-sourcing is the #1 cause of stockouts.")
    out.append("• Negotiate on total landed cost and terms (net-30, MOQ, price breaks), not just unit price.")
    if re.search(r"price|expensive|cost", a):
        out.append("• For price: consolidate orders for volume breaks, buy raw vs. finished where you can add the value, and re-quote annually.")
    if re.search(r"reliab|late|stockout|inconsistent|quality", a):
        out.append("• For reliability/quality: add a per-shipment spec + inspection, and dual-source your critical inputs.")
    if re.search(r"minimum|moq|too much|large order", a):
        out.append("• For MOQs: ask for a smaller first run to test, or split an MOQ with another small maker.")
    out.append("Track a simple scorecard per supplier (on-time %, defect %, price) so you have leverage at renewal.")
    return out


def _advise_expansion(ans, prof, industry):
    a = ans.lower()
    out = []
    if re.search(r"online|website|ecommerce|e-commerce|internet", a):
        out.append("Going online is the lowest-risk expansion — you keep one production base and reach far more customers. "
                   "Start with your own site + one marketplace, and reinvest early profit into whatever channel shows the best CAC.")
    elif re.search(r"location|store|shop|space|lease|second", a):
        out.append("A second location roughly doubles fixed cost and management load — only do it once your first is consistently "
                   "profitable and you're turning away demand. Validate the new area's foot traffic/demand before signing a lease, "
                   "and budget 6+ months of runway for it to ramp.")
    elif re.search(r"product|line|sku|new item", a):
        out.append("A new product line is cheaper than a new location. Extend into what your current customers already buy from "
                   "others, pre-sell or small-batch it to validate demand before committing inventory, and protect your margins.")
    elif re.search(r"market|region|country|city|state", a):
        out.append("New market: check whether demand, regulations and shipping economics actually work there before committing. "
                   "Test with a small paid campaign or a marketplace presence before you localize everything.")
    else:
        out.append("Expansion rule of thumb: grow the cheapest, most reversible way first (online or a new product line) before the "
                   "expensive, sticky moves (a second location). Only scale what's already profitable — expansion multiplies whatever "
                   "you have, including problems.")
    out.append("Whatever the path: keep 3–6 months of cash buffer, don't let the new venture starve the core, and set a clear "
               "'kill or double-down' checkpoint in 90 days.")
    return out


def _advise_general(ans, prof, industry):
    a = ans.lower()
    out = ["Here's how I'd think about it for your situation:"]
    if industry:
        out.append(f"As {('an' if industry[0] in 'aeiou' else 'a')} {industry} business, weigh every move against cash, margin and your time — those are the constraints that actually bind small businesses.")
    out.append("A simple decision test: does this add revenue, protect margin, or free up your time? If it doesn't clearly do one, "
               "it's probably a distraction. Do the cheapest, most reversible version first and measure before you scale.")
    out.append("If you tell me the specific area — production, distribution, pricing, marketing, hiring, cash flow — I can go deeper "
               "and pull in your own numbers where you've uploaded data.")
    return out


_ADVISE = {
    "production": _advise_production, "distribution": _advise_distribution,
    "sourcing": _advise_sourcing, "expansion": _advise_expansion, "general": _advise_general,
}

# Topics answered directly from the user's uploaded data (defined here, after the
# topic functions above, so the references resolve).
_DATA_FNS = {
    "sales": _sales, "expenses": _expenses, "marketing": _marketing,
    "inventory": _inventory, "reviews": _reviews, "labor": _labor,
    "cash": _cash, "margin": _margin, "pricing": _pricing, "focus": _focus,
    "breakeven": _breakeven, "hiring": _hiring,
}


def _help():
    topics = ["sales & revenue", "expenses & cost-cutting", "marketing & ad spend", "inventory & reorders",
              "reviews & reputation", "labor & scheduling", "cash flow", "margins", "pricing"]
    random.shuffle(topics)
    return ("Ask me anything about your business and I'll dig into your own numbers. For example:\n"
            f"  • \"How can I grow sales?\"\n  • \"Where's my money going?\"\n  • \"Which products should I reorder?\"\n"
            f"  • \"Is my marketing spend too high?\"\n  • \"What should I focus on first?\"\n"
            f"I can go deep on: {', '.join(topics)}.")
