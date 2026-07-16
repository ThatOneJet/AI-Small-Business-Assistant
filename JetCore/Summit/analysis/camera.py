"""camera.py — single shared USB-webcam manager for the live scan/count demo.

A background thread continuously grabs frames from cv2.VideoCapture so the MJPEG
livestream stays smooth and the recognizer always has the latest frame to embed.
The device is opened lazily on first use and auto-released after a period of
inactivity, so nothing holds the webcam when the scan page isn't open.

If no camera is present (nothing plugged in), latest_jpeg() returns a labelled
placeholder frame so the <img> on the page shows a clear message instead of
breaking — matches the demo brief ("livestream from the Jetson webcam to the
localhost page").
"""
import os
import time
import threading
import numpy as np

_CAM_INDEX = int(os.getenv("SUMMIT_CAMERA_INDEX", "0"))
_IDLE_RELEASE = 25.0        # seconds without access -> release the device
_OPEN_BACKOFF = 2.0         # min seconds between open attempts when it fails

_lock = threading.Lock()
_cap = None
_thread = None
_running = False
_latest = None              # latest BGR frame (numpy)
_latest_ts = 0.0
_last_access = 0.0
_last_attempt = 0.0
_open_error = None


def _placeholder(text):
    import cv2
    img = np.full((480, 640, 3), 22, np.uint8)
    cv2.rectangle(img, (0, 0), (639, 479), (48, 48, 56), 2)
    for i, line in enumerate(text.split("\n")):
        cv2.putText(img, line, (34, 210 + i * 40), cv2.FONT_HERSHEY_SIMPLEX,
                    0.72, (150, 150, 165), 1, cv2.LINE_AA)
    return img


def _reader():
    """Background loop: keep _latest fresh; exit when idle or on repeated failure."""
    global _latest, _latest_ts, _running
    import cv2  # noqa: F401  (ensures cv2 is loaded in this thread context)
    fail = 0
    while _running:
        cap = _cap
        if cap is None:
            break
        try:
            ok, frame = cap.read()
        except Exception:
            ok, frame = False, None
        if not ok or frame is None:
            fail += 1
            if fail > 40:
                break
            time.sleep(0.05)
            continue
        fail = 0
        with _lock:
            _latest = frame
            _latest_ts = time.time()
        if time.time() - _last_access > _IDLE_RELEASE:
            break
        time.sleep(0.01)
    _shutdown()


def _shutdown():
    global _cap, _running, _latest
    _running = False
    cap = _cap
    _cap = None
    _latest = None
    if cap is not None:
        try:
            cap.release()
        except Exception:
            pass


def _start():
    global _cap, _thread, _running, _open_error, _last_attempt
    import cv2
    _last_attempt = time.time()
    cap = cv2.VideoCapture(_CAM_INDEX)
    if not cap or not cap.isOpened():
        _open_error = f"no camera at index {_CAM_INDEX}"
        try:
            cap.release()
        except Exception:
            pass
        return False
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    _cap = cap
    _open_error = None
    _running = True
    t = threading.Thread(target=_reader, name="webcam-reader", daemon=True)
    globals()["_thread"] = t
    t.start()
    # give the first frame a moment to arrive
    for _ in range(40):
        if _latest is not None:
            break
        time.sleep(0.05)
    return True


def ensure_started():
    """Open the camera if needed (with a short backoff on failure). Returns True
    if the device is running."""
    global _last_access
    _last_access = time.time()
    if _running and _cap is not None:
        return True
    with _lock:
        if _running and _cap is not None:
            return True
        if time.time() - _last_attempt < _OPEN_BACKOFF:
            return False
        return _start()


def latest_frame():
    """Latest BGR frame (a copy), or None if the camera isn't available."""
    global _last_access
    _last_access = time.time()
    ensure_started()
    with _lock:
        return None if _latest is None else _latest.copy()


def latest_jpeg(quality=80):
    import cv2
    frame = latest_frame()
    if frame is None:
        frame = _placeholder("No webcam detected.\n"
                             "Plug a USB camera into the Jetson and reload.")
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buf.tobytes() if ok else b""


def mjpeg_generator(fps=15):
    """multipart/x-mixed-replace generator for a live <img> stream."""
    delay = 1.0 / max(1, fps)
    while True:
        jpg = latest_jpeg()
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
               b"Content-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
        time.sleep(delay)


def status():
    return {
        "running": bool(_running and _cap is not None),
        "index": _CAM_INDEX,
        "has_frame": _latest is not None,
        "error": _open_error,
    }
