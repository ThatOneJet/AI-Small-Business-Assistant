"""optimizer.py — Summit's small-business optimization advisor.

A benchmarked, cross-referencing expert engine. It reads every dataset (sales,
expenses, inventory, reviews, labor, cash, tenders) and produces PRESCRIPTIVE,
quantified recommendations grounded in standard small-business finance/ops
benchmarks — not a summary.

What makes the advice "expert":
  • Benchmarks — labor ≤30% of sales, marketing ≤15% of revenue, rent ≤10%,
    gross margin ≥50%, reviews ≥4.0★, no single product >40% of revenue, etc.
  • Cross-dataset reasoning — e.g. it will NOT tell you to reorder a low-stock
    item that is also your worst-reviewed one; it reorders the low-stock,
    high-margin item first (a stockout there costs the most profit).
  • Quantified impact — every lever is sized in dollars where possible.
"""
import re
import random
from models import (get_db, SalesData, ExpenseData, InventoryData, ReviewData,
                    ShiftData, TenderData, TransactionData, BusinessProfile)


def V(*opts):
    """Pick one phrasing at random so each run reads freshly (same insight,
    different words). Unseeded — varies on every optimize() call."""
    return random.choice(opts)

# ── Small-business benchmarks (industry rules of thumb) ──────────────────────
_DEFAULT_BM = {
    "labor_pct":     30.0,   # labor cost as % of revenue — at/below is healthy
    "marketing_pct": 15.0,   # marketing as % of revenue — above = overspending
    "rent_pct":      10.0,   # rent / occupancy as % of revenue
    "gross_margin":  50.0,   # target gross margin % on goods
    "review_target":  4.0,   # target average star rating
    "revenue_conc":  40.0,   # single-product revenue share that flags concentration risk
    "overstock_mult": 3.0,   # stock_qty ≥ this × reorder_level = overstocked
    "neg_review":     2.0,   # rating at/below this counts as negative
}

# Benchmarks retuned per industry (only the keys that differ from the defaults).
INDUSTRY_BM = {
    "restaurant":    {"labor_pct": 32, "marketing_pct": 8,  "rent_pct": 8, "gross_margin": 65, "overstock_mult": 2.5},
    "retail":        {"labor_pct": 18, "marketing_pct": 10, "rent_pct": 10, "gross_margin": 45},
    "ecommerce":     {"labor_pct": 12, "marketing_pct": 22, "rent_pct": 4,  "gross_margin": 45},
    "services":      {"labor_pct": 45, "marketing_pct": 10, "rent_pct": 8,  "gross_margin": 60},
    "manufacturing": {"labor_pct": 25, "marketing_pct": 6,  "rent_pct": 8,  "gross_margin": 30},
}

# The order priority actions are ranked in, by the owner's stated goal.
GOAL_ORDER = {
    "grow_revenue":    ["revenue", "reputation", "inventory", "margin", "cash", "cost", "labor"],
    "improve_margins": ["margin", "inventory", "cost", "revenue", "cash", "labor", "reputation"],
    "cut_costs":       ["cost", "labor", "cash", "inventory", "margin", "revenue", "reputation"],
    "balance":         None,
}
GOAL_LABEL = {"grow_revenue": "growing revenue", "improve_margins": "improving margins",
              "cut_costs": "cutting costs", "balance": "balanced growth"}

# Expense-category buckets so we can benchmark spend by type, not just raw label.
_CAT_RULES = [
    ("marketing", r"market|advertis|\bads?\b|promo|campaign|meta|google|facebook|instagram"),
    ("rent",      r"rent|lease|occupancy|mortgage"),
    ("payroll",   r"payroll|wages|salary|labou?r|staff"),
    ("cogs",      r"packag|supplies|material|inventory|cogs|wax|ingredient|freight|shipping"),
    ("utilities", r"utilit|power|electric|water|\bgas\b|internet|phone"),
    ("software",  r"software|saas|subscription|hosting|licen[cs]e"),
    ("fees",      r"\bfee|processing|stripe|square|bank charge|merchant"),
]


def _money(n):
    return "$" + format(float(n or 0), ",.2f")


def _bucket(category, vendor=""):
    text = f"{category or ''} {vendor or ''}".lower()
    for name, pat in _CAT_RULES:
        if re.search(pat, text):
            return name
    return "other"


def _sku(x):  return (x or "").strip().upper() or None
def _prod(x): return (x or "").strip().lower() or None


# Maps a UI filter key → the section title it selects.
_FILTER_TITLES = {
    "priorities": "priority actions", "health": "financial health",
    "sales": "sales", "expenses": "expenses", "inventory": "inventory",
    "reviews": "reviews", "labor": "labor", "cash": "cash flow", "tenders": "tenders",
}


def optimize(user_id, focus=None):
    """Return {'sections': [...], 'any_data': bool}. Each section is
    {'title', 'has_data', 'lines'}; empty datasets say so explicitly.
    `focus` is an optional list of filter keys — when 1–2 are given the output
    is trimmed to those sections and each is analyzed in more depth."""
    db = get_db()
    try:
        return _build(db, user_id, focus)
    finally:
        db.close()


def _build(db, user_id, focus=None):
    wanted = {f.strip().lower() for f in (focus or []) if f and str(f).strip() and f.strip().lower() != "all"}
    deep = bool(wanted) and len(wanted) <= 2   # fewer sections → dig deeper
    sections = []
    priorities = []          # (theme, text) cross-cutting actions, ranked by goal
    health = []              # benchmarked financial-health lines

    def pri(theme, text):
        priorities.append((theme, text))

    # ── Business profile: tune benchmarks + priorities to THIS business ──────
    prof = db.query(BusinessProfile).filter_by(user_id=user_id).first()
    industry = ((prof.industry if prof else "") or "").strip().lower()
    goal = ((prof.goal if prof else "balance") or "balance").strip().lower()
    desc = ((prof.description if prof else "") or "").lower()
    BM = dict(_DEFAULT_BM)
    if industry in INDUSTRY_BM:
        BM.update(INDUSTRY_BM[industry])
    if prof and prof.target_margin:
        BM["gross_margin"] = float(prof.target_margin)
    if prof and prof.target_labor_pct:
        BM["labor_pct"] = float(prof.target_labor_pct)
    if re.search(r"season|peak|holiday|christmas|\bq4\b|black friday", desc):
        pri("cash", V(
                "Seasonality: you flagged a peak season — build inventory and a cash buffer 6–8 weeks ahead so you don't stock out or get cash-squeezed at the worst time.",
                "With a peak season ahead, start building inventory and a cash buffer 6–8 weeks early — that's exactly when stockouts and cash crunches bite hardest.",
            ))

    # ── Load everything once ─────────────────────────────────────────────────
    sales   = db.query(SalesData).filter(SalesData.user_id == user_id).all()
    exp     = db.query(ExpenseData).filter(ExpenseData.user_id == user_id).all()
    inv     = db.query(InventoryData).filter(InventoryData.user_id == user_id).all()
    revs    = db.query(ReviewData).filter(ReviewData.user_id == user_id).all()
    shifts  = db.query(ShiftData).filter(ShiftData.user_id == user_id).all()
    tenders = db.query(TenderData).filter(TenderData.user_id == user_id).all()
    txns    = db.query(TransactionData).filter(TransactionData.user_id == user_id).all()

    # Resolve a sales label (often a SKU) to a friendly product name via inventory.
    name_by_sku = {_sku(i.sku): i.product for i in inv if i.sku and i.product}
    def disp(label):
        return name_by_sku.get(_sku(label), label)

    # ── Sales metrics + product velocity (used across sections) ──────────────
    sales_total = sum(s.revenue or 0 for s in sales)
    rev_by_prod, units_by_key = {}, {}
    for s in sales:
        label = s.item or "Unknown"
        rev_by_prod[label] = rev_by_prod.get(label, 0) + (s.revenue or 0)
        k = _sku(s.item) or _prod(s.item)
        if k:
            units_by_key[k] = units_by_key.get(k, 0) + (s.quantity_sold or 0)
    ranked_prod = sorted(rev_by_prod.items(), key=lambda x: -x[1])
    orders = len(set(s.check_number for s in sales if s.check_number)) or len(sales)
    aov = sales_total / orders if orders else 0

    def units_for(item):
        for k in (_sku(item.sku), _prod(item.product)):
            if k and k in units_by_key:
                return units_by_key[k]
        return None

    # ── Reviews keyed for cross-reference ────────────────────────────────────
    rate_sku, rate_prod, _tmp = {}, {}, {}
    for r in revs:
        for tag, key in (("s", _sku(r.sku)), ("p", _prod(r.product))):
            if key:
                d = _tmp.setdefault((tag, key), [0.0, 0]); d[0] += r.rating or 0; d[1] += 1
    for (tag, key), (tot, n) in _tmp.items():
        (rate_sku if tag == "s" else rate_prod)[key] = tot / n

    def rating_for(item):
        for m, k in ((rate_sku, _sku(item.sku)), (rate_prod, _prod(item.product))):
            if k and k in m:
                return m[k]
        return None

    # ── Expense buckets ──────────────────────────────────────────────────────
    exp_total = sum(e.amount or 0 for e in exp)
    by_cat, by_bucket, by_vendor = {}, {}, {}
    for e in exp:
        by_cat[e.category or "Uncategorized"] = by_cat.get(e.category or "Uncategorized", 0) + (e.amount or 0)
        by_bucket[_bucket(e.category, e.description)] = by_bucket.get(_bucket(e.category, e.description), 0) + (e.amount or 0)
        if e.description:
            by_vendor[e.description] = by_vendor.get(e.description, 0) + (e.amount or 0)

    def pct_of_sales(x):
        return (x / sales_total * 100) if sales_total else None

    # ── Estimated gross margin (COGS from inventory unit cost × units sold) ──
    gross_margin = None
    if sales_total and inv:
        cost_by_key = {}
        for i in inv:
            for k in (_sku(i.sku), _prod(i.product)):
                if k:
                    cost_by_key[k] = i.unit_cost or 0
        cogs = matched_rev = 0.0
        for s in sales:
            k = _sku(s.item) or _prod(s.item)
            if k in cost_by_key:
                cogs += cost_by_key[k] * (s.quantity_sold or 0)
                matched_rev += s.revenue or 0
        if matched_rev > 0.4 * sales_total:          # only if we matched most revenue
            gross_margin = (matched_rev - cogs) / matched_rev * 100

    # ══ SALES ════════════════════════════════════════════════════════════════
    if sales:
        lines = [V(f"{_money(sales_total)} across {orders} orders — average order {_money(aov)}.", f"You've booked {_money(sales_total)} from {orders} orders, averaging {_money(aov)} apiece.")]
        top_name, top_rev = ranked_prod[0]
        top_share = top_rev / sales_total * 100 if sales_total else 0
        lines.append(V(f"Protect your hero: {disp(top_name)} is {top_share:.0f}% of revenue — never let it stock out and add a matching upsell at checkout.", f"Guard your bestseller: {disp(top_name)} is {top_share:.0f}% of revenue — keep it in stock at all costs and pair it with a checkout add-on."))
        if top_share >= BM["revenue_conc"]:
            pri("revenue", V(
                f"De-risk revenue: {disp(top_name)} alone is {top_share:.0f}% of sales. Grow a second hero product so one stockout can't sink a month.",
                f"Concentration risk: {disp(top_name)} is {top_share:.0f}% of revenue — build up a second bestseller so a single stockout can't tank the month.",
            ))
        if len(ranked_prod) > 3:
            tail = ranked_prod[-2:]
            tail_share = sum(v for _, v in tail) / sales_total * 100
            lines.append(V(f"Prune the tail: {', '.join(disp(n) for n, _ in tail)} are only {tail_share:.0f}% of revenue combined — bundle them with a hero or retire them.", f"Trim the deadweight: {', '.join(disp(n) for n, _ in tail)} together make up just {tail_share:.0f}% of revenue — bundle or drop them."))
        lines.append(V(f"Lift average order: a +$5 add-on on every order would add ~{_money(orders * 5)} at these volumes.", f"Raise order value: even a $5 upsell per order pencils out to ~{_money(orders * 5)} at your volume."))
        if deep:
            lines.append("Full product mix by revenue:")
            for n, rv in ranked_prod[:8]:
                lines.append(f"   • {disp(n)}: {_money(rv)} ({rv/sales_total*100:.0f}%)")
            lines.append(f"Repeat business is the cheapest growth you have — a follow-up 2–3 weeks post-purchase, a loyalty perk, "
                         f"and a subscribe-and-save option on {disp(ranked_prod[0][0])} would each compound over time.")
        sections.append({"title": "Sales", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Sales", "has_data": False,
                         "lines": ["No data for sales — import a sales export to optimize revenue, pricing and product mix."]})

    # ══ EXPENSES ═══════════════════════════════════════════════════════════════
    if exp:
        ranked_cat = sorted(by_cat.items(), key=lambda x: -x[1])
        top_cat, top_amt = ranked_cat[0]
        lines = [V(f"Total spend {_money(exp_total)} — biggest line is {top_cat} at {top_amt/exp_total*100:.0f}% ({_money(top_amt)}).", f"You've spent {_money(exp_total)} total; {top_cat} leads the bill at {top_amt/exp_total*100:.0f}% ({_money(top_amt)})."),
                 V(f"Attack {top_cat} first: a 15% cut there frees ~{_money(top_amt * 0.15)} — more than trimming everything else combined.", f"Start with {top_cat}: shaving 15% there frees ~{_money(top_amt * 0.15)}, more than nickel-and-diming everything else.")]
        # marketing benchmark
        mk = by_bucket.get("marketing", 0)
        mk_pct = pct_of_sales(mk)
        if mk and mk_pct is not None and mk_pct <= 150:
            if mk_pct > BM["marketing_pct"]:
                lines.append(V(f"Marketing is {mk_pct:.0f}% of revenue (target ≤{BM['marketing_pct']:.0f}%) — pause your lowest-ROI campaign and reallocate to proven sellers.", f"Marketing's running at {mk_pct:.0f}% of revenue vs a ≤{BM['marketing_pct']:.0f}% target — cut the weakest campaign and shift that budget to proven winners."))
                pri("cost", V(
                f"Rein in marketing: it's {mk_pct:.0f}% of revenue ({_money(mk)}), above the {BM['marketing_pct']:.0f}% benchmark. Cut the weakest campaign and put it behind {disp(ranked_prod[0][0]) if ranked_prod else 'your top seller'}.",
                f"Marketing is running hot at {mk_pct:.0f}% of revenue ({_money(mk)}) vs the {BM['marketing_pct']:.0f}% benchmark — kill the worst-performing campaign and redirect it to {disp(ranked_prod[0][0]) if ranked_prod else 'your top seller'}.",
            ))
            else:
                lines.append(V(f"Marketing at {mk_pct:.0f}% of revenue is within the healthy ≤{BM['marketing_pct']:.0f}% range — you have room to scale what works.", f"Marketing sits at {mk_pct:.0f}% of revenue, inside the healthy ≤{BM['marketing_pct']:.0f}% band — room to scale whatever's converting."))
        # top vendor leverage
        if by_vendor:
            v, va = max(by_vendor.items(), key=lambda x: x[1])
            lines.append(V(f"Negotiate with {v} — your largest payee at {_money(va)}; ask for a volume discount or get a second quote.", f"Press {v} on price — your biggest payee at {_money(va)}; ask for a volume break or line up a competing quote."))
        sections.append({"title": "Expenses", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Expenses", "has_data": False,
                         "lines": ["No data for expenses — import an expense report to find your biggest savings levers."]})

    # ══ INVENTORY ══════════════════════════════════════════════════════════════
    if inv:
        def margin_pct(i):
            return ((i.unit_price or 0) - (i.unit_cost or 0)) / (i.unit_price or 1) * 100
        invval = sum((i.unit_cost or 0) * (i.stock_qty or 0) for i in inv)
        low = [i for i in inv if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) <= (i.reorder_level or 0)]
        over = [i for i in inv if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) >= BM["overstock_mult"] * (i.reorder_level or 0)]
        best = max(inv, key=margin_pct); worst = min(inv, key=margin_pct)
        lines = [V(f"{_money(invval)} of cash is tied up across {len(inv)} SKUs.", f"You're holding {_money(invval)} of stock at cost across {len(inv)} SKUs.")]

        # cross-referenced reorder guidance (this is the 'expert' part)
        for i in sorted(low, key=margin_pct, reverse=True)[:3]:
            rt = rating_for(i)
            if rt is not None and rt <= 3.0:
                pri("reputation", V(
                f"Do NOT reorder {i.product} yet — it's low stock ({i.stock_qty:g} left) but your weakest-rated at {rt:.1f}★. Fix the complaints first or you'll restock returns.",
                f"Hold off restocking {i.product} — yes it's low ({i.stock_qty:g} left), but at {rt:.1f}★ it's your worst-rated item; fix the quality issues first or you'll just buy more returns.",
            ))
            else:
                pri("inventory", V(
                f"Reorder {i.product} now — {i.stock_qty:g} left (reorder at {i.reorder_level:g}) at a {margin_pct(i):.0f}% margin; a stockout on a high-margin seller costs you the most profit.",
                f"Restock {i.product} ASAP — only {i.stock_qty:g} left and it earns {margin_pct(i):.0f}%; running out of a high-margin line is the priciest stockout you can have.",
            ))
        if low:
            lines.append(f"{len(low)} item(s) at/below reorder level: {', '.join(i.product for i in low[:5])}.")
            if deep:
                for i in sorted(low, key=margin_pct, reverse=True):
                    lines.append(f"   • {i.product}: {i.stock_qty:g} on hand vs reorder at {i.reorder_level:g}, {margin_pct(i):.0f}% margin — order ~{max(i.reorder_level*2 - i.stock_qty, i.reorder_level):g} units.")
        else:
            lines.append("No items below reorder level — stock levels look healthy.")

        # dead / overstock, cross-referenced with sales velocity
        for i in over[:2]:
            sold = units_for(i)
            if sold is not None and sold <= (i.stock_qty or 0) * 0.25:
                tied = (i.unit_cost or 0) * (i.stock_qty or 0)
                pri("cash", V(
                f"Clear {i.product}: {i.stock_qty:g} in stock but only {sold:g} sold — run a promo/markdown to free ~{_money(tied)} in cash.",
                f"Move {i.product}: {i.stock_qty:g} sitting in stock against just {sold:g} sold — a markdown or bundle would unlock ~{_money(tied)} of trapped cash.",
            ))
        mw = margin_pct(worst)
        if mw < 40:
            lines.append(V(f"Push margin: {best.product} earns {margin_pct(best):.0f}% — feature it; {worst.product} is thin at {mw:.0f}% — raise its price or drop it.", f"Mind your margins: {best.product} leads at {margin_pct(best):.0f}% — push it; {worst.product} is thin at {mw:.0f}%, so reprice or cut it."))
        else:
            lines.append(V(f"Push margin: {best.product} is your richest at {margin_pct(best):.0f}% — feature it; even your thinnest ({worst.product}) is a healthy {mw:.0f}%.", f"Margins look solid: {best.product} tops out at {margin_pct(best):.0f}% — feature it; even the thinnest ({worst.product}) holds a healthy {mw:.0f}%."))
        sections.append({"title": "Inventory", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Inventory", "has_data": False,
                         "lines": ["No data for inventory — import a stock snapshot to catch stockouts, dead stock and margin wins."]})

    # ══ REVIEWS ════════════════════════════════════════════════════════════════
    if revs:
        avg = sum(r.rating or 0 for r in revs) / len(revs)
        byp = {}
        for r in revs:
            p = r.product or r.sku or "Unknown"
            d = byp.setdefault(p, [0.0, 0]); d[0] += r.rating or 0; d[1] += 1
        prod_avg = sorted(([p, t / n, n] for p, (t, n) in byp.items()), key=lambda x: x[1])
        worst = prod_avg[0]
        neg = sum(1 for r in revs if (r.rating or 0) <= BM["neg_review"])
        lines = [V(f"Average {avg:.1f}★ across {len(revs)} reviews ({neg / len(revs) * 100:.0f}% at ≤{BM['neg_review']:.0f}★).", f"You're averaging {avg:.1f}★ over {len(revs)} reviews — {neg / len(revs) * 100:.0f}% land at ≤{BM['neg_review']:.0f}★.")]
        if avg < BM["review_target"]:
            lines.append(V(f"You're under the {BM['review_target']:.1f}★ trust threshold shoppers filter by — every 0.1★ lifts conversion. Prioritize the fixes below.", f"You're below the {BM['review_target']:.1f}★ bar most shoppers filter by — each 0.1★ you claw back lifts conversion, so tackle the fixes below."))
        lines.append(V(f"Worst offender: {worst[0]} at {worst[1]:.1f}★ ({worst[2]} reviews) — read its ≤2★ comments and fix the root cause or delist it.", f"Biggest drag: {worst[0]} sits at {worst[1]:.1f}★ across {worst[2]} reviews — dig into its ≤2★ comments, fix the cause, or pull it."))
        if worst[1] <= 3.0:
            pri("reputation", V(
                f"Reputation risk: {worst[0]} sits at {worst[1]:.1f}★ — it drags your average and your ad conversion. Fix or delist it before spending more to drive traffic to it.",
                f"{worst[0]} is a reputation drag at {worst[1]:.1f}★ — it pulls down your average and your conversion; repair or remove it before paying to send more traffic its way.",
            ))
        if len(prod_avg) > 1 and prod_avg[-1][1] >= 4.5:
            lines.append(V(f"Amplify the winner: {prod_avg[-1][0]} averages {prod_avg[-1][1]:.1f}★ — put it in ads and request more reviews to compound the proof.", f"Lean on your star: {prod_avg[-1][0]} averages {prod_avg[-1][1]:.1f}★ — feature it in ads and chase more reviews to stack the social proof."))
        sections.append({"title": "Reviews", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Reviews", "has_data": False,
                         "lines": ["No data for reviews — import reviews to protect your rating and catch problem products early."]})

    # ══ LABOR ══════════════════════════════════════════════════════════════════
    if shifts:
        hrs = sum(s.actual_hours or 0 for s in shifts)
        cost = sum(s.labor_cost or 0 for s in shifts)
        ot = [s for s in shifts if s.is_overtime]
        lines = [V(f"{hrs:.0f} hours logged costing {_money(cost)}.", f"You've logged {hrs:.0f} hours at a cost of {_money(cost)}.")]
        if ot:
            otcost = sum(s.labor_cost or 0 for s in ot)
            lines.append(V(f"Overtime on {len(ot)} shift(s) (~{_money(otcost)}) — OT is ~1.5× base pay; a part-timer or a schedule tweak usually clears it.", f"{len(ot)} shift(s) hit overtime (~{_money(otcost)}) — at 1.5× base pay, a part-timer or a smarter schedule usually erases it."))
            pri("labor", V(
                f"Cut overtime: {len(ot)} OT shift(s) cost ~{_money(otcost)}. Redistribute those hours or add a part-timer to pay base rate instead of 1.5×.",
                f"Trim overtime: {len(ot)} OT shift(s) run ~{_money(otcost)} at time-and-a-half — spread those hours out or bring on a part-timer at base rate.",
            ))
        else:
            lines.append(V("No overtime flagged — scheduling looks efficient; keep staffing tied to demand.", "No overtime showing — scheduling looks tight; keep staffing matched to demand."))
        lp = pct_of_sales(cost)
        if lp is not None and lp <= 150:
            if lp > BM["labor_pct"]:
                lines.append(V(f"Labor is {lp:.0f}% of sales, above the ≤{BM['labor_pct']:.0f}% benchmark — trim shifts on your slowest days.", f"Labor's at {lp:.0f}% of sales, over the ≤{BM['labor_pct']:.0f}% mark — pull back shifts on your slowest days."))
                pri("labor", V(
                f"Labor is {lp:.0f}% of sales (target ≤{BM['labor_pct']:.0f}%) — cut the least-productive shift or shift hours to peak demand.",
                f"Labor's eating {lp:.0f}% of sales vs a ≤{BM['labor_pct']:.0f}% target — pull back your slowest shift or move hours toward peak demand.",
            ))
            else:
                lines.append(V(f"Labor at {lp:.0f}% of sales is within the healthy ≤{BM['labor_pct']:.0f}% range.", f"Labor's a healthy {lp:.0f}% of sales, inside the ≤{BM['labor_pct']:.0f}% target."))
        sections.append({"title": "Labor", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Labor", "has_data": False,
                         "lines": ["No data for labor — import a timesheet to optimize scheduling and overtime."]})

    # ══ CASH FLOW (bank transactions) ══════════════════════════════════════════
    if txns:
        inflow = sum(t.amount for t in txns if t.is_deposit)
        outflow = sum(t.amount for t in txns if not t.is_deposit)
        net = inflow - outflow
        if net >= 0:
            lines = [V(f"Cash in {_money(inflow)}, out {_money(outflow)} — net positive {_money(net)}.", f"Money in {_money(inflow)}, money out {_money(outflow)} — you're net positive {_money(net)}."),
                     "Positive cash flow — park the surplus in a high-yield business account or reinvest in your best-margin product."]
        else:
            lines = [V(f"Cash in {_money(inflow)}, out {_money(outflow)} — net negative {_money(-net)}.", f"Money in {_money(inflow)}, money out {_money(outflow)} — you're net negative {_money(-net)}."),
                     "You're burning cash — invoice faster (net-15 not net-30), delay non-essential spend, and cut the biggest expense line above."]
            pri("cash", V(
                f"Cash flow is negative ({_money(-net)}). Tighten receivables and pause discretionary spend before it drains your runway.",
                f"You're cash-flow negative ({_money(-net)}) — speed up collections and freeze non-essential spend before it eats your runway.",
            ))
        sections.append({"title": "Cash flow", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Cash flow", "has_data": False,
                         "lines": ["No data for transactions — connect a bank or import a statement to track cash flow."]})

    # ══ TENDERS ════════════════════════════════════════════════════════════════
    if tenders:
        byt = {}
        for t in tenders:
            byt[t.tender_type or "unknown"] = byt.get(t.tender_type or "unknown", 0) + (t.amount or 0)
        tot = sum(byt.values()) or 1
        top = max(byt.items(), key=lambda x: x[1])
        lines = [f"{top[0].replace('_', ' ').title()} is {top[1] / tot * 100:.0f}% of payments."]
        if re.search(r"credit|card", top[0].lower()):
            lines.append(f"Card fees (~2.9%) on that volume cost ~{_money(top[1] * 0.029)} — offer a small cash/ACH discount or set a card-fee-friendly minimum.")
        sections.append({"title": "Tenders", "has_data": True, "lines": lines})
    else:
        sections.append({"title": "Tenders", "has_data": False,
                         "lines": ["No data for tenders — nothing to optimize here yet."]})

    # ══ FINANCIAL HEALTH (benchmarked scorecard) ═══════════════════════════════
    if gross_margin is not None:
        ok = gross_margin >= BM["gross_margin"]
        health.append(f"{'✓' if ok else '⚠'} Gross margin {gross_margin:.0f}% (target ≥{BM['gross_margin']:.0f}%){'' if ok else ' — raise prices or cut unit costs.'}")
    if sales and exp and sales_total and exp_total / sales_total <= 1.5:
        rent = by_bucket.get("rent", 0); rp = pct_of_sales(rent)
        if rent and rp is not None:
            ok = rp <= BM["rent_pct"]
            health.append(f"{'✓' if ok else '⚠'} Rent {rp:.0f}% of sales (target ≤{BM['rent_pct']:.0f}%){'' if ok else ' — negotiate the lease or sublet space.'}")
        op_ratio = exp_total / sales_total * 100
        health.append(f"Operating expenses {op_ratio:.0f}% of sales.")
        # Rough net margin: gross margin minus operating spend (excluding COGS-type
        # lines already inside gross margin, to avoid double-counting).
        if gross_margin is not None:
            opex_excl = exp_total - by_bucket.get("cogs", 0)
            net_est = gross_margin - (opex_excl / sales_total * 100)
            ok = net_est >= 10
            health.append(f"{'✓' if ok else '⚠'} Estimated net margin ~{net_est:.0f}% (target ≥10%){'' if ok else ' — thin; grow gross margin or trim operating costs.'}")

    # Rank priorities by the owner's stated goal (stable within a theme).
    order = GOAL_ORDER.get(goal)
    if order:
        rank = {t: i for i, t in enumerate(order)}
        priorities.sort(key=lambda tt: rank.get(tt[0], len(order)))
    priority_lines = [text for _theme, text in priorities][:6]

    # Business-context header so the advice visibly reflects the profile.
    context = []
    if prof and (industry or (prof.name or "").strip() or goal != "balance"):
        who = (prof.name or "").strip() or "your business"
        bits = [f"Tuned for {who}"]
        if industry:
            art = "an" if industry[0] in "aeiou" else "a"
            bits.append(f"{art} {industry} business")
        bits.append(f"focused on {GOAL_LABEL.get(goal, 'balanced growth')}")
        context.append(" — ".join(bits) + f". Benchmarks set to {'the ' + industry if industry else 'general small-business'} standard.")
        if desc:
            snippet = (prof.description or "").strip()
            context.append(f"Context noted: “{snippet[:180]}{'…' if len(snippet) > 180 else ''}”")
    elif not prof or not (industry or (prof.name or '').strip()):
        context.append("Tip: add a Business Profile above so the AI tailors benchmarks and priorities to your industry and goals.")

    # Assemble: context, priorities (ranked), health, then the per-section advice.
    out = []
    any_data = any(s["has_data"] for s in sections)
    if context:
        out.append({"title": "Your business", "has_data": True, "lines": context})
    if priority_lines:
        out.append({"title": "Priority actions", "has_data": True, "lines": priority_lines})
    if health:
        out.append({"title": "Financial health", "has_data": True, "lines": health})
    out.extend(sections)

    # Section filter: keep only the requested sections (plus the business-context
    # header). With a filter active, priorities are hidden unless explicitly asked.
    if wanted:
        titles = {_FILTER_TITLES.get(w, w) for w in wanted}
        titles.add("your business")
        out = [s for s in out if s["title"].lower() in titles]
    return {"sections": out, "any_data": any_data}
