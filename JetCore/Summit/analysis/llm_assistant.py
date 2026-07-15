"""llm_assistant.py -- local LLM (Ollama) assistant for Summit.

Adds a self-contained "AI Assistant" feature that runs a LOCAL model via Ollama on the
Jetson (no paid APIs). It is designed to be *connection-aware*: the frontend calls
``/api/llm/status`` and only shows the LLM UI when Ollama is actually reachable.

Data files are uploaded by the user (nothing is baked in) and can be deleted -- these
are the files the assistant reads when it analyzes.

Call ``register_llm_routes(app)`` from backend.py to wire in the routes.
"""
import os
import json
import glob
import urllib.request
import urllib.error

from flask import request, jsonify

# ── Config (env-overridable, offline-first) ───────────────────────────────────
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

# Where user-uploaded assistant files live (per user). Kept separate from the
# business database so uploading/deleting them never touches real Summit data.
_BASE = os.path.dirname(os.path.abspath(__file__))
DATA_ROOT = os.getenv("LLM_DATA_ROOT", os.path.join(os.path.dirname(_BASE), "llm_data"))

# Any of these are ingested by pandas and profiled/categorized for the model.
ALLOWED_EXT = (".csv", ".tsv", ".txt", ".json", ".ndjson", ".md",
               ".xlsx", ".xls", ".xlsm", ".parquet")
MAX_CHARS_PER_FILE = 12000   # only used for the non-tabular text fallback


# ── Ollama helpers ────────────────────────────────────────────────────────────
def llm_status():
    """Return {'connected': bool, 'model': str, 'models': [...]}.

    Never raises -- a down/unreachable Ollama simply reports connected=False so the
    UI can hide the LLM features while everything else keeps working.
    """
    try:
        req = urllib.request.Request(OLLAMA_URL + "/api/tags")
        with urllib.request.urlopen(req, timeout=3) as r:
            data = json.load(r)
        models = [m.get("name") for m in data.get("models", [])]
        return {"connected": True, "model": OLLAMA_MODEL, "models": models}
    except Exception:
        return {"connected": False, "model": OLLAMA_MODEL, "models": []}


def query_ollama(prompt, model=None, timeout=300):
    """Send a prompt to Ollama and return the text. Raises RuntimeError if down."""
    model = model or OLLAMA_MODEL
    payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode()
    req = urllib.request.Request(
        OLLAMA_URL + "/api/generate", data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp).get("response", "").strip()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError(f"Model '{model}' not installed in Ollama (try: ollama pull {model}).")
        raise RuntimeError(f"Ollama error HTTP {e.code}.")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Ollama is not reachable at {OLLAMA_URL} ({e.reason}).")


# ── File storage (per user) ───────────────────────────────────────────────────
def _user_dir(user_id):
    d = os.path.join(DATA_ROOT, str(int(user_id)))
    os.makedirs(d, exist_ok=True)
    return d


def _safe_name(name):
    """Strip any path components so uploads can't escape the user's folder."""
    return os.path.basename(name).replace("\\", "_").replace("/", "_")


def list_files(user_id):
    d = _user_dir(user_id)
    out = []
    for path in sorted(glob.glob(os.path.join(d, "*"))):
        if os.path.isfile(path):
            out.append({"name": os.path.basename(path), "size": os.path.getsize(path)})
    return out


def build_prompt(user_id, question):
    """Concatenate the user's uploaded files into a single analysis prompt."""
    files = list_files(user_id)
    if not files:
        return None
    parts = [
        "You are Summit's business operations assistant. Below is an auto-generated "
        "profile of the user's uploaded data files -- each column is categorized "
        "(numeric / date / categorical / text / identifier / boolean) with summary "
        "stats and sample rows. Analyze it and answer using ONLY this data "
        "(do not invent numbers).",
        "",
    ]
    d = _user_dir(user_id)
    for f in files:
        try:
            from analysis.data_profiler import profile_file
        except Exception:
            from data_profiler import profile_file   # when run from analysis/ dir
        parts.append(profile_file(os.path.join(d, f["name"])) + "\n")
    parts.append("")
    parts.append("QUESTION: " + (question or
                 "Summarize the key insights, anomalies, and 2-3 recommended actions."))
    return "\n".join(parts)


# ── Flask routes ──────────────────────────────────────────────────────────────
def register_llm_routes(app):
    """Attach the /api/llm/* routes to the given Flask app."""

    @app.route("/api/llm/status", methods=["GET"])
    def llm_status_route():
        return jsonify(llm_status())

    @app.route("/api/llm/files/<int:user_id>", methods=["GET"])
    def llm_list_files(user_id):
        return jsonify({"files": list_files(user_id)})

    @app.route("/api/llm/files/<int:user_id>", methods=["POST"])
    def llm_upload_file(user_id):
        if "file" not in request.files:
            return jsonify({"error": "no file provided"}), 400
        f = request.files["file"]
        name = _safe_name(f.filename or "")
        if not name or not name.lower().endswith(ALLOWED_EXT):
            return jsonify({"error": f"only {', '.join(ALLOWED_EXT)} files allowed"}), 400
        f.save(os.path.join(_user_dir(user_id), name))
        return jsonify({"ok": True, "files": list_files(user_id)})

    @app.route("/api/llm/files/<int:user_id>/<path:filename>", methods=["DELETE"])
    def llm_delete_file(user_id, filename):
        path = os.path.join(_user_dir(user_id), _safe_name(filename))
        if os.path.isfile(path):
            os.remove(path)
            return jsonify({"ok": True, "files": list_files(user_id)})
        return jsonify({"error": "file not found"}), 404

    @app.route("/api/llm/analyze/<int:user_id>", methods=["POST"])
    def llm_analyze(user_id):
        status = llm_status()
        if not status["connected"]:
            return jsonify({"error": "The local AI (Ollama) is not connected."}), 503
        question = (request.get_json(silent=True) or {}).get("question", "")
        prompt = build_prompt(user_id, question)
        if prompt is None:
            return jsonify({"error": "No files uploaded yet. Upload data first."}), 400
        try:
            answer = query_ollama(prompt, model=status["model"])
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 503
        return jsonify({"answer": answer, "model": status["model"]})

    return app
