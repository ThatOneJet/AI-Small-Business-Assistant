"""vision_embed.py — offline image embeddings for product recognition.

Uses a DINOv2-small ONNX model (via onnxruntime, CPU) to turn a product photo into
a 384-dim L2-normalized feature vector (the model's CLS token — purpose-built for
instance retrieval). Products are ENROLLED by storing a few reference embeddings;
a live/uploaded frame is RECOGNIZED by cosine-similarity nearest-neighbour.

No GPU / PyTorch needed. Runs on the Jetson's CPU fast enough for ~1-2 fps scanning.
"""
import os
import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(_HERE, "..", "models", "dinov2_small.onnx")
# Cosine-similarity threshold above which a frame counts as a confident match,
# and the minimum lead the top product must have over the runner-up (so a frame
# only counts when ONE product clearly wins — prevents iPhone↔AirPods flips).
MATCH_THRESHOLD = float(os.getenv("SUMMIT_MATCH_THRESHOLD", "0.62"))
MATCH_MARGIN    = float(os.getenv("SUMMIT_MATCH_MARGIN", "0.035"))

_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
_STD = np.array([0.229, 0.224, 0.225], np.float32)
_sess = None

# Region-of-interest "hitbox" (x0, y0, x1, y1 as fractions of the frame). Only this
# centred region is embedded, so the product — not the background or the hand
# holding it — dominates the feature vector. MUST match the overlay box drawn on
# the frontend stream, and is applied identically at enroll and recognize time.
ROI = (0.215, 0.12, 0.785, 0.88)   # ~square in a 4:3 frame, centred


def crop_roi(bgr):
    """Crop a BGR frame to the centred ROI hitbox."""
    if bgr is None:
        return None
    h, w = bgr.shape[:2]
    x0, y0, x1, y1 = ROI
    c = bgr[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
    return c if c.size else bgr


def available():
    return os.path.exists(MODEL_PATH)


def _session():
    global _sess
    if _sess is None:
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        _sess = ort.InferenceSession(MODEL_PATH, sess_options=so,
                                     providers=["CPUExecutionProvider"])
    return _sess


def embed(image_bytes):
    """Photo bytes -> 384-dim L2-normalized embedding (np.float32), or None on failure."""
    import cv2
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)          # BGR
    if img is None:
        return None
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA)
    x = img.astype(np.float32) / 255.0
    x = (x - _MEAN) / _STD
    x = np.transpose(x, (2, 0, 1))[None]               # (1,3,224,224)
    out = _session().run(None, {"pixel_values": x})[0]  # (1, 257, 384)
    v = out[0, 0, :].astype(np.float32)                # CLS token
    n = float(np.linalg.norm(v))
    return (v / n) if n > 0 else v


def embed_frame(bgr):
    """Same as embed() but from an already-decoded BGR numpy frame (webcam path)."""
    import cv2
    img = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA)
    x = ((img.astype(np.float32) / 255.0) - _MEAN) / _STD
    x = np.transpose(x, (2, 0, 1))[None]
    out = _session().run(None, {"pixel_values": x})[0]
    v = out[0, 0, :].astype(np.float32)
    n = float(np.linalg.norm(v))
    return (v / n) if n > 0 else v


def match(vec, enrolled, threshold=None, margin=None):
    """vec: query embedding. enrolled: list of {sku, product, vec(list[float])}.
    Scores each PRODUCT by its best-matching reference (max cosine over its refs),
    then ranks products. Returns {sku, product, score, matched, runner_up, margin}.
    A frame counts (matched=True) only when the top product both clears the
    absolute threshold AND leads the runner-up by `margin` — so an ambiguous item
    is reported as unsure rather than miscounted."""
    empty = {"sku": None, "product": None, "score": 0.0, "matched": False,
             "runner_up": None, "margin": 0.0}
    if vec is None or not enrolled:
        return empty
    thr = MATCH_THRESHOLD if threshold is None else threshold
    mgn = MATCH_MARGIN if margin is None else margin
    by = {}   # product key -> best {sku, product, score}
    for e in enrolled:
        s = float(np.dot(vec, np.asarray(e["vec"], np.float32)))
        k = e["sku"] or e["product"]
        if k not in by or s > by[k]["score"]:
            by[k] = {"sku": e["sku"], "product": e["product"], "score": s}
    ranked = sorted(by.values(), key=lambda x: x["score"], reverse=True)
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    gap = best["score"] - (second["score"] if second else -1.0)
    matched = best["score"] >= thr and (second is None or gap >= mgn)
    return {"sku": best["sku"], "product": best["product"],
            "score": round(best["score"], 3), "matched": bool(matched),
            "runner_up": (second["product"] if second else None),
            "runner_up_sku": (second["sku"] if second else None),
            "margin": round(gap, 3) if second else None}
