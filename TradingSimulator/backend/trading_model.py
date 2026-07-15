"""trading_model.py -- our own RETRAINABLE trading model (TradingSimulator only).

Unlike a frozen LLM, this is a model whose weights we train and RE-train:
  * pre-trained on a large, regime-aware synthetic dataset that distills a broad
    body of technical-analysis knowledge, so it can trade sensibly out of the box,
  * retrainable on the simulator's OWN closed-trade outcomes, so it learns what
    actually works for this account (real profit/loss becomes the label).

The synthetic "teacher" below is where the trading knowledge lives.  It is NOT a
handful of rules -- it is regime-conditioned: the *same* reading means different
things in a trend vs. a range (e.g. oversold RSI is a buy-the-dip in an uptrend
but a falling-knife trap in a downtrend; the lower Bollinger band is a mean-revert
long in a range but the bearish side of a breakout in a downtrend).  The model
learns to read the regime (ADX / trend / slope) and apply the right logic.

It is tiny and instant (scikit-learn GradientBoosting) -- ideal for the Jetson, no
GPU, no memory pressure -- and is used ONLY by the TradingSimulator.
"""
import os
import json
import random
import numpy as np
import joblib
from sklearn.ensemble import GradientBoostingRegressor

_HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(_HERE, "trading_model.joblib")
SAMPLES_PATH = os.path.join(_HERE, "trading_model_samples.jsonl")   # accumulated real outcomes

# ── Feature engineering ───────────────────────────────────────────────────────
FEATURES = ["rsi", "stoch_k_val", "volume_ratio", "slope", "atr_pct", "price_vs_ema",
            "macd", "trend", "bb", "vwap", "volume", "adx", "macd_hist"]

# Neutral baseline (each feature at "no signal"), used for per-decision explanations
# and to pad older training rows saved before a feature was added.
_NEUTRAL = [50.0, 50.0, 1.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 15.0, 0.0]

_MACD  = {"bullish": 1.0, "bearish": -1.0}
_TREND = {"strong_up": 1.0, "up": 0.6, "mild_up": 0.3, "trending_up": 0.8,
          "down": -0.6, "strong_down": -1.0, "mild_down": -0.3, "trending_down": -0.8}
_BB    = {"lower": -1.0, "below": -1.0, "upper": 1.0, "above": 1.0}   # lower band = oversold
_VWAP  = {"above": 1.0, "below": -1.0}
_VOL   = {"high_buying": 1.0, "buying": 0.5, "high_selling": -1.0, "selling": -0.5}


def _enc(mapping, v):
    return mapping.get(str(v).lower(), 0.0)


def featurize(data):
    """Map a live indicator dict (from _compute_indicators_fast) to a feature vector."""
    price = float(data.get("last_price", 0) or 0)
    ema50 = float(data.get("ema50", price) or price) or 1.0
    price_vs_ema = (price - ema50) / ema50 if ema50 else 0.0

    # Normalised slope (% of price) is comparable across price scales; fall back to raw.
    slope_pct = data.get("slope_pct")
    if slope_pct is None:
        slope_pct = (float(data.get("slope", 0) or 0) / price * 100.0) if price else 0.0
    slope_feat = max(-3.0, min(3.0, float(slope_pct)))

    # MACD histogram (momentum acceleration), normalised to a percent of price.
    mv = float(data.get("macd_value", 0) or 0)
    ms = float(data.get("macd_signal_value", 0) or 0)
    macd_hist = ((mv - ms) / price * 100.0) if price else 0.0
    macd_hist = max(-2.0, min(2.0, macd_hist))

    return [
        float(data.get("rsi", 50) or 50),
        float(data.get("stoch_k_val", 50) or 50),
        float(data.get("volume_ratio", 1.0) or 1.0),
        slope_feat,
        float(data.get("atr_pct", 2.0) or 2.0),
        price_vs_ema,
        _enc(_MACD, data.get("macd_cross", "")),
        _enc(_TREND, data.get("trend", "")),
        _enc(_BB, data.get("bb_position", "")),
        _enc(_VWAP, data.get("vwap_signal", "")),
        _enc(_VOL, data.get("volume_signal", "")),
        float(data.get("adx", 15) or 15),
        macd_hist,
    ]


def _fit_len(f):
    """Pad/truncate a feature row to the current FEATURES length (schema drift safety)."""
    f = list(f)
    if len(f) < len(FEATURES):
        f = f + _NEUTRAL[len(f):]
    elif len(f) > len(FEATURES):
        f = f[:len(FEATURES)]
    return [float(x) for x in f]


# ── Heuristic "teacher": distills a broad body of TA knowledge into a target ─────
def _clip(x):
    return max(-10.0, min(10.0, x))


def _heuristic_score(f):
    """Regime-aware target score in [-10, +10].  A pure function of the feature
    vector, so the model can actually learn it from the same features at inference."""
    rsi, stoch, vol_r, slope, atr, pve, macd, trend, bb, vwap, volsig, adx, mhist = f

    trending     = adx >= 25       # a real directional regime
    strong_trend = adx >= 40
    ranging      = adx < 18        # chop / mean-reverting
    up   = trend > 0.2
    down = trend < -0.2
    s = 0.0

    # ── RSI — meaning depends entirely on regime ──────────────────────────────
    if ranging:                              # mean reversion dominates in ranges
        if rsi <= 25:   s += 3.2
        elif rsi <= 35: s += 1.8
        elif rsi >= 75: s -= 3.2
        elif rsi >= 65: s -= 1.8
    elif up:                                 # uptrend: buy the dip, don't fear strength
        if rsi <= 40:   s += 2.6             # pullback in an uptrend = prime long
        elif rsi <= 50: s += 1.2
        elif rsi >= 80: s -= 0.8             # extended, but trend still intact
        elif rsi >= 70: s += 0.3
    elif down:                               # downtrend: sell the rally, avoid the knife
        if rsi >= 60:   s -= 2.6             # bounce into a downtrend = prime short
        elif rsi >= 50: s -= 1.2
        elif rsi <= 20: s += 0.6             # deep oversold — only a small bounce edge
        elif rsi <= 30: s += 0.2
    else:
        if rsi <= 30:   s += 1.5
        elif rsi >= 70: s -= 1.5

    # ── Stochastic confirmation ───────────────────────────────────────────────
    if stoch <= 20:   s += 0.8
    elif stoch >= 80: s -= 0.8

    # ── MACD cross + histogram (momentum acceleration) ────────────────────────
    s += 1.8 * macd
    s += 3.0 * max(-1.0, min(1.0, mhist))

    # ── Trend alignment, weighted by how strong the trend actually is ─────────
    trend_w = min(1.0 + adx / 25.0, 3.0)
    s += 1.3 * trend * trend_w

    # ── Bollinger — the reading flips meaning by regime ───────────────────────
    if ranging:
        s += -1.6 * bb                       # lower band = mean-revert long; upper = fade
    elif trending:
        # riding the band in the trend's direction = breakout continuation
        s += 1.1 * bb if (trend * bb > 0) else -0.6 * bb
    else:
        s += -0.8 * bb

    # ── VWAP (institutional reference) ────────────────────────────────────────
    s += 0.9 * vwap

    # ── Volume confirmation — moves need participation ────────────────────────
    s += 1.1 * volsig
    if abs(slope) > 0.3 and vol_r > 1.3:     # directional move ON volume = real
        s += 0.8 * (1 if slope > 0 else -1)
    if abs(slope) > 0.3 and vol_r < 0.7:     # move WITHOUT volume tends to fade
        s -= 0.5 * (1 if slope > 0 else -1)

    # ── Slope momentum (normalised %) ─────────────────────────────────────────
    s += 1.3 * slope

    # ── Price vs EMA50 — value vs. falling knife ──────────────────────────────
    if up:
        if -0.05 <= pve < 0:  s += 1.5       # shallow pullback to the mean = buy
        elif pve < -0.05:     s += 0.5       # deeper dip, trend still up
        elif pve > 0.10:      s -= 0.6       # over-extended above the mean
    elif down:
        if pve > 0:           s -= 1.2       # bounce into the falling mean = short
        elif pve < -0.10:     s -= 0.6       # extended down, don't chase
    else:
        if pve > 0.10:        s -= 1.5 * pve * 10  # far above mean reverts down
        elif pve < -0.10:     s += 1.5 * (-pve) * 10

    # ── Volatility risk — very whippy tape lowers conviction ──────────────────
    if atr > 5.0:   s *= 0.75
    elif atr > 3.5: s *= 0.90

    # ── Confluence — real edge comes from signals agreeing ────────────────────
    bull = sum([(rsi < 45 and not down), macd > 0, mhist > 0, trend > 0.2,
                vwap > 0, volsig > 0, (bb < 0 and ranging), slope > 0.3])
    bear = sum([(rsi > 55 and not up), macd < 0, mhist < 0, trend < -0.2,
                vwap < 0, volsig < 0, (bb > 0 and ranging), slope < -0.3])
    if bull >= 5:   s += 2.0
    elif bull >= 4: s += 1.0
    if bear >= 5:   s -= 2.0
    elif bear >= 4: s -= 1.0

    return _clip(s)


# ── Regime-aware synthetic data generation ──────────────────────────────────────
_REGIMES = ["strong_uptrend", "uptrend", "range", "downtrend", "strong_downtrend",
            "high_volatility", "breakout_up", "breakout_down",
            "reversal_bottom", "reversal_top"]


def _sample_regime(rng, regime):
    """Draw a realistic, internally-correlated indicator dict for a given regime."""
    price = 100.0
    def macd_pair(bullish, strength):     # (macd_value, macd_signal_value)
        base = strength * (1 if bullish else -1)
        return (base, base - strength * rng.uniform(0.2, 0.9))

    if regime == "strong_uptrend":
        adx = rng.uniform(38, 62); trend = rng.choice(["strong_up", "up"])
        rsi = rng.uniform(45, 82); slope = rng.uniform(0.6, 2.6)
        bb = rng.choice(["upper", "middle", "upper"]); vwap = "above"
        vol = rng.choice(["high_buying", "buying", "neutral"]); macd = "bullish"
        mv, ms = macd_pair(True, rng.uniform(0.3, 1.2)); ema = rng.uniform(0.94, 1.0)
        stoch = rng.uniform(40, 92); vr = rng.uniform(0.9, 2.4)
    elif regime == "uptrend":
        adx = rng.uniform(20, 38); trend = rng.choice(["up", "mild_up", "trending_up"])
        rsi = rng.uniform(38, 68); slope = rng.uniform(0.2, 1.2)
        bb = rng.choice(["lower", "middle", "upper"]); vwap = rng.choice(["above", "above", "below"])
        vol = rng.choice(["buying", "neutral", "high_buying"]); macd = rng.choice(["bullish", "bullish", "bearish"])
        mv, ms = macd_pair(macd == "bullish", rng.uniform(0.1, 0.7)); ema = rng.uniform(0.96, 1.03)
        stoch = rng.uniform(25, 85); vr = rng.uniform(0.7, 1.8)
    elif regime == "range":
        adx = rng.uniform(6, 18); trend = rng.choice(["neutral", "mild_up", "mild_down"])
        rsi = rng.uniform(15, 85); slope = rng.uniform(-0.35, 0.35)
        bb = rng.choice(["lower", "middle", "upper"]); vwap = rng.choice(["above", "below"])
        vol = rng.choice(["buying", "neutral", "selling"]); macd = rng.choice(["bullish", "bearish", "neutral"])
        mv, ms = macd_pair(macd == "bullish", rng.uniform(0.0, 0.3)); ema = rng.uniform(0.97, 1.03)
        stoch = rng.uniform(5, 95); vr = rng.uniform(0.5, 1.5)
    elif regime == "downtrend":
        adx = rng.uniform(20, 38); trend = rng.choice(["down", "mild_down", "trending_down"])
        rsi = rng.uniform(32, 62); slope = rng.uniform(-1.2, -0.2)
        bb = rng.choice(["lower", "middle", "upper"]); vwap = rng.choice(["below", "below", "above"])
        vol = rng.choice(["selling", "neutral", "high_selling"]); macd = rng.choice(["bearish", "bearish", "bullish"])
        mv, ms = macd_pair(macd == "bullish", rng.uniform(0.1, 0.7)); ema = rng.uniform(0.97, 1.04)
        stoch = rng.uniform(15, 75); vr = rng.uniform(0.7, 1.8)
    elif regime == "strong_downtrend":
        adx = rng.uniform(38, 62); trend = rng.choice(["strong_down", "down"])
        rsi = rng.uniform(18, 55); slope = rng.uniform(-2.6, -0.6)
        bb = rng.choice(["lower", "middle", "lower"]); vwap = "below"
        vol = rng.choice(["high_selling", "selling", "neutral"]); macd = "bearish"
        mv, ms = macd_pair(False, rng.uniform(0.3, 1.2)); ema = rng.uniform(1.0, 1.06)
        stoch = rng.uniform(8, 60); vr = rng.uniform(0.9, 2.4)
    elif regime == "high_volatility":
        adx = rng.uniform(15, 45); trend = rng.choice(_TREND_KEYS)
        rsi = rng.uniform(10, 90); slope = rng.uniform(-2.5, 2.5)
        bb = rng.choice(["lower", "middle", "upper"]); vwap = rng.choice(["above", "below"])
        vol = rng.choice(["high_buying", "high_selling", "buying", "selling"]); macd = rng.choice(["bullish", "bearish"])
        mv, ms = macd_pair(macd == "bullish", rng.uniform(0.2, 1.4)); ema = rng.uniform(0.9, 1.1)
        stoch = rng.uniform(5, 95); vr = rng.uniform(1.2, 3.5)
    elif regime == "breakout_up":
        adx = rng.uniform(25, 50); trend = rng.choice(["up", "strong_up", "trending_up"])
        rsi = rng.uniform(55, 78); slope = rng.uniform(0.9, 2.8)
        bb = rng.choice(["upper", "above"]); vwap = "above"
        vol = rng.choice(["high_buying", "buying"]); macd = "bullish"
        mv, ms = macd_pair(True, rng.uniform(0.5, 1.5)); ema = rng.uniform(0.93, 0.99)
        stoch = rng.uniform(60, 95); vr = rng.uniform(1.4, 3.2)
    elif regime == "breakout_down":
        adx = rng.uniform(25, 50); trend = rng.choice(["down", "strong_down", "trending_down"])
        rsi = rng.uniform(22, 45); slope = rng.uniform(-2.8, -0.9)
        bb = rng.choice(["lower", "below"]); vwap = "below"
        vol = rng.choice(["high_selling", "selling"]); macd = "bearish"
        mv, ms = macd_pair(False, rng.uniform(0.5, 1.5)); ema = rng.uniform(1.01, 1.07)
        stoch = rng.uniform(5, 40); vr = rng.uniform(1.4, 3.2)
    elif regime == "reversal_bottom":     # downtrend exhausting, turning up
        adx = rng.uniform(14, 30); trend = rng.choice(["mild_down", "neutral", "down"])
        rsi = rng.uniform(18, 38); slope = rng.uniform(-0.4, 0.6)
        bb = rng.choice(["lower", "below", "middle"]); vwap = rng.choice(["below", "above"])
        vol = rng.choice(["high_buying", "buying"]); macd = rng.choice(["bullish", "bearish"])
        mv, ms = macd_pair(True, rng.uniform(0.2, 0.8)); ema = rng.uniform(1.0, 1.05)
        stoch = rng.uniform(8, 35); vr = rng.uniform(1.1, 2.6)
    else:                                  # reversal_top: uptrend exhausting, turning down
        adx = rng.uniform(14, 30); trend = rng.choice(["mild_up", "neutral", "up"])
        rsi = rng.uniform(62, 85); slope = rng.uniform(-0.6, 0.4)
        bb = rng.choice(["upper", "above", "middle"]); vwap = rng.choice(["above", "below"])
        vol = rng.choice(["high_selling", "selling"]); macd = rng.choice(["bearish", "bullish"])
        mv, ms = macd_pair(False, rng.uniform(0.2, 0.8)); ema = rng.uniform(0.95, 1.0)
        stoch = rng.uniform(65, 92); vr = rng.uniform(1.1, 2.6)

    atr_pct = {"high_volatility": rng.uniform(3.5, 8.0), "breakout_up": rng.uniform(2.0, 5.0),
               "breakout_down": rng.uniform(2.0, 5.0)}.get(regime, rng.uniform(0.5, 3.5))

    return {
        "rsi": rsi, "stoch_k_val": stoch, "volume_ratio": vr, "slope_pct": slope,
        "atr_pct": atr_pct, "last_price": price, "ema50": price * ema,
        "macd_cross": macd, "macd_value": mv, "macd_signal_value": ms,
        "trend": trend, "bb_position": bb, "vwap_signal": vwap, "volume_signal": vol,
        "adx": adx,
    }


_TREND_KEYS = ["strong_up", "up", "mild_up", "neutral", "mild_down", "down", "strong_down"]


def _synth_dataset(n=16000, seed=42):
    rng = random.Random(seed)
    X, y = [], []
    for _ in range(n):
        regime = rng.choice(_REGIMES)
        data = _sample_regime(rng, regime)
        f = featurize(data)
        X.append(f)
        y.append(_clip(_heuristic_score(f) + rng.gauss(0, 0.7)))
    return np.array(X, float), np.array(y, float)


# ── The model ─────────────────────────────────────────────────────────────────
_model = None


def _load_real_samples():
    """Load accumulated (features -> realized-outcome target) rows from closed trades.
    Rows saved under an older feature schema are padded/truncated, not discarded."""
    X, y = [], []
    if os.path.exists(SAMPLES_PATH):
        with open(SAMPLES_PATH) as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                    f = row.get("f", [])
                    if f:
                        X.append(_fit_len(f)); y.append(float(row["y"]))
                except Exception:
                    continue
    return X, y


def add_training_row(features, target):
    """Append one real (features, target) sample from a closed trade, for retraining."""
    try:
        with open(SAMPLES_PATH, "a") as fh:
            fh.write(json.dumps({"f": _fit_len(features),
                                 "y": float(_clip(target))}) + "\n")
    except Exception:
        pass


def train(save=True):
    """(Re)train: regime-aware synthetic TA prior + all real closed-trade outcomes."""
    Xs, ys = _synth_dataset()
    Xr, yr = _load_real_samples()
    if Xr:
        # weight real outcomes more heavily by duplicating them (few but ground-truth)
        reps = max(2, len(Xs) // max(1, len(Xr)) // 8)
        Xr_arr = np.array(Xr, float); yr_arr = np.array(yr, float)
        X = np.vstack([Xs] + [Xr_arr] * reps)
        y = np.concatenate([ys] + [yr_arr] * reps)
    else:
        X, y = Xs, ys
    m = GradientBoostingRegressor(n_estimators=200, max_depth=4,
                                  learning_rate=0.07, subsample=0.85, random_state=0)
    m.fit(X, y)
    if save:
        joblib.dump(m, MODEL_PATH)
    global _model
    _model = m
    return {"trained": True, "synthetic_samples": len(Xs), "real_samples": len(Xr),
            "features": len(FEATURES)}


def load():
    global _model
    if _model is not None:
        return _model
    if os.path.exists(MODEL_PATH):
        _model = joblib.load(MODEL_PATH)
        # if the saved model predates a feature-count change, retrain to match schema
        try:
            if getattr(_model, "n_features_in_", len(FEATURES)) != len(FEATURES):
                train()
        except Exception:
            pass
    else:
        train()          # first run -> pre-train
    return _model


def score(data):
    """Directional trade score in [-10, +10] (positive = bullish). Always available."""
    m = load()
    f = np.array([featurize(data)], float)
    return float(_clip(m.predict(f)[0]))


_LABELS = {
    "rsi": "RSI", "stoch_k_val": "Stochastic", "volume_ratio": "Volume ratio",
    "slope": "Trend slope", "atr_pct": "Volatility (ATR%)", "price_vs_ema": "Price vs EMA50",
    "macd": "MACD cross", "trend": "Trend", "bb": "Bollinger pos", "vwap": "VWAP",
    "volume": "Volume flow", "adx": "Trend strength (ADX)", "macd_hist": "MACD momentum",
}


def explain(data):
    """The model's 'thought process' for one symbol: the score plus each signal's
    marginal contribution (leave-one-out from a neutral baseline), sorted by impact."""
    m = load()
    f = featurize(data)
    score_val = float(_clip(m.predict(np.array([f], float))[0]))
    contribs = []
    for i in range(len(FEATURES)):
        probe = list(f)
        probe[i] = _NEUTRAL[i]                        # neutralize feature i
        s_wo = float(m.predict(np.array([probe], float))[0])
        delta = score_val - s_wo                      # this feature's marginal push
        if abs(delta) >= 0.15:
            contribs.append((FEATURES[i], f[i], round(delta, 2)))
    contribs.sort(key=lambda c: abs(c[2]), reverse=True)
    reasons = [{"signal": _LABELS.get(n, n), "value": round(float(v), 2),
                "contribution": d, "direction": "bullish" if d > 0 else "bearish"}
               for n, v, d in contribs]
    return {"score": round(score_val, 2), "reasons": reasons}


def model_status():
    real_n = len(_load_real_samples()[1])
    return {"model_ready": os.path.exists(MODEL_PATH) or _model is not None,
            "real_samples": real_n, "features": FEATURES}


if __name__ == "__main__":
    print(train())
    print("strong bullish:", score({"rsi": 38, "macd_cross": "bullish", "trend": "up",
                                     "bb_position": "lower", "volume_signal": "high_buying",
                                     "vwap_signal": "above", "slope_pct": 0.8, "stoch_k_val": 30,
                                     "volume_ratio": 1.8, "atr_pct": 2.0, "last_price": 100,
                                     "ema50": 98, "adx": 34, "macd_value": 0.6, "macd_signal_value": 0.2}))
    print("bear trap:", score({"rsi": 28, "macd_cross": "bearish", "trend": "down",
                               "bb_position": "lower", "volume_signal": "high_selling",
                               "vwap_signal": "below", "slope_pct": -1.5, "stoch_k_val": 15,
                               "volume_ratio": 1.6, "atr_pct": 3.0, "last_price": 100,
                               "ema50": 103, "adx": 42, "macd_value": -0.7, "macd_signal_value": -0.3}))
