"""llm_trader.py -- local-AI (Ollama) trade decision engine.

Replaces the old pattern/indicator-based scoring: instead of hardcoded rules, the
symbol's technical indicators are sent to a LOCAL LLM (Ollama on the Jetson) which
returns a trade score. If the local AI is unreachable, a LocalAIDownError is raised
so the trader never makes blind trades while the model is offline.

No paid APIs -- everything runs on-device.
"""
import os
import json
import time
import urllib.request
import urllib.error

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# Short cache so a scan cycle that re-sees the same symbol doesn't re-hit the model.
_CACHE_TTL = int(os.getenv("LLM_TRADER_TTL", "300"))   # seconds
_cache = {}   # symbol -> (timestamp, result)


class LocalAIDownError(RuntimeError):
    """Raised when the local AI (Ollama) can't be reached, so no trade calls run."""
    pass


def is_local_ai_up():
    """True if Ollama answers. Never raises -- used to gate the whole AI system."""
    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/tags")
        with urllib.request.urlopen(req, timeout=3) as r:
            r.read()
        return True
    except Exception:
        return False


def _ask(prompt, timeout=120):
    """POST to Ollama /api/generate. Retries once (the model may be cold-loading),
    then raises LocalAIDownError if it still can't get a response."""
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "keep_alive": "30m",          # keep the model warm between scans (once RAM allows)
        "options": {"temperature": 0.2},
    }).encode()
    last = None
    for attempt in range(6):
        req = urllib.request.Request(
            OLLAMA_URL + "/api/generate", data=payload,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r).get("response", "")
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode(errors="ignore")
            except Exception:
                pass
            last = f"HTTP {e.code}: {body[:120]}"
            if "loading" in body.lower():          # model warming up — wait and retry
                time.sleep(5)
                continue
            time.sleep(2)
        except urllib.error.URLError as e:
            raise LocalAIDownError(f"Local AI (Ollama) unreachable at {OLLAMA_URL}: {e.reason}")
        except Exception as e:
            last = str(e)
            time.sleep(2)
    raise LocalAIDownError(f"Local AI (Ollama) call failed: {last}")


def _extract_json(text):
    """Pull the first {...} JSON object out of a text response."""
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("no JSON object in response")


# Indicator fields handed to the model (compact -> fast on a small local model).
_FIELDS = ("symbol", "last_price", "rsi", "macd_cross", "stoch_k_val",
           "volume_signal", "volume_ratio", "bb_position", "vwap_signal",
           "trend", "slope", "atr_pct")


def llm_trade_score(data, market_state="", perf_memory=""):
    """Ask the local LLM to score a symbol from its technicals.

    ``perf_memory`` is a summary of how THIS portfolio's past AI decisions actually
    performed (win rates per regime/symbol). It is injected into the prompt so the
    model learns from its own track record -- favouring setups that made money and
    avoiding ones that lost -- without any weight retraining.

    Returns {'score': float in [-10,10], 'action': str, 'summary': str}.
    Positive score = bullish. Raises LocalAIDownError if the model is offline.
    """
    symbol = data.get("symbol", "") or ""
    now = time.time()
    # cache key includes the memory so a changed track record re-decides
    ckey = (symbol, hash(perf_memory))
    cached = _cache.get(ckey)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    fields = {k: data.get(k) for k in _FIELDS}
    memory_block = (
        "\nPAST PERFORMANCE OF YOUR OWN DECISIONS (learn from this — favour setups "
        "that made money, avoid/size-down ones that lost):\n" + perf_memory + "\n"
        if perf_memory else ""
    )
    prompt = (
        "You are a disciplined trading decision engine that LEARNS FROM ITS TRACK "
        "RECORD. Using the technical indicators and your past performance below, "
        "decide a trade score from -10 (strong sell/short) to +10 (strong buy). "
        "0 means no edge.\n"
        f"Market regime: {market_state}\n"
        f"Indicators: {json.dumps(fields, default=str)}\n"
        f"{memory_block}"
        'Respond ONLY as compact JSON: '
        '{"score": <number -10..10>, "action": "buy|sell|hold", '
        '"summary": "<one concise sentence, cite past performance if relevant>"}'
    )
    raw = _ask(prompt)
    try:
        obj = _extract_json(raw)
        score = max(-10.0, min(10.0, float(obj.get("score", 0))))
        result = {
            "score": score,
            "action": str(obj.get("action", "") or ""),
            "summary": str(obj.get("summary", "") or "")[:200],
        }
    except Exception:
        # Model returned malformed JSON -> treat as no-edge, but don't crash the scan.
        result = {"score": 0.0, "action": "hold", "summary": "AI response was unparseable."}

    _cache[ckey] = (now, result)
    return result
