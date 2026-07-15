from flask import Flask, render_template, request, jsonify, send_from_directory
from dotenv import load_dotenv
from sqlalchemy import func, or_, and_
import os
import json
import traceback
import time
import math
import jwt as pyjwt
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

import sys as _sys
if getattr(_sys, 'frozen', False):
    _BASE_DIR = _sys._MEIPASS
else:
    _BASE_DIR = os.path.dirname(__file__)

from plaid_client import client
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_get_request import ItemGetRequest
from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest
from plaid.model.institutions_get_by_id_request_options import InstitutionsGetByIdRequestOptions
from plaid.model.country_code import CountryCode
from plaid.model.products import Products
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
from plaid.model.accounts_get_request import AccountsGetRequest
from models import (
    User, PlaidItem, Subscription, ConnectedAccount,
    Recommendation, UsageLog, APICredential,
    ShiftData, TenderData, SalesData, TransactionData,
    ExpenseData, InventoryData, ReviewData, BusinessProfile,
    UserSettings, Workspace, init_db, get_db
)

REACT_DIR = os.path.join(_BASE_DIR, "static", "react")

app = Flask(__name__, static_folder=REACT_DIR, static_url_path="/static/react")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
app.secret_key = SECRET_KEY

# Local-LLM (Ollama) assistant -- adds /api/llm/* routes. Connection-aware: the UI
# hides the AI features when Ollama isn't reachable. Wrapped so it can never break
# the rest of Summit if the module or Ollama is unavailable.
try:
    from analysis.llm_assistant import register_llm_routes
    register_llm_routes(app)
except Exception as _llm_e:
    print(f"[llm] assistant routes not loaded: {_llm_e}")

ADMIN_EMAILS = {"thatonejet@jetcore.local", "srijoy@gmail.com"}
PRICING = {"individual": 9.99, "small_biz": 19.99, "restaurant": 24.99}

init_db()

# Backfill actual_hours from scheduled_hours for any pre-existing records
# that were synced before the actual_hours field was populated.
try:
    from sqlalchemy import text as _sqlt
    from models import engine as _engine
    with _engine.connect() as _c:
        _c.execute(_sqlt(
            "UPDATE shift_data "
            "SET actual_hours = scheduled_hours "
            "WHERE (actual_hours IS NULL OR actual_hours = 0) AND scheduled_hours > 0"
        ))
        _c.commit()
except Exception as _e:
    print(f"[startup] actual_hours backfill skipped: {_e}")

# Add is_important column if the database predates it
try:
    from sqlalchemy import text as _sqlt2
    from models import engine as _engine2
    with _engine2.connect() as _c2:
        _c2.execute(_sqlt2(
            "ALTER TABLE transaction_data ADD COLUMN is_important BOOLEAN NOT NULL DEFAULT 0"
        ))
        _c2.commit()
except Exception as _e2:
    pass  # column already exists — OperationalError is expected on any run after the first

# Add logo_url column if the database predates it
try:
    from sqlalchemy import text as _sqlt2b
    from models import engine as _engine2b
    with _engine2b.connect() as _c2b:
        _c2b.execute(_sqlt2b("ALTER TABLE transaction_data ADD COLUMN logo_url TEXT"))
        _c2b.commit()
except Exception:
    pass  # column already exists

# Add institution_id column if the database predates it
try:
    from sqlalchemy import text as _sqlt2c
    from models import engine as _engine2c
    with _engine2c.connect() as _c2c:
        _c2c.execute(_sqlt2c("ALTER TABLE transaction_data ADD COLUMN institution_id TEXT"))
        _c2c.commit()
except Exception:
    pass  # column already exists

# Add avatar column if the database predates it
try:
    from sqlalchemy import text as _sqlt_av
    from models import engine as _engine_av
    with _engine_av.connect() as _c_av:
        _c_av.execute(_sqlt_av("ALTER TABLE users ADD COLUMN avatar TEXT"))
        _c_av.commit()
except Exception:
    pass  # column already exists

# Add supabase_uid column if the database predates it (shell-authenticated mode:
# binds an Operations User to the signed-in JetCore/Supabase account).
try:
    from sqlalchemy import text as _sqlt_sb
    from models import engine as _engine_sb
    with _engine_sb.connect() as _c_sb:
        _c_sb.execute(_sqlt_sb("ALTER TABLE users ADD COLUMN supabase_uid TEXT"))
        _c_sb.commit()
except Exception:
    pass  # column already exists

# Add sales_data.check_number column if the database predates it (lets CSV imports
# record the order/check id so we can count distinct orders).
try:
    from sqlalchemy import text as _sqlt_cn
    from models import engine as _engine_cn
    with _engine_cn.connect() as _c_cn:
        _c_cn.execute(_sqlt_cn("ALTER TABLE sales_data ADD COLUMN check_number TEXT"))
        _c_cn.commit()
except Exception:
    pass  # column already exists

# Migrate: create user_settings table if it doesn't exist
try:
    from sqlalchemy import text as _sqlt_us
    from models import engine as _engine_us
    with _engine_us.connect() as _c_us:
        _c_us.execute(_sqlt_us(
            "CREATE TABLE IF NOT EXISTS user_settings "
            "(id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL, "
            "labor_threshold_pct REAL DEFAULT 35.0, alerts_enabled INTEGER DEFAULT 1, "
            "updated_at DATETIME)"
        ))
        _c_us.commit()
except Exception as _e_us:
    print(f"[startup] user_settings migration skipped: {_e_us}")

# Migrate: create workspaces table if it doesn't exist
try:
    from sqlalchemy import text as _sqlt_ws
    from models import engine as _engine_ws
    with _engine_ws.connect() as _c_ws:
        _c_ws.execute(_sqlt_ws(
            "CREATE TABLE IF NOT EXISTS workspaces "
            "(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, "
            "kind TEXT DEFAULT 'location', plan TEXT DEFAULT 'free', "
            "segment TEXT DEFAULT 'restaurant', is_active BOOLEAN DEFAULT 0, "
            "created_at DATETIME, updated_at DATETIME)"
        ))
        _c_ws.commit()
except Exception as _e_ws:
    print(f"[startup] workspaces migration skipped: {_e_ws}")

# Grant admin to known admin emails that may have registered before the flag was set
try:
    from sqlalchemy import text as _sqlt3
    from models import engine as _engine3
    _admin_list = ", ".join(f"'{e}'" for e in ADMIN_EMAILS)
    with _engine3.connect() as _c3:
        _c3.execute(_sqlt3(f"UPDATE users SET is_admin = 1 WHERE LOWER(email) IN ({_admin_list})"))
        _c3.commit()
except Exception as _e3:
    print(f"[startup] admin grant skipped: {_e3}")

# ── In-memory structured log buffer ──────────────────────────────────────────
import collections, threading as _threading
_log_lock   = _threading.Lock()
_log_buffer = collections.deque(maxlen=1000)

def _add_log(level, category, message, details=None):
    entry = {
        "ts":       datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "level":    level,
        "category": category,
        "message":  message,
        "details":  details or {},
    }
    with _log_lock:
        _log_buffer.append(entry)
    print(f"[{level}] [{category}] {message}")

link_token_cache   = {"token": None, "products": None, "expiry": 0}
institution_logo_cache = {}
_balance_cache  = {}  # user_id -> (balance, expiry_ts)
_sync_progress  = {}  # user_id -> {done, total, status, started_ts}


def _get_plaid_balance(user_id, db):
    now = time.time()
    if user_id in _balance_cache:
        bal, exp = _balance_cache[user_id]
        if now < exp:
            return bal
    items = db.query(PlaidItem).filter_by(user_id=user_id).all()
    total = 0.0
    for item in items:
        try:
            resp = client.accounts_get(AccountsGetRequest(access_token=item.access_token)).to_dict()
            for acct in resp.get("accounts", []):
                total += acct.get("balances", {}).get("current") or 0
        except Exception as e:
            print(f"[Balance] {e}")
    result = round(total, 2)
    _balance_cache[user_id] = (result, now + 300)
    return result


# ── JWT helpers ──────────────────────────────────────────────────────────────

def generate_jwt(user_id: int) -> str:
    return pyjwt.encode(
        {"user_id": user_id, "exp": datetime.utcnow() + timedelta(days=30)},
        SECRET_KEY, algorithm="HS256"
    )


def decode_jwt(token: str):
    try:
        return pyjwt.decode(token, SECRET_KEY, algorithms=["HS256"])["user_id"]
    except Exception:
        return None


def _user_plan(db, user_id: int) -> str:
    # Plans removed — everyone is the top tier so all features are unlocked.
    return "enterprise"


# ── Shell-authenticated single-user mode ─────────────────────────────────────
# When embedded under the JetCore (Decks) shell, the shell spawns this backend on
# loopback and is the ONLY caller, passing the signed-in Supabase identity via the
# environment (JETCORE_USER_ID / JETCORE_USER_EMAIL). In that mode we trust that
# identity and scope ALL data to a single Operations User keyed by supabase_uid —
# instead of this app's own standalone email/password login. Standalone use (no
# JETCORE_USER_ID) keeps the normal JWT path untouched.

def _shell_uid() -> str | None:
    """The signed-in Supabase user id when running embedded, else None."""
    uid = os.environ.get("JETCORE_USER_ID")
    return uid or None


def is_shell_mode() -> bool:
    return _shell_uid() is not None


def get_shell_user(db):
    """Find-or-create the Operations User bound to the shell's Supabase identity.

    Auto-provisions on first use. The bound user owns ALL data in shell mode, so
    every authenticated endpoint resolves the current user through this.
    """
    sb_uid = _shell_uid()
    if not sb_uid:
        return None
    user = db.query(User).filter_by(supabase_uid=sb_uid).first()
    if user:
        return user
    email = (os.environ.get("JETCORE_USER_EMAIL") or f"{sb_uid}@jetcore.local").strip().lower()
    # If a standalone user already exists with this email, adopt it (link the
    # Supabase id) rather than create a duplicate / collide on the unique email.
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user:
        if not user.supabase_uid:
            user.supabase_uid = sb_uid
            db.commit()
        return user
    user = User(
        email=email,
        supabase_uid=sb_uid,
        password_hash="!shell",  # no password login in shell mode (unusable hash)
        is_admin=(email in ADMIN_EMAILS),
    )
    db.add(user)
    db.commit()
    db.add(Subscription(user_id=user.id, plan="free", status="active"))
    db.commit()
    print(f"[ShellAuth] provisioned Operations user {user.id} for supabase_uid={sb_uid}")
    return user


def effective_user_id(db, raw_user_id):
    """Resolve the user_id a request should act on. In shell mode this is ALWAYS
    the bound shell user (ignoring the supplied id, so body/query-supplied ids can
    never reach another account); standalone returns the supplied id unchanged.
    Used by endpoints that read user_id from the body/query rather than the path
    (which is already forced in _before)."""
    if is_shell_mode():
        su = get_shell_user(db)
        if su is not None:
            return su.id
    return raw_user_id


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.route("/api/signup", methods=["POST"])
def signup():
    db = get_db()
    try:
        data = request.json or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        segment = data.get("segment", "individual")
        first_name = data.get("first_name", "")
        last_name = data.get("last_name", "")
        company_name = data.get("company_name", "")

        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        if db.query(User).filter(func.lower(User.email) == email).first():
            return jsonify({"error": "Email already registered"}), 400

        user = User(
            email=email,
            password_hash=generate_password_hash(password),
            first_name=first_name,
            last_name=last_name,
            company_name=company_name,
            segment=segment,
            is_admin=(email in ADMIN_EMAILS)
        )
        db.add(user)
        db.commit()

        db.add(Subscription(user_id=user.id, plan="free", status="active"))
        db.commit()

        print(f"[Signup] {email} ({segment})")
        return jsonify({
            "token": generate_jwt(user.id),
            "user_id": user.id, "email": user.email,
            "first_name": user.first_name, "segment": user.segment,
            "plan": "free", "is_admin": user.is_admin
        })

    except Exception as e:
        db.rollback()
        print(f"[Signup] ERROR: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/login", methods=["POST"])
def login():
    db = get_db()
    try:
        data = request.json or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400

        user = db.query(User).filter(func.lower(User.email) == email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid email or password"}), 401

        plan = _user_plan(db, user.id)
        print(f"[Login] {email}")
        return jsonify({
            "token": generate_jwt(user.id),
            "user_id": user.id, "email": user.email,
            "first_name": user.first_name, "segment": user.segment,
            "plan": plan, "is_admin": user.is_admin,
            "avatar": user.avatar or "",
        })

    except Exception as e:
        print(f"[Login] ERROR: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/verify_token", methods=["GET"])
def verify_token():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    user_id = decode_jwt(token)
    if not user_id:
        return jsonify({"valid": False}), 401

    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"valid": False}), 401
        plan = _user_plan(db, user_id)
        return jsonify({
            "valid": True, "user_id": user_id, "email": user.email,
            "first_name": user.first_name, "segment": user.segment,
            "plan": plan, "is_admin": user.is_admin,
            "avatar": user.avatar or "",
        })
    finally:
        db.close()


@app.route("/api/jetcore_session", methods=["GET"])
def jetcore_session():
    """Shell-mode auto-session: when running embedded under the JetCore shell
    (JETCORE_USER_ID set), find-or-create the bound Operations user and hand the
    embedded frontend a JWT + the numeric user_id, so its existing axios
    Authorization + path-scoped (/api/.../<user_id>) flow works with no manual
    login. Returns 404 when NOT in shell mode (standalone keeps email/password)."""
    if not is_shell_mode():
        return jsonify({"error": "Not in shell mode"}), 404
    db = get_db()
    try:
        user = get_shell_user(db)
        if not user:
            return jsonify({"error": "Not in shell mode"}), 404
        plan = _user_plan(db, user.id)
        return jsonify({
            "token": generate_jwt(user.id),
            "user_id": user.id, "email": user.email,
            "first_name": user.first_name, "segment": user.segment,
            "plan": plan, "is_admin": user.is_admin,
            "avatar": user.avatar or "",
        })
    finally:
        db.close()


# ── Cross-device cloud sync (E2EE snapshot) ──────────────────────────────────
# Operations data lives in a LOCAL SQLite DB per machine and never touches the
# cloud directly. To make it cross-device, the Electron shell pulls this export
# on login, encrypts it with the account's vault key (DEK), and stores the
# ciphertext in Supabase; on another device it decrypts and POSTs it back to
# /api/jetcore_import. The snapshot DOES contain secrets (Homebase api_key, Plaid
# access tokens), which is exactly why the shell must encrypt it before upload —
# Supabase only ever sees ciphertext.
#
# Per-user business data worth syncing. Identity/billing/telemetry (users,
# subscriptions, usage_logs) and regenerated rows (recommendations) are excluded.
_SYNC_TABLES = [
    "api_credentials", "plaid_items", "connected_accounts",
    "sales_data", "labor_data", "shift_data", "tender_data",
    "transaction_data", "expense_data", "user_settings", "workspaces",
]


def _shell_uid_or_none():
    """Resolve the bound shell user's numeric id, or None if not in shell mode."""
    if not is_shell_mode():
        return None
    db = get_db()
    try:
        user = get_shell_user(db)
        return user.id if user else None
    finally:
        db.close()


@app.route("/api/jetcore_export", methods=["GET"])
def jetcore_export():
    """Dump every synced table for the bound shell user as plain JSON (id/user_id
    stripped). The shell encrypts this before it leaves the machine."""
    uid = _shell_uid_or_none()
    if uid is None:
        return jsonify({"error": "Not in shell mode"}), 404
    import sqlite3 as _sq
    from models import engine as _eng
    con = _sq.connect(_eng.url.database)
    con.row_factory = _sq.Row
    out, total = {}, 0
    try:
        for t in _SYNC_TABLES:
            try:
                cur = con.execute(f"SELECT * FROM {t} WHERE user_id = ?", (uid,))
            except Exception:
                out[t] = []
                continue
            rows = [{k: r[k] for k in r.keys() if k not in ("id", "user_id")}
                    for r in cur.fetchall()]
            out[t] = rows
            total += len(rows)
    finally:
        con.close()
    return jsonify({"v": 1, "tables": out, "row_count": total})


@app.route("/api/jetcore_import", methods=["POST"])
def jetcore_import():
    """Replace the bound shell user's synced tables with the provided snapshot
    (transactional: all-or-nothing). A table absent from the snapshot is left
    untouched; a table present but empty is cleared."""
    uid = _shell_uid_or_none()
    if uid is None:
        return jsonify({"error": "Not in shell mode"}), 404
    tables = (request.get_json(silent=True) or {}).get("tables") or {}
    import sqlite3 as _sq
    from models import engine as _eng
    con = _sq.connect(_eng.url.database)
    applied = {}
    try:
        con.execute("BEGIN IMMEDIATE")
        for t in _SYNC_TABLES:
            rows = tables.get(t)
            if rows is None:
                continue  # not in snapshot → leave local rows as-is
            valid = {c[1] for c in con.execute(f"PRAGMA table_info({t})").fetchall()}
            if not valid:
                continue  # table doesn't exist locally
            con.execute(f"DELETE FROM {t} WHERE user_id = ?", (uid,))
            n = 0
            for row in rows:
                keys = [k for k in row.keys() if k in valid and k != "id"]
                cols = ["user_id"] + keys
                vals = [uid] + [row[k] for k in keys]
                con.execute(
                    f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join(['?'] * len(cols))})",
                    vals,
                )
                n += 1
            applied[t] = n
        con.commit()
    except Exception as e:
        con.rollback()
        con.close()
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    con.close()
    return jsonify({"success": True, "applied": applied})


# ── User profile ─────────────────────────────────────────────────────────────

@app.route("/api/user/<int:user_id>", methods=["GET"])
def get_user(user_id):
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        plan = _user_plan(db, user_id)
        return jsonify({
            "id": user.id, "email": user.email,
            "first_name": user.first_name, "last_name": user.last_name,
            "company_name": user.company_name, "segment": user.segment,
            "plan": plan, "is_admin": user.is_admin,
            "avatar": user.avatar or "",
            "created_at": user.created_at.isoformat()
        })
    finally:
        db.close()


@app.route("/api/user/<int:user_id>/avatar", methods=["PUT"])
def update_avatar(user_id):
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        data = request.json or {}
        user.avatar = data.get("avatar") or None
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@app.route("/api/user/<int:user_id>/segment", methods=["PUT"])
def update_segment(user_id):
    db = get_db()
    try:
        data        = request.json or {}
        password    = data.get("password", "")
        new_segment = data.get("segment", "")
        email       = data.get("email", "").strip().lower()

        # Look up by email if provided (more reliable than uid alone), else by uid
        if email:
            user = db.query(User).filter_by(email=email).first()
        else:
            user = db.query(User).filter_by(id=user_id).first()

        if not user:
            return jsonify({"error": "Account not found"}), 404
        if not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Incorrect password"}), 401
        if new_segment not in ("individual", "small_biz", "restaurant"):
            return jsonify({"error": "Invalid account type"}), 400
        user.segment = new_segment
        db.commit()
        return jsonify({"segment": user.segment})
    finally:
        db.close()


# ── Workspaces (locations / expense accounts) ─────────────────────────────────

_VALID_WS_KINDS = ("location", "expense_account")
_VALID_WS_PLANS = ("free", "plus", "pro", "max", "enterprise")
_VALID_WS_SEGMENTS = ("individual", "small_biz", "restaurant")


def _ws_dict(ws):
    return {
        "id": ws.id,
        "user_id": ws.user_id,
        "name": ws.name,
        "kind": ws.kind,
        "plan": ws.plan,
        "segment": ws.segment,
        "is_active": bool(ws.is_active),
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
    }


def _ensure_default_workspace(db, user):
    """Make sure the user always has at least one workspace. Returns the active one."""
    existing = db.query(Workspace).filter_by(user_id=user.id).order_by(Workspace.id).all()
    if existing:
        active = next((w for w in existing if w.is_active), None)
        if not active:
            existing[0].is_active = True
            db.commit()
            active = existing[0]
        return active
    # Seed a default workspace mirroring the user's current account/plan
    name = user.company_name or (user.first_name and f"{user.first_name}'s Workspace") or "My Workspace"
    ws = Workspace(
        user_id=user.id,
        name=name,
        kind="location" if user.segment == "restaurant" else "expense_account",
        plan=_user_plan(db, user.id),
        segment=user.segment or "restaurant",
        is_active=True,
    )
    db.add(ws)
    db.commit()
    return ws


@app.route("/api/workspaces/<int:user_id>", methods=["GET"])
def list_workspaces(user_id):
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        _ensure_default_workspace(db, user)
        rows = db.query(Workspace).filter_by(user_id=user_id).order_by(Workspace.id).all()
        return jsonify([_ws_dict(w) for w in rows])
    finally:
        db.close()


@app.route("/api/workspaces/<int:user_id>", methods=["POST"])
def create_workspace(user_id):
    db = get_db()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        data    = request.json or {}
        name    = (data.get("name") or "").strip()
        kind    = data.get("kind", "location")
        plan    = data.get("plan", "free")
        segment = data.get("segment", user.segment or "restaurant")

        if not name:
            return jsonify({"error": "Name is required"}), 400
        if kind not in _VALID_WS_KINDS:
            return jsonify({"error": "Invalid type"}), 400
        if plan not in _VALID_WS_PLANS:
            return jsonify({"error": "Invalid plan"}), 400
        if segment not in _VALID_WS_SEGMENTS:
            segment = "restaurant"

        # Make sure a default exists first (so the new one isn't the only one if seeding was pending)
        _ensure_default_workspace(db, user)

        # New workspace becomes active; deactivate the rest.
        db.query(Workspace).filter_by(user_id=user_id, is_active=True).update({"is_active": False})
        ws = Workspace(
            user_id=user_id, name=name, kind=kind, plan=plan,
            segment=segment, is_active=True,
        )
        db.add(ws)
        db.commit()
        print(f"[Workspace] created '{name}' ({kind}, {plan}) for user {user_id}")
        return jsonify(_ws_dict(ws))
    except Exception as e:
        db.rollback()
        print(f"[Workspace] create ERROR: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/workspaces/<int:user_id>/<int:workspace_id>/select", methods=["POST"])
def select_workspace(user_id, workspace_id):
    db = get_db()
    try:
        ws = db.query(Workspace).filter_by(id=workspace_id, user_id=user_id).first()
        if not ws:
            return jsonify({"error": "Workspace not found"}), 404
        db.query(Workspace).filter_by(user_id=user_id, is_active=True).update({"is_active": False})
        ws.is_active = True
        db.commit()
        return jsonify(_ws_dict(ws))
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/workspaces/<int:user_id>/<int:workspace_id>", methods=["DELETE"])
def delete_workspace(user_id, workspace_id):
    db = get_db()
    try:
        rows = db.query(Workspace).filter_by(user_id=user_id).order_by(Workspace.id).all()
        if len(rows) <= 1:
            return jsonify({"error": "Cannot delete your only workspace"}), 400
        ws = next((w for w in rows if w.id == workspace_id), None)
        if not ws:
            return jsonify({"error": "Workspace not found"}), 404
        was_active = ws.is_active
        db.delete(ws)
        db.commit()
        if was_active:
            remaining = db.query(Workspace).filter_by(user_id=user_id).order_by(Workspace.id).first()
            if remaining:
                remaining.is_active = True
                db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Recommendations ───────────────────────────────────────────────────────────

@app.route("/api/recommendations/<int:user_id>", methods=["GET"])
def get_recommendations(user_id):
    db = get_db()
    try:
        recs = (db.query(Recommendation)
                .filter_by(user_id=user_id)
                .order_by(Recommendation.monthly_savings.desc())
                .all())
        return jsonify([{
            "id": r.id, "category": r.category, "title": r.title,
            "description": r.description, "monthly_savings": r.monthly_savings,
            "implementation_difficulty": r.implementation_difficulty,
            "ai_confidence": r.ai_confidence, "is_implemented": r.is_implemented,
            "actual_savings": r.actual_savings,
            "created_at": r.created_at.isoformat()
        } for r in recs])
    finally:
        db.close()


@app.route("/api/recommendations/<int:rec_id>/implement", methods=["PATCH"])
def implement_recommendation(rec_id):
    db = get_db()
    try:
        rec = db.query(Recommendation).filter_by(id=rec_id).first()
        if not rec:
            return jsonify({"error": "Not found"}), 404
        data = request.json or {}
        rec.is_implemented = data.get("is_implemented", True)
        if data.get("actual_savings") is not None:
            rec.actual_savings = data["actual_savings"]
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ── API Credentials ───────────────────────────────────────────────────────────

@app.route("/api/credentials/<int:user_id>", methods=["GET"])
def list_credentials(user_id):
    db = get_db()
    try:
        creds = db.query(APICredential).filter_by(user_id=user_id, is_active=True).all()
        result = []
        for c in creds:
            cfg = json.loads(c.config_json or "{}")
            # Never return secrets — mask them
            safe_cfg = {k: ("***" if "secret" in k.lower() or "key" in k.lower() or "password" in k.lower() else v)
                        for k, v in cfg.items()}
            result.append({
                "id": c.id, "service": c.service, "config": safe_cfg,
                "last_synced": c.last_synced.isoformat() if c.last_synced else None,
                "created_at": c.created_at.isoformat()
            })
        return jsonify(result)
    finally:
        db.close()


@app.route("/api/credentials", methods=["POST"])
def save_credential():
    db = get_db()
    try:
        data = request.json or {}
        user_id = effective_user_id(db, data.get("user_id"))
        service = data.get("service")
        config = data.get("config", {})

        if not user_id or not service:
            return jsonify({"error": "user_id and service required"}), 400

        existing = db.query(APICredential).filter_by(user_id=user_id, service=service).first()
        if existing:
            existing.config_json = json.dumps(config)
            existing.is_active = True
        else:
            db.add(APICredential(user_id=user_id, service=service, config_json=json.dumps(config)))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@app.route("/api/credentials/<int:cred_id>", methods=["DELETE"])
def delete_credential(cred_id):
    db = get_db()
    try:
        cred = db.query(APICredential).filter_by(id=cred_id).first()
        if cred:
            cred.is_active = False
            db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@app.route("/api/credentials/verify", methods=["POST"])
def verify_credential():
    """Verify credentials against the service, then save them if user_id is provided."""
    data = request.json or {}
    service = data.get("service")
    config = data.get("config", {})
    user_id = data.get("user_id")

    try:
        if service == "homebase":
            from integrations.homebase import HomebaseClient
            c = HomebaseClient(config["api_key"])
            info = c.verify()

        elif service == "oracle":
            from integrations.oracle import OracleClient
            c = OracleClient(
                environment_url=config["environment_url"],
                client_id=config["client_id"],
                client_secret=config["client_secret"],
                location_ref=config["location_ref"],
                auth_type=config.get("auth_type", "oauth")
            )
            info = c.verify()

        else:
            return jsonify({"error": f"Unknown service: {service}"}), 400

        # Save credentials after successful verification
        if user_id or is_shell_mode():
            db = get_db()
            try:
                user_id = effective_user_id(db, user_id)  # force shell user when embedded
                existing = db.query(APICredential).filter_by(user_id=user_id, service=service).first()
                if existing:
                    existing.config_json = json.dumps(config)
                    existing.is_active = True
                else:
                    db.add(APICredential(user_id=user_id, service=service, config_json=json.dumps(config)))

                ca = db.query(ConnectedAccount).filter_by(user_id=user_id, service=service).first()
                if not ca:
                    names = {"homebase": "Homebase", "oracle": "Oracle MICROS"}
                    db.add(ConnectedAccount(
                        user_id=user_id, service=service,
                        account_name=names.get(service, service.title()),
                        institution_name=names.get(service, service.title()),
                    ))
                db.commit()
            finally:
                db.close()

        return jsonify({"success": True, "info": str(info)[:200]})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


# ── Data Sync ─────────────────────────────────────────────────────────────────

@app.route("/api/debug/homebase/<int:user_id>", methods=["GET"])
def debug_homebase(user_id):
    """Return raw Homebase API responses for field inspection."""
    db = get_db()
    try:
        cred = db.query(APICredential).filter_by(user_id=user_id, service="homebase", is_active=True).first()
        if not cred:
            return jsonify({"error": "Homebase not connected"}), 404
        config = json.loads(cred.config_json)
        from integrations.homebase import HomebaseClient
        from datetime import timezone, timedelta
        client_hb = HomebaseClient(config["api_key"])
        locations = client_hb.get_locations()
        loc_uuid = (locations[0].get("uuid") or locations[0].get("id") or str(locations[0].get("location_id", ""))) if locations else None
        result = {"locations_raw": locations[:2]}
        if loc_uuid:
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=30)
            try:
                sh = client_hb.get_shifts(loc_uuid, start, end)
                result["shifts_raw"] = sh[:2]
            except Exception as e:
                result["shifts_error"] = str(e)
            try:
                emp = client_hb.get_employees(loc_uuid)
                result["employees_raw"] = emp[:2]
            except Exception as e:
                result["employees_error"] = str(e)
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/sync/homebase/<int:user_id>", methods=["POST"])
def sync_homebase(user_id):
    db = get_db()
    key = f"homebase_{user_id}"
    try:
        cred = db.query(APICredential).filter_by(user_id=user_id, service="homebase", is_active=True).first()
        if not cred:
            return jsonify({"error": "Homebase not connected"}), 404

        config = json.loads(cred.config_json)
        days = (request.json or {}).get("days", 30)
        total_chunks = math.ceil(days / 30)
        _sync_progress[key] = {"done": 0, "total": total_chunks, "status": "running", "started_ts": time.time()}

        def progress_cb(done_chunks):
            _sync_progress[key]["done"] = done_chunks

        from integrations.homebase import HomebaseClient
        client_hb = HomebaseClient(config["api_key"])
        result = client_hb.sync_to_db(user_id, days, db, progress_cb=progress_cb)
        _sync_progress[key]["done"] = _sync_progress[key]["total"]
        _sync_progress[key]["status"] = "done"

        cred.last_synced = datetime.utcnow()
        ca = db.query(ConnectedAccount).filter_by(user_id=user_id, service="homebase").first()
        if ca:
            ca.last_synced = datetime.utcnow()
        db.commit()

        print(f"[Sync/Homebase] user={user_id} result={result}")
        return jsonify({"success": True, **result})

    except Exception as e:
        _sync_progress[key] = {"status": "error", "done": 0, "total": 0, "started_ts": time.time()}
        print(f"[Sync/Homebase] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/sync/oracle/<int:user_id>", methods=["POST"])
def sync_oracle(user_id):
    db = get_db()
    key = f"oracle_{user_id}"
    _sync_progress[key] = {"done": 0, "total": 3, "status": "running", "started_ts": time.time()}
    try:
        cred = db.query(APICredential).filter_by(user_id=user_id, service="oracle", is_active=True).first()
        if not cred:
            return jsonify({"error": "Oracle not connected"}), 404

        config = json.loads(cred.config_json)
        days = (request.json or {}).get("days", 30)

        from integrations.oracle import OracleClient
        client_ora = OracleClient(
            environment_url=config["environment_url"],
            client_id=config["client_id"],
            client_secret=config["client_secret"],
            location_ref=config["location_ref"],
            auth_type=config.get("auth_type", "oauth")
        )

        def progress_cb(step):
            _sync_progress[key]["done"] = step

        result = client_ora.sync_to_db(user_id, days, db, progress_cb=progress_cb)
        _sync_progress[key]["done"] = 3
        _sync_progress[key]["status"] = "done"

        cred.last_synced = datetime.utcnow()
        ca = db.query(ConnectedAccount).filter_by(user_id=user_id, service="oracle").first()
        if ca:
            ca.last_synced = datetime.utcnow()
        db.commit()

        print(f"[Sync/Oracle] user={user_id} result={result}")
        return jsonify({"success": True, **result})

    except Exception as e:
        _sync_progress[key] = {"status": "error", "done": 0, "total": 0, "started_ts": time.time()}
        print(f"[Sync/Oracle] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/transactions/important-by-merchant", methods=["POST"])
def set_important_by_merchant():
    db = get_db()
    try:
        body = request.json or {}
        user_id    = effective_user_id(db, body.get("user_id"))
        name       = body.get("merchant_name")  # the display name (merchant_name OR description)
        is_imp     = bool(body.get("is_important", False))
        if not user_id or name is None:
            return jsonify({"error": "user_id and merchant_name required"}), 400
        # match rows where merchant_name == name, OR (merchant_name is null AND description == name)
        txns = db.query(TransactionData).filter(
            TransactionData.user_id == user_id,
            or_(
                TransactionData.merchant_name == name,
                and_(TransactionData.merchant_name == None, TransactionData.description == name),
            )
        ).all()
        for t in txns:
            t.is_important = is_imp
        db.commit()
        return jsonify({"updated": len(txns)})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/transactions/<int:user_id>", methods=["GET"])
def get_transactions(user_id):
    db = get_db()
    try:
        days = int(request.args.get("days", 90))
        cutoff = datetime.utcnow() - timedelta(days=days)
        cutoff_str = cutoff.strftime("%Y-%m-%d")

        txns = db.query(TransactionData).filter(
            TransactionData.user_id == user_id,
            TransactionData.date >= cutoff,
        ).order_by(TransactionData.date.desc()).all()

        # All transactions needed for running balance calculation
        all_txns = db.query(TransactionData).filter_by(user_id=user_id).all()

        current_balance = _get_plaid_balance(user_id, db)

        # Build daily income/expense map from all history
        daily_map = {}
        for t in all_txns:
            d = t.date.strftime("%Y-%m-%d")
            if d not in daily_map:
                daily_map[d] = {"income": 0.0, "expenses": 0.0}
            if t.is_deposit:
                daily_map[d]["income"] += t.amount
            else:
                daily_map[d]["expenses"] += t.amount

        # Walk backwards from today to compute balance at each past date
        balance_by_date = {}
        running = current_balance
        for d in sorted(daily_map.keys(), reverse=True):
            balance_by_date[d] = round(running, 2)
            running += daily_map[d]["expenses"] - daily_map[d]["income"]

        chart_data = [{
            "date": d,
            "income":   round(daily_map[d]["income"], 2),
            "expenses": round(daily_map[d]["expenses"], 2),
            "balance":  balance_by_date.get(d, 0),
        } for d in sorted(d for d in daily_map if d >= cutoff_str)]

        total_income   = sum(t.amount for t in txns if t.is_deposit)
        total_expenses = sum(t.amount for t in txns if not t.is_deposit)

        return jsonify({
            "transactions": [{
                "id":             t.id,
                "date":           t.date.strftime("%Y-%m-%d"),
                "description":    t.description,
                "merchant_name":  t.merchant_name,
                "logo_url":       t.logo_url,
                "institution_id": t.institution_id,
                "amount":         t.amount,
                "is_deposit":     t.is_deposit,
                "is_important":   t.is_important,
            } for t in txns],
            "chart_data":      chart_data,
            "current_balance": current_balance,
            "totals": {
                "income":   round(total_income, 2),
                "expenses": round(total_expenses, 2),
                "net":      round(total_income - total_expenses, 2),
            },
        })
    except Exception as e:
        print(f"[Transactions] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/sync/plaid/progress/<int:user_id>", methods=["GET"])
def sync_plaid_progress(user_id):
    p = _sync_progress.get(user_id)
    if not p:
        return jsonify({"status": "idle"})
    elapsed = time.time() - p["started_ts"]
    done, total = p["done"], p["total"]
    pct = round(done / total * 100) if total else 0
    eta = None
    if done > 0 and total > 0 and done < total:
        rate = done / elapsed          # transactions per second
        eta  = round((total - done) / rate)
    return jsonify({
        "status":  p["status"],
        "done":    done,
        "total":   total,
        "pct":     pct,
        "eta_sec": eta,
    })


@app.route("/api/sync/progress/<service>/<int:user_id>", methods=["GET"])
def sync_service_progress(service, user_id):
    key = f"{service}_{user_id}"
    p = _sync_progress.get(key)
    if not p:
        return jsonify({"status": "idle"})
    elapsed = time.time() - p["started_ts"]
    done, total = p.get("done", 0), p.get("total", 1)
    pct = round(done / max(total, 1) * 100)
    eta = None
    if done > 0 and done < total and elapsed > 0:
        rate = done / elapsed
        if rate > 0:
            eta = max(0, round((total - done) / rate))
    return jsonify({
        "status":  p["status"],
        "done":    done,
        "total":   total,
        "pct":     pct,
        "eta_sec": eta,
    })


@app.route("/api/sync/plaid/<int:user_id>", methods=["POST"])
def sync_plaid(user_id):
    db = get_db()
    _sync_progress[user_id] = {"done": 0, "total": 0, "status": "running", "started_ts": time.time()}
    try:
        items = db.query(PlaidItem).filter_by(user_id=user_id).all()
        if not items:
            _sync_progress.pop(user_id, None)
            return jsonify({"error": "No Plaid accounts connected"}), 404

        days = (request.json or {}).get("days", 90)
        end_dt   = datetime.utcnow().date()
        start_dt = (datetime.utcnow() - timedelta(days=days)).date()

        new_count = 0
        for item in items:
            offset = 0
            item_total = None
            while True:
                opts = TransactionsGetRequestOptions(offset=offset, count=500)
                resp = client.transactions_get(TransactionsGetRequest(
                    access_token=item.access_token,
                    start_date=start_dt,
                    end_date=end_dt,
                    options=opts,
                )).to_dict()

                if item_total is None:
                    item_total = resp.get("total_transactions", 0)
                    _sync_progress[user_id]["total"] = max(item_total, 1)

                txns = resp.get("transactions", [])
                for t in txns:
                    ext_id = t["transaction_id"]
                    existing = db.query(TransactionData).filter_by(external_id=ext_id).first()
                    is_dep = t["amount"] < 0
                    # logo_url: Plaid may provide it directly or via counterparties
                    logo_url = t.get("logo_url") or (
                        (t.get("counterparties") or [{}])[0].get("logo_url")
                    )
                    if existing:
                        existing.amount     = abs(t["amount"])
                        existing.is_deposit = is_dep
                        if logo_url and not existing.logo_url:
                            existing.logo_url = logo_url
                    else:
                        db.add(TransactionData(
                            user_id=user_id,
                            external_id=ext_id,
                            account_id=t.get("account_id"),
                            institution_name=item.institution_name,
                            institution_id=item.institution_id,
                            date=datetime.combine(t["date"], datetime.min.time()),
                            amount=abs(t["amount"]),
                            description=t.get("name"),
                            merchant_name=t.get("merchant_name"),
                            logo_url=logo_url,
                            is_deposit=is_dep,
                        ))
                        new_count += 1

                offset += len(txns)
                _sync_progress[user_id]["done"] = offset
                if offset >= resp.get("total_transactions", 0) or not txns:
                    break

        for ca in db.query(ConnectedAccount).filter_by(user_id=user_id, service="plaid").all():
            ca.last_synced = datetime.utcnow()
        db.commit()

        _sync_progress[user_id]["status"] = "done"
        print(f"[Sync/Plaid] user={user_id} new_transactions={new_count}")
        return jsonify({"success": True, "transactions": new_count})

    except Exception as e:
        _sync_progress[user_id] = {"status": "error", "done": 0, "total": 0, "started_ts": time.time()}
        print(f"[Sync/Plaid] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/finances/<int:user_id>", methods=["GET"])
def get_finances(user_id):
    db = get_db()
    try:
        days   = int(request.args.get("days", 30))
        cutoff = datetime.utcnow() - timedelta(days=days)

        # ── Live balances (cached) ───────────────────────────────────────────
        total_balance = _get_plaid_balance(user_id, db)

        # ── Transactions from DB ─────────────────────────────────────────────
        txns = db.query(TransactionData).filter(
            TransactionData.user_id == user_id,
            TransactionData.date >= cutoff,
        ).order_by(TransactionData.date.desc()).all()

        deposits  = sum(t.amount for t in txns if t.is_deposit)
        large_out = [
            {
                "date":        t.date.strftime("%Y-%m-%d"),
                "amount":      t.amount,
                "description": t.merchant_name or t.description or "—",
            }
            for t in txns if not t.is_deposit and t.amount >= 500
        ]

        daily_deposits = {}
        for t in txns:
            if t.is_deposit:
                key = t.date.strftime("%Y-%m-%d")
                daily_deposits[key] = round(daily_deposits.get(key, 0) + t.amount, 2)

        daily_sales = {}
        tender_rows = db.query(
            func.date(TenderData.date).label("d"),
            func.sum(TenderData.amount).label("total"),
        ).filter(
            TenderData.user_id == user_id,
            TenderData.date >= cutoff,
            TenderData.tender_type.notin_(["comp", "void"]),
        ).group_by(func.date(TenderData.date)).all()
        for row in tender_rows:
            daily_sales[str(row.d)] = round(row.total, 2)

        # ── Important/tracked transactions grouped by supplier ───────────────
        # Step 1: find ALL starred merchants (no date filter) so every tracked
        # supplier always appears on Overview regardless of when they last transacted.
        starred_rows = db.query(TransactionData).filter(
            TransactionData.user_id == user_id,
            TransactionData.is_important == True,
            TransactionData.is_deposit == False,
        ).all()
        starred_names = {(t.merchant_name or t.description or "Unknown") for t in starred_rows}

        # Step 2: for each starred merchant, sum transactions within the period.
        imp_map = {}
        for name in starred_names:
            period_txns = [
                t for t in txns          # txns already filtered to cutoff window
                if not t.is_deposit
                and (t.merchant_name or t.description or "Unknown") == name
            ]
            imp_map[name] = {
                "name":  name,
                "total": round(sum(t.amount for t in period_txns), 2),
                "count": len(period_txns),
            }
        important_costs = sorted(imp_map.values(), key=lambda x: x["total"], reverse=True)

        return jsonify({
            "total_balance":    round(total_balance, 2),
            "deposits":         round(deposits, 2),
            "large_transactions": large_out,
            "daily_deposits":   daily_deposits,
            "daily_sales":      daily_sales,
            "important_costs":  important_costs,
        })

    except Exception as e:
        print(f"[Finances] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Data Retrieval ────────────────────────────────────────────────────────────

@app.route("/api/labor/<int:user_id>", methods=["GET"])
def get_labor_data(user_id):
    """Return shift data with trend chart and period-over-period comparison.
    Accepts ?days=N  OR  ?period=ytd  (free tier: no restriction).
    """
    db = get_db()
    try:
        now = datetime.utcnow()
        period = request.args.get("period", "")

        if period == "ytd":
            cutoff = datetime(now.year, 1, 1)
            days = max((now - cutoff).days, 1)
            # True year-over-year: same Jan 1 → same date, one year back
            try:
                prev_end = datetime(now.year - 1, now.month, now.day)
            except ValueError:
                prev_end = datetime(now.year - 1, now.month, 28)
            prev_cutoff = datetime(now.year - 1, 1, 1)
            comparison_label = f"Jan 1 – {now.strftime('%b %d')} {now.year - 1}"
        else:
            days = int(request.args.get("days", 14))
            cutoff = now - timedelta(days=days)
            prev_cutoff = cutoff - timedelta(days=days)
            prev_end    = cutoff
            comparison_label = "prior period"

        # Ascending so chart buckets are left-to-right chronological; rows get reversed for table display
        shifts = db.query(ShiftData).filter(
            ShiftData.user_id == user_id,
            ShiftData.shift_date >= cutoff
        ).order_by(ShiftData.shift_date.asc()).all()

        prev_shifts = db.query(ShiftData).filter(
            ShiftData.user_id == user_id,
            ShiftData.shift_date >= prev_cutoff,
            ShiftData.shift_date <  prev_end,
        ).all()

        rows = [{
            "id": s.id, "employee_name": s.employee_name,
            "role": s.role, "department": s.department,
            "shift_date": s.shift_date.isoformat() if s.shift_date else None,
            "scheduled_start": s.scheduled_start.isoformat() if s.scheduled_start else None,
            "scheduled_end": s.scheduled_end.isoformat() if s.scheduled_end else None,
            "actual_start": s.actual_start.isoformat() if s.actual_start else None,
            "actual_end": s.actual_end.isoformat() if s.actual_end else None,
            "scheduled_hours": s.scheduled_hours or 0,
            "actual_hours": s.actual_hours or 0,
            "hourly_rate": s.hourly_rate or 0,
            "labor_cost": s.labor_cost or 0,
            "is_overtime": s.is_overtime or False,
        } for s in reversed(shifts)]

        # Single pass: aggregate totals + build chart buckets simultaneously
        total_scheduled = total_actual = total_cost = 0.0
        overtime_count = 0
        grouped: dict = {}
        for s in shifts:
            total_scheduled += s.scheduled_hours or 0
            total_actual    += s.actual_hours    or 0
            total_cost      += s.labor_cost      or 0
            if s.is_overtime:
                overtime_count += 1
            if s.shift_date:
                if days > 90:
                    key = s.shift_date.strftime("%b %Y")
                elif days > 21:
                    key = f"Wk {s.shift_date.isocalendar()[1]}"
                else:
                    key = s.shift_date.strftime("%b %d")
                if key not in grouped:
                    grouped[key] = {"cost": 0.0, "hours": 0.0, "ot": 0}
                grouped[key]["cost"]  += s.labor_cost   or 0
                grouped[key]["hours"] += s.actual_hours or 0
                if s.is_overtime:
                    grouped[key]["ot"] += 1

        prev_cost = prev_actual = 0.0
        prev_ot = 0
        for s in prev_shifts:
            prev_cost   += s.labor_cost   or 0
            prev_actual += s.actual_hours or 0
            if s.is_overtime:
                prev_ot += 1

        def _pct(curr, prev):
            return round((curr - prev) / prev * 100, 1) if prev else None

        labels = list(grouped.keys())

        return jsonify({
            "shifts": rows,
            "summary": {
                "total_scheduled_hours": round(total_scheduled, 2),
                "total_actual_hours":    round(total_actual, 2),
                "total_labor_cost":      round(total_cost, 2),
                "overtime_shifts":       overtime_count,
                "shift_count":          len(shifts),
                "comparison": {
                    "cost_pct":   _pct(total_cost,     prev_cost),
                    "hours_pct":  _pct(total_actual,   prev_actual),
                    "ot_pct":     _pct(overtime_count, prev_ot),
                    "prev_cost":  round(prev_cost,   2),
                    "prev_hours": round(prev_actual, 2),
                    "prev_ot":    prev_ot,
                    "label":      comparison_label,
                }
            },
            "chart_data": {
                "labels": labels,
                "cost":   [round(grouped[k]["cost"],  2) for k in labels],
                "hours":  [round(grouped[k]["hours"], 2) for k in labels],
                "ot":     [grouped[k]["ot"]             for k in labels],
            }
        })
    finally:
        db.close()


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@app.route("/api/labor/<int:user_id>/yearly", methods=["GET"])
def get_labor_yearly(user_id):
    """All shift data bucketed by calendar year and month for year-over-year chart."""
    db = get_db()
    try:
        shifts = db.query(ShiftData).filter(
            ShiftData.user_id == user_id,
            ShiftData.shift_date.isnot(None),
        ).order_by(ShiftData.shift_date.asc()).all()

        if not shifts:
            return jsonify({"years": {}, "months": _MONTHS, "year_list": [], "totals": {}})

        by_cost  = {}   # {year_int: [float * 12]}
        by_hours = {}
        by_ot    = {}
        by_emp   = {}   # {emp_name: {year_str: float}}

        for s in shifts:
            yr = s.shift_date.year
            mo = s.shift_date.month - 1
            if yr not in by_cost:
                by_cost[yr]  = [0.0] * 12
                by_hours[yr] = [0.0] * 12
                by_ot[yr]    = [0]   * 12
            by_cost[yr][mo]  += s.labor_cost   or 0
            by_hours[yr][mo] += s.actual_hours or 0
            if s.is_overtime:
                by_ot[yr][mo] += 1

            emp    = (s.employee_name or "Unknown").strip()
            yr_str = str(yr)
            if emp not in by_emp:
                by_emp[emp] = {}
            by_emp[emp][yr_str] = by_emp[emp].get(yr_str, 0.0) + (s.labor_cost or 0)

        year_list = sorted(by_cost.keys())
        years  = {}
        totals = {}
        for yr in year_list:
            cost_arr  = [round(v, 2) for v in by_cost[yr]]
            hours_arr = [round(v, 2) for v in by_hours[yr]]
            ot_arr    = by_ot[yr]
            years[str(yr)]  = {"cost": cost_arr, "hours": hours_arr, "ot": ot_arr}
            totals[str(yr)] = {
                "cost":  round(sum(cost_arr),  2),
                "hours": round(sum(hours_arr), 2),
                "ot":    sum(ot_arr),
            }

        # Top 30 employees by all-time cost
        sorted_emps = sorted(by_emp.items(), key=lambda x: sum(x[1].values()), reverse=True)[:30]
        employees = {
            emp: {yr: round(c, 2) for yr, c in yrs.items()}
            for emp, yrs in sorted_emps
        }

        return jsonify({
            "years":     years,
            "months":    _MONTHS,
            "year_list": [str(y) for y in year_list],
            "totals":    totals,
            "employees": employees,
        })
    finally:
        db.close()


@app.route("/api/sales/<int:user_id>", methods=["GET"])
def get_sales_data(user_id):
    """Return item sales data grouped for the dashboard."""
    db = get_db()
    try:
        days = int(request.args.get("days", 14))
        q = db.query(SalesData).filter(SalesData.user_id == user_id)
        if days > 0:
            q = q.filter(SalesData.date >= datetime.utcnow() - timedelta(days=days))
        sales = q.order_by(SalesData.date.desc()).all()

        rows = [{
            "date": s.date.isoformat() if s.date else None,
            "hour": s.hour, "item": s.item,
            "quantity_sold": s.quantity_sold,
            "revenue": s.revenue, "source": s.source,
            "check_number": s.check_number,
        } for s in sales]

        total_revenue = sum(s.revenue for s in sales)
        # Orders = distinct check numbers (line items with the same check are one order).
        order_count = len({s.check_number for s in sales if s.check_number})
        return jsonify({
            "sales": rows,
            "summary": {
                "total_revenue": round(total_revenue, 2),
                "record_count": len(sales),
                "order_count": order_count,
            }
        })
    finally:
        db.close()


@app.route("/api/tenders/<int:user_id>", methods=["GET"])
def get_tender_data(user_id):
    """Return tender breakdown for the dashboard."""
    db = get_db()
    try:
        days = int(request.args.get("days", 14))
        q = db.query(TenderData).filter(TenderData.user_id == user_id)
        if days > 0:
            q = q.filter(TenderData.date >= datetime.utcnow() - timedelta(days=days))
        tenders = q.all()

        rows = [{
            "date": t.date.isoformat() if t.date else None,
            "tender_type": t.tender_type,
            "amount": t.amount,
            "transaction_count": t.transaction_count,
            "revenue_center": t.revenue_center
        } for t in tenders]

        by_type: dict = {}
        for t in tenders:
            by_type.setdefault(t.tender_type, {"amount": 0.0, "count": 0})
            by_type[t.tender_type]["amount"] += t.amount
            by_type[t.tender_type]["count"] += t.transaction_count

        return jsonify({
            "tenders": rows,
            "by_type": by_type,
            "summary": {
                "total_amount": round(sum(t.amount for t in tenders), 2),
                "total_transactions": sum(t.transaction_count for t in tenders)
            }
        })
    finally:
        db.close()


# ── Excel / CSV upload ───────────────────────────────────────────────────────

import re as _re

def _norm(s):
    """Lowercase a header, drop punctuation, collapse whitespace for fuzzy matching."""
    s = "" if s is None else str(s).lower()
    s = _re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())

_SALES_COL_MAP = {
    "date":     ["date", "day", "sale date", "transaction date", "business date",
                 "order date", "trans date", "check date", "posting date", "work date",
                 "fiscal date", "service date", "shift date",
                 "check opened time", "check open time", "opened time", "open time",
                 "closed time", "check closed time", "time", "datetime"],
    "item":     ["menu item", "item name", "item description", "item", "product name",
                 "product", "menu name", "plu name", "plu", "item code", "sku",
                 "article", "dish", "description", "name"],
    "quantity": ["quantity sold", "units sold", "item count", "qty sold", "quantity",
                 "qty", "units", "count", "sold", "items", "covers", "volume"],
    "revenue":  ["net sales", "gross sales", "net revenue", "gross revenue", "net amount",
                 "gross amount", "total sales", "total revenue", "sale amount", "revenue",
                 "sales", "amount", "subtotal", "extended price", "price", "total",
                 "check total", "ticket total", "bill total", "order total", "check amount",
                 "total amount", "receipts", "income"],
    "category": ["menu category", "menu group", "sales category", "dining option",
                 "service mode", "order type", "order source", "channel", "category",
                 "cat", "group", "family", "department", "dept", "section", "class",
                 "division", "type"],
    "check":    ["check number", "check no", "check id", "order number", "order no",
                 "order id", "ticket number", "ticket no", "receipt number",
                 "transaction number", "transaction id", "guest check", "bill number"],
}

_TENDER_COL_MAP = {
    "date":              ["date", "day", "transaction date", "sale date", "business date",
                         "order date", "trans date", "check date", "posting date", "work date",
                         "fiscal date", "service date"],
    "tender_type":       ["tender type", "tender", "payment type", "payment method", "type",
                         "media", "pay type", "payment", "pay method", "tender name",
                         "payment name", "method", "form of payment"],
    "amount":            ["amount", "total", "revenue", "sales", "net", "value",
                         "net sales", "gross sales", "tender amount", "payment amount",
                         "total amount", "sale amount", "receipts"],
    "transaction_count": ["transaction count", "transactions", "count", "tx count",
                         "# transactions", "num transactions", "trans count",
                         "number of transactions", "checks", "ticket count", "covers",
                         "guest count", "number"],
    "revenue_center":    ["revenue center", "location", "center", "area", "section",
                         "department", "dept", "store", "outlet", "site", "zone",
                         "profit center", "cost center", "venue"],
}

_LABOR_COL_MAP = {
    "date":     ["date", "day", "shift date", "work date", "business date", "pay date",
                 "worked date", "clock in date", "period", "posting date", "service date"],
    "employee": ["employee", "employee name", "name", "staff", "staff name", "worker",
                 "team member", "person", "crew", "cashier", "server", "associate",
                 "first name", "full name", "employee id", "emp id"],
    "hours":    ["hours", "hours worked", "total hours", "actual hours", "worked hours",
                 "reg hours", "regular hours", "hrs", "labor hours", "shift hours",
                 "paid hours", "clock hours", "duration"],
    "cost":     ["labor cost", "cost", "wages", "pay", "gross pay", "total pay", "amount",
                 "gross wages", "payroll", "earnings", "total cost", "wage cost", "pay amount"],
    "rate":     ["rate", "hourly rate", "pay rate", "wage", "hourly wage", "rate of pay",
                 "hourly", "per hour", "wage rate"],
    "role":     ["role", "position", "job", "job title", "title", "department", "dept",
                 "team", "job code", "labor category"],
    "overtime": ["overtime", "ot", "ot hours", "overtime hours", "is overtime", "ot flag"],
}

_FINANCE_COL_MAP = {
    "date":        ["date", "transaction date", "posting date", "post date", "day",
                    "trans date", "value date", "booking date", "cleared date"],
    "amount":      ["amount", "transaction amount", "debit", "credit", "value", "total",
                    "net", "payment", "charge", "withdrawal", "deposit", "money", "sum"],
    "description": ["description", "name", "memo", "details", "narrative", "transaction",
                    "reference", "note", "payee", "particulars", "activity"],
    "merchant":    ["merchant", "merchant name", "vendor", "payee", "counterparty",
                    "store", "business", "company"],
    "category":    ["category", "type", "transaction type", "expense category", "class",
                    "account", "group", "classification", "cat", "spending category"],
}

_EXPENSE_COL_MAP = {
    "date":     ["date", "expense date", "transaction date", "posting date", "paid date",
                 "day", "invoice date", "bill date"],
    "amount":   ["amount", "cost", "total", "expense", "spend", "value", "price",
                 "amount paid", "total amount", "debit"],
    "category": ["category", "expense category", "type", "class", "account", "group",
                 "gl account", "cat", "classification"],
    "vendor":   ["vendor", "payee", "merchant", "supplier", "description", "name",
                 "paid to", "company", "memo", "details"],
}

_INVENTORY_COL_MAP = {
    "sku":           ["sku", "item code", "product code", "code", "item id", "product id",
                      "part number", "barcode", "upc", "id"],
    "product":       ["product", "product name", "item", "item name", "name", "description",
                      "title", "menu item"],
    "unit_cost":     ["unit cost", "cost", "cost price", "wholesale", "buy price", "cogs",
                      "purchase price", "landed cost"],
    "unit_price":    ["unit price", "price", "retail price", "sell price", "sale price",
                      "list price", "msrp", "selling price"],
    "stock_qty":     ["stock qty", "stock", "quantity", "qty", "on hand", "in stock",
                      "units", "count", "inventory", "qty on hand", "available"],
    "reorder_level": ["reorder level", "reorder point", "reorder", "min stock", "par level",
                      "minimum", "threshold", "safety stock", "min qty"],
}

_REVIEW_COL_MAP = {
    "date":        ["date", "review date", "created", "created at", "submitted", "day",
                    "timestamp", "posted"],
    "sku":         ["sku", "item code", "product code", "product id", "code", "id"],
    "product":     ["product", "product name", "item", "item name", "name", "title"],
    "rating":      ["rating", "stars", "score", "star rating", "rate", "review score",
                    "overall rating"],
    "review_text": ["review text", "review", "text", "comment", "comments", "feedback",
                    "body", "content", "message", "notes", "description"],
}

def _header_score(header_norm, aliases):
    """Best keyword-match score of a normalized header against a field's aliases.
       Exact > whole-word / all-alias-words-present > loose substring. 0 = no match."""
    if not header_norm:
        return 0
    wordset = set(header_norm.split())
    best = 0
    for alias in aliases:
        a = _norm(alias)
        if not a:
            continue
        atoks = a.split()
        if header_norm == a:
            best = max(best, 100)
        elif len(atoks) == 1 and a in wordset:
            best = max(best, 86)                  # whole-word hit, e.g. "qty"
        elif all(t in wordset for t in atoks):
            best = max(best, 82)                  # all alias words present, any order
        elif a in header_norm:
            best = max(best, 60)                  # loose substring
    return best


def _looks_numeric(val):
    """True/False whether a cell parses as a number; None if blank (no signal)."""
    s = "" if val is None else str(val).strip()
    if s == "":
        return None
    s = s.replace("$", "").replace(",", "").replace("%", "").strip()
    s = _re.sub(r"^\((.*)\)$", r"-\1", s)         # (123) -> -123 (accounting negatives)
    try:
        float(s)
        return True
    except Exception:
        return False


def _col_numeric_ratio(rows, ci, sample=50):
    """Fraction of non-blank cells in column `ci` (over data rows) that are numeric."""
    seen = num = 0
    for r in rows[1:1 + sample]:
        if ci < len(r):
            t = _looks_numeric(r[ci])
            if t is None:
                continue
            seen += 1
            num += 1 if t else 0
    return (num / seen) if seen else 0.0


def _col_date_ratio(rows, ci, sample=50):
    """Fraction of non-blank cells in column `ci` that parse as dates."""
    seen = ok = 0
    for r in rows[1:1 + sample]:
        if ci < len(r):
            v = str(r[ci]).strip()
            if not v:
                continue
            seen += 1
            ok += 1 if _parse_date(v) else 0
    return (ok / seen) if seen else 0.0


def _col_distinct_ratio(rows, ci, sample=400):
    """distinct non-blank values / non-blank count. A real quantity/count column
       repeats a few small values (low ratio); an order/check/transaction NUMBER is
       nearly unique per row (high ratio). This is what tells a count from an ID."""
    vals = []
    for r in rows[1:1 + sample]:
        if ci < len(r):
            v = str(r[ci]).strip()
            if v:
                vals.append(v)
    return (len(set(vals)) / len(vals)) if vals else 0.0


def _col_decimal_ratio(rows, ci, sample=100):
    """Fraction of numeric cells with a non-zero fractional part. Money columns
       carry cents; integer ID columns don't — used to keep revenue fallbacks off IDs."""
    seen = dec = 0
    for r in rows[1:1 + sample]:
        if ci < len(r):
            if _looks_numeric(r[ci]) is True:
                seen += 1
                f = _safe_float(r[ci])
                if f != int(f):
                    dec += 1
    return (dec / seen) if seen else 0.0


def _col_median_abs(rows, ci, sample=300):
    """Median absolute value of a column's numeric cells. A per-line quantity is
       tiny (1, 2, 3…); an order / check / ticket NUMBER is large. So a big median
       is the clearest sign a numeric column is an identifier, not a count."""
    vals = []
    for r in rows[1:1 + sample]:
        if ci < len(r) and _looks_numeric(r[ci]) is True:
            vals.append(abs(_safe_float(r[ci])))
    if not vals:
        return 0.0
    vals.sort()
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2.0


def _find_header_row(rows, col_map, max_scan=15):
    """POS exports often carry title/metadata rows above the real header. Pick the
       row (within the first max_scan) whose cells match the most distinct fields."""
    best_i, best_hits = 0, -1
    for i in range(min(max_scan, len(rows))):
        matched = set()
        for cell in rows[i]:
            hn = _norm(cell)
            if not hn:
                continue
            for field, aliases in col_map.items():
                if _header_score(hn, aliases) >= 82:
                    matched.add(field)
                    break
        if len(matched) > best_hits:
            best_hits, best_i = len(matched), i
    return best_i


def _resolve_mapping(rows, col_map, numeric_fields=(), date_fields=(), text_fields=(),
                     count_fields=(), label_field=None):
    """Map {field: col_index} from rows[0]=header + rows[1:]=data.

       Each (field, column) is scored by keyword match PLUS column-content signal
       (numeric ratio for money/qty, date ratio for dates, text-ness for labels).
       Columns are then assigned greedily so no two fields share a column — the
       highest-confidence pair wins first. This is what makes "if a header contains
       one of these keywords, link it to this field" robust: the keyword chooses the
       field, and the column's actual values break ties and catch oddly-named columns.

       `count_fields` (e.g. quantity) get an extra guard: in a row-per-line export a
       real count repeats a few small values, whereas an order/check/transaction
       NUMBER is nearly unique. So a high-cardinality column is never used as a count
       — that's what stops "order number" being summed as if it were units sold."""
    headers = [_norm(h) for h in rows[0]]
    ncols = len(headers)
    nrows = len(rows) - 1
    big = nrows >= 40                                  # enough rows for cardinality to discriminate
    cands = []  # (score, field, col)
    for field, aliases in col_map.items():
        for ci in range(ncols):
            score = _header_score(headers[ci], aliases)
            if field in date_fields:
                score += int(_col_date_ratio(rows, ci) * 45)
            if field in numeric_fields:
                nr = _col_numeric_ratio(rows, ci)
                score += int(nr * 40)
                if nr < 0.30:
                    score -= 70                   # a money/qty field must look numeric
            if field in count_fields and score < 82 and _col_median_abs(rows, ci) > 20:
                score -= 95                       # large typical value = an ID/amount, not a count
            if field in text_fields:
                nr = _col_numeric_ratio(rows, ci)
                score += 12 if nr < 0.40 else -25  # labels are text, not numbers
            if score > 0:
                cands.append((score, field, ci))
    cands.sort(key=lambda x: x[0], reverse=True)
    mapping, used = {}, set()
    for score, field, ci in cands:
        if field in mapping or ci in used or score < 30:
            continue
        mapping[field] = ci
        used.add(ci)
    # Content fallback for must-have numeric fields the headers didn't name.
    for field in numeric_fields:
        if field in mapping:
            continue
        is_count = field in count_fields
        best_ci, best_key = None, None
        for ci in range(ncols):
            if ci in used or _col_numeric_ratio(rows, ci) < 0.5:
                continue
            if is_count and _col_median_abs(rows, ci) > 20:
                continue                          # large typical value = ID/amount, not a count
            total = sum(abs(_safe_float(r[ci])) for r in rows[1:] if ci < len(r))
            # For money fields prefer columns that carry cents over pure-integer
            # (ID-ish) columns; for counts just take the largest plausible one.
            key = (0 if is_count else (1 if _col_decimal_ratio(rows, ci) >= 0.1 else 0), total)
            if best_key is None or key > best_key:
                best_key, best_ci = key, ci
        if best_ci is not None:
            mapping[field] = best_ci
            used.add(best_ci)
    # Label fallback: if the primary text field (e.g. the item/menu name) wasn't
    # named by any keyword, use the unused, mostly-text column with the most
    # distinct values — that's almost always the label column.
    if label_field and label_field not in mapping:
        best_ci, best_distinct = None, 0
        for ci in range(ncols):
            if ci in used or _col_numeric_ratio(rows, ci) >= 0.4:
                continue
            distinct = len({str(r[ci]).strip() for r in rows[1:] if ci < len(r) and str(r[ci]).strip()})
            if distinct > best_distinct:
                best_distinct, best_ci = distinct, ci
        if best_ci is not None:
            mapping[label_field] = best_ci
            used.add(best_ci)
    return mapping

def _parse_date(val):
    from datetime import datetime as _dt
    if isinstance(val, _dt):
        return val
    if hasattr(val, "date"):          # datetime.date object
        return _dt.combine(val, _dt.min.time())
    s = str(val).strip()
    for fmt in (
        "%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%d/%m/%Y", "%Y/%m/%d",
        "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S",
        "%m-%d-%Y %H:%M", "%m-%d-%Y %H:%M:%S",
    ):
        try:
            return _dt.strptime(s, fmt)
        except ValueError:
            pass
    return None

def _safe_float(val):
    s = "" if val is None else str(val).replace("$", "").replace(",", "").replace("%", "").strip()
    s = _re.sub(r"^\((.*)\)$", r"-\1", s)         # (123) -> -123 (accounting negatives)
    try:
        return float(s)
    except Exception:
        return 0.0

def _safe_int(val):
    try:
        return int(round(_safe_float(val)))
    except Exception:
        return 0

def _read_upload_file(f):
    """Read a spreadsheet WITHOUT assuming row 0 is the header (POS exports often
       prepend title/date-range/location rows). Returns every row as a tuple of
       strings; the caller locates the real header row via _find_header_row()."""
    import io, csv, pandas as pd
    name = f.filename.lower()
    data = f.read()
    if name.endswith((".csv", ".tsv", ".txt")):
        # Decode leniently (POS exports use assorted encodings + BOMs).
        text = None
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text = data.decode(enc); break
            except Exception:
                continue
        if text is None:
            text = data.decode("utf-8", errors="replace")
        # Sniff the delimiter; title/blank rows make pandas' C tokenizer choke on
        # ragged column counts, so parse with the stdlib csv reader instead.
        sample = text[:8192]
        delim = ","
        try:
            delim = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except Exception:
            if name.endswith(".tsv") or sample.count("\t") > sample.count(","):
                delim = "\t"
        raw = [row for row in csv.reader(io.StringIO(text), delimiter=delim)]
        if not any(any(str(c).strip() for c in r) for r in raw):
            return None, "The file appears to be empty."
        width = max((len(r) for r in raw), default=0)
        rows = [tuple((list(r) + [""] * (width - len(r)))[i].strip() for i in range(width))
                for r in raw]
        return rows, None
    elif name.endswith((".xlsx", ".xlsm")):
        df = pd.read_excel(io.BytesIO(data), dtype=str, header=None, keep_default_na=False, engine="openpyxl")
    elif name.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(data), dtype=str, header=None, keep_default_na=False, engine="xlrd")
    else:
        return None, "Unsupported file format. Please upload .xlsx, .xls, .xlsm, .csv, or .tsv"
    rows = [tuple("" if v is None else str(v) for v in r)
            for r in df.itertuples(index=False, name=None)]
    return rows, None


def _autodetect_date_col(headers, sample_rows):
    """Fallback: find a column whose values look like dates."""
    from datetime import datetime as _dt
    date_pattern = _re.compile(
        r'\d{1,4}[/\-]\d{1,2}[/\-]\d{2,4}|\d{1,2}/\d{1,2}/\d{4}')
    for i, h in enumerate(headers):
        hits = 0
        for row in sample_rows[:10]:
            if i < len(row) and date_pattern.search(str(row[i])):
                hits += 1
        if hits >= 2:
            return i
    return None


@app.route("/api/upload/sales/<int:user_id>", methods=["POST"])
def upload_sales(user_id):
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _SALES_COL_MAP)
        rows = raw[hdr_i:]                                   # rows[0] = header, rest = data
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _SALES_COL_MAP,
            numeric_fields=("revenue", "quantity"),
            date_fields=("date",),
            text_fields=("item", "category"),
            count_fields=("quantity",),
            label_field="item",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload sales] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "revenue" not in mapping:
            return jsonify({"error": f"Couldn't find a sales/revenue column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            # Re-import replaces the previous upload: a spreadsheet is a full
            # snapshot, so drop earlier imported rows before inserting (this is
            # what clears a wrongly-mapped earlier import). Synced POS data
            # (source != "upload") is untouched.
            db.query(SalesData).filter_by(user_id=user_id, source="upload").delete()
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                # date: use the mapped column when present; otherwise default to today
                # so aggregate exports without a date still import (rather than vanish).
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                if "date" in mapping and not date:
                    date = _dt.now()
                elif "date" not in mapping:
                    date = _dt.now()
                have_label_col = ("item" in mapping) or ("category" in mapping)
                item     = str(row[mapping["item"]]).strip()     if "item"     in mapping and mapping["item"]     < len(row) and row[mapping["item"]].strip()     else None
                if item is None and "category" in mapping and mapping["category"] < len(row):
                    item = str(row[mapping["category"]]).strip() or None   # fall back to the dimension label
                if have_label_col:
                    # Item/category export: drop summary/total lines with no real label.
                    if not item or _re.match(r'^(grand\s+)?(total|subtotal|sum)\b', item.strip(), _re.I):
                        skipped += 1; continue
                else:
                    # Date+amount export (no item dimension): keep every row, labelling
                    # it by check # (or a generic "Sale") so it still appears in views.
                    check_lbl = str(row[mapping["check"]]).strip() if "check" in mapping and mapping["check"] < len(row) and row[mapping["check"]].strip() else ""
                    item = item or (f"Check {check_lbl}" if check_lbl else "Sale")
                revenue  = _safe_float(row[mapping["revenue"]])  if "revenue"  in mapping and mapping["revenue"]  < len(row) else 0.0
                # quantity: use the mapped count column; if the file has none (a
                # line-per-sale export), each row counts as one unit so the menu view
                # shows units sold rather than 0.
                if "quantity" in mapping and mapping["quantity"] < len(row):
                    quantity = _safe_float(row[mapping["quantity"]])
                else:
                    quantity = 1.0
                # order/check id — lets the app group line items into orders and count them
                check = str(row[mapping["check"]]).strip() if "check" in mapping and mapping["check"] < len(row) and row[mapping["check"]].strip() else None
                db.add(SalesData(
                    user_id=user_id, date=date, item=item,
                    quantity_sold=quantity, revenue=revenue,
                    check_number=check, source="upload",
                ))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/upload/tenders/<int:user_id>", methods=["POST"])
def upload_tenders(user_id):
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _TENDER_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _TENDER_COL_MAP,
            numeric_fields=("amount", "transaction_count"),
            date_fields=("date",),
            text_fields=("tender_type", "revenue_center"),
            count_fields=("transaction_count",),
            label_field="tender_type",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload tenders] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "amount" not in mapping:
            return jsonify({"error": f"Couldn't find a payment amount column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            # Re-import replaces the previous tender upload (see upload_sales).
            db.query(TenderData).filter_by(user_id=user_id, source="upload").delete()
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                if not date:
                    date = _dt.now()
                tender_type = str(row[mapping["tender_type"]]).strip().lower().replace(" ", "_") \
                              if "tender_type" in mapping and mapping["tender_type"] < len(row) and row[mapping["tender_type"]].strip() else "unknown"
                amount            = _safe_float(row[mapping["amount"]])            if "amount"            in mapping and mapping["amount"]            < len(row) else 0.0
                transaction_count = _safe_int(row[mapping["transaction_count"]])   if "transaction_count" in mapping and mapping["transaction_count"] < len(row) else 0
                revenue_center    = str(row[mapping["revenue_center"]]).strip()    if "revenue_center"    in mapping and mapping["revenue_center"]    < len(row) and row[mapping["revenue_center"]].strip() else None
                if amount == 0 and transaction_count == 0:
                    skipped += 1; continue
                db.add(TenderData(
                    user_id=user_id, date=date, tender_type=tender_type,
                    amount=amount, transaction_count=transaction_count,
                    revenue_center=revenue_center, source="upload",
                ))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload/labor/<int:user_id>", methods=["POST"])
def upload_labor(user_id):
    """Upload a timesheet / payroll export → ShiftData (the Labor tab reads this)."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _LABOR_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _LABOR_COL_MAP,
            numeric_fields=("hours", "cost", "rate"),
            date_fields=("date",),
            text_fields=("employee", "role", "overtime"),
            label_field="employee",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload labor] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "hours" not in mapping and "cost" not in mapping:
            return jsonify({"error": f"Couldn't find an hours or labor-cost column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            db.query(ShiftData).filter_by(user_id=user_id, source="upload").delete()
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                if not date:
                    date = _dt.now()
                emp = str(row[mapping["employee"]]).strip() if "employee" in mapping and mapping["employee"] < len(row) and row[mapping["employee"]].strip() else None
                if emp and _re.match(r'^(grand\s+)?(total|subtotal|sum)\b', emp, _re.I):
                    skipped += 1; continue      # drop payroll total rows
                hours = _safe_float(row[mapping["hours"]]) if "hours" in mapping and mapping["hours"] < len(row) else 0.0
                rate  = _safe_float(row[mapping["rate"]])  if "rate"  in mapping and mapping["rate"]  < len(row) else 0.0
                cost  = _safe_float(row[mapping["cost"]])  if "cost"  in mapping and mapping["cost"]  < len(row) else 0.0
                if cost == 0 and rate and hours:
                    cost = rate * hours          # derive cost when only a rate is given
                if hours == 0 and cost == 0:
                    skipped += 1; continue
                role = str(row[mapping["role"]]).strip() if "role" in mapping and mapping["role"] < len(row) and row[mapping["role"]].strip() else None
                ot_flag = False
                if "overtime" in mapping and mapping["overtime"] < len(row):
                    ot_flag = str(row[mapping["overtime"]]).strip().lower() in ("1", "true", "yes", "y", "ot", "overtime")
                if not ot_flag and hours > 40:   # weekly OT heuristic when not stated
                    ot_flag = True
                db.add(ShiftData(
                    user_id=user_id, employee_name=emp or "Staff", role=role,
                    shift_date=date, actual_hours=hours, scheduled_hours=hours,
                    hourly_rate=rate or None, labor_cost=cost,
                    is_overtime=ot_flag, source="upload",
                ))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload/finances/<int:user_id>", methods=["POST"])
def upload_finances(user_id):
    """Upload a bank / expense statement → TransactionData (the Finances tab reads this)."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _FINANCE_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _FINANCE_COL_MAP,
            numeric_fields=("amount",),
            date_fields=("date",),
            text_fields=("description", "merchant", "category"),
            label_field="description",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload finances] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "amount" not in mapping:
            return jsonify({"error": f"Couldn't find a transaction amount column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            # Re-import replaces prior uploaded rows (identified by the external_id prefix).
            db.query(TransactionData).filter(
                TransactionData.user_id == user_id,
                TransactionData.external_id.like(f"upload:{user_id}:%"),
            ).delete(synchronize_session=False)
            for idx, row in enumerate(rows[1:]):
                if all(str(v).strip() == "" for v in row):
                    continue
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                if not date:
                    date = _dt.now()
                raw_amt = _safe_float(row[mapping["amount"]]) if "amount" in mapping and mapping["amount"] < len(row) else 0.0
                if raw_amt == 0:
                    skipped += 1; continue
                desc = str(row[mapping["description"]]).strip() if "description" in mapping and mapping["description"] < len(row) and row[mapping["description"]].strip() else None
                if desc and _re.match(r'^(grand\s+)?(total|subtotal|sum|balance)\b', desc, _re.I):
                    skipped += 1; continue
                cat  = str(row[mapping["category"]]).strip() if "category" in mapping and mapping["category"] < len(row) and row[mapping["category"]].strip() else ""
                merch = str(row[mapping["merchant"]]).strip() if "merchant" in mapping and mapping["merchant"] < len(row) and row[mapping["merchant"]].strip() else None
                # Sign decides money-in vs money-out (bank convention: positive = credit
                # in, negative = debit out); explicit category words override. Stored positive.
                low = f"{cat} {desc or ''}".lower()
                is_deposit = raw_amt > 0
                if _re.search(r'\b(deposit|refund|income|sales|transfer in|ach credit)\b', low):
                    is_deposit = True
                if _re.search(r'\b(withdrawal|debit|purchase|payroll|expense|bill|fee|payment to|invoice)\b', low):
                    is_deposit = False
                db.add(TransactionData(
                    user_id=user_id, external_id=f"upload:{user_id}:{idx}",
                    account_id="upload", institution_name="Uploaded statement",
                    date=date, amount=abs(raw_amt),
                    description=desc or (cat or "Transaction"),
                    merchant_name=merch, is_deposit=is_deposit,
                ))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Expenses ──────────────────────────────────────────────────────────────────

@app.route("/api/upload/expenses/<int:user_id>", methods=["POST"])
def upload_expenses(user_id):
    """Upload an expense report → ExpenseData."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _EXPENSE_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _EXPENSE_COL_MAP,
            numeric_fields=("amount",),
            date_fields=("date",),
            text_fields=("category", "vendor"),
            label_field="vendor",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload expenses] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "amount" not in mapping:
            return jsonify({"error": f"Couldn't find an amount column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            db.query(ExpenseData).filter_by(user_id=user_id, source="upload").delete()
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                amount = _safe_float(row[mapping["amount"]]) if "amount" in mapping and mapping["amount"] < len(row) else 0.0
                if amount == 0:
                    skipped += 1; continue
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                if not date:
                    date = _dt.now()
                category = str(row[mapping["category"]]).strip() if "category" in mapping and mapping["category"] < len(row) and row[mapping["category"]].strip() else "Uncategorized"
                if _re.match(r'^(grand\s+)?(total|subtotal|sum)\b', category, _re.I):
                    skipped += 1; continue
                vendor = str(row[mapping["vendor"]]).strip() if "vendor" in mapping and mapping["vendor"] < len(row) and row[mapping["vendor"]].strip() else None
                db.add(ExpenseData(user_id=user_id, date=date, amount=abs(amount),
                                   category=category, description=vendor, source="upload"))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/expenses/<int:user_id>", methods=["GET"])
def get_expenses(user_id):
    """Expense dashboard: totals, by-category, by-vendor, monthly trend."""
    from datetime import datetime as _dt, timedelta as _td
    days = request.args.get("days")
    db = get_db()
    try:
        q = db.query(ExpenseData).filter(ExpenseData.user_id == user_id)
        if days and str(days).isdigit() and int(days) > 0:   # 0 / blank = all time
            q = q.filter(ExpenseData.date >= _dt.now() - _td(days=int(days)))
        rows = q.order_by(ExpenseData.date.desc()).all()
        by_cat, by_vendor, monthly = {}, {}, {}
        total = 0.0
        for r in rows:
            total += r.amount or 0
            by_cat[r.category or "Uncategorized"] = round(by_cat.get(r.category or "Uncategorized", 0) + (r.amount or 0), 2)
            v = r.description or "Unknown"
            by_vendor[v] = round(by_vendor.get(v, 0) + (r.amount or 0), 2)
            mk = (r.date or _dt.now()).strftime("%Y-%m")
            monthly[mk] = round(monthly.get(mk, 0) + (r.amount or 0), 2)
        expenses = [{"date": (r.date.isoformat() if r.date else None), "amount": r.amount,
                     "category": r.category, "vendor": r.description} for r in rows[:500]]
        return jsonify({
            "expenses": expenses,
            "summary": {"total": round(total, 2), "count": len(rows),
                        "avg": round(total / len(rows), 2) if rows else 0},
            "by_category": dict(sorted(by_cat.items(), key=lambda x: -x[1])),
            "by_vendor":   dict(sorted(by_vendor.items(), key=lambda x: -x[1])[:12]),
            "monthly":     [{"month": k, "amount": monthly[k]} for k in sorted(monthly)],
        })
    finally:
        db.close()


# ── Inventory ─────────────────────────────────────────────────────────────────

@app.route("/api/upload/inventory/<int:user_id>", methods=["POST"])
def upload_inventory(user_id):
    """Upload an inventory snapshot → InventoryData (replaces the prior snapshot)."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _INVENTORY_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _INVENTORY_COL_MAP,
            numeric_fields=("unit_cost", "unit_price", "stock_qty", "reorder_level"),
            text_fields=("sku", "product"),
            label_field="product",
        )
        print(f"[upload inventory] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "product" not in mapping and "sku" not in mapping:
            return jsonify({"error": f"Couldn't find a product or SKU column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            db.query(InventoryData).filter_by(user_id=user_id).delete()   # snapshot: full replace
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                sku     = str(row[mapping["sku"]]).strip()     if "sku"     in mapping and mapping["sku"]     < len(row) and row[mapping["sku"]].strip()     else None
                product = str(row[mapping["product"]]).strip() if "product" in mapping and mapping["product"] < len(row) and row[mapping["product"]].strip() else None
                if not (sku or product):
                    skipped += 1; continue
                if product and _re.match(r'^(grand\s+)?(total|subtotal|sum)\b', product, _re.I):
                    skipped += 1; continue
                db.add(InventoryData(
                    user_id=user_id, sku=sku, product=product or sku,
                    unit_cost=_safe_float(row[mapping["unit_cost"]])         if "unit_cost"     in mapping and mapping["unit_cost"]     < len(row) else 0.0,
                    unit_price=_safe_float(row[mapping["unit_price"]])       if "unit_price"    in mapping and mapping["unit_price"]    < len(row) else 0.0,
                    stock_qty=_safe_float(row[mapping["stock_qty"]])         if "stock_qty"     in mapping and mapping["stock_qty"]     < len(row) else 0.0,
                    reorder_level=_safe_float(row[mapping["reorder_level"]]) if "reorder_level" in mapping and mapping["reorder_level"] < len(row) else 0.0,
                    source="upload",
                ))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/inventory/<int:user_id>", methods=["GET"])
def get_inventory(user_id):
    """Inventory dashboard: valuation, margins, low-stock alerts."""
    db = get_db()
    try:
        rows = db.query(InventoryData).filter(InventoryData.user_id == user_id).all()
        items, low_stock = [], []
        inv_value = retail_value = total_units = 0.0
        for r in rows:
            qty = r.stock_qty or 0
            margin = (r.unit_price or 0) - (r.unit_cost or 0)
            margin_pct = round(margin / r.unit_price * 100, 1) if r.unit_price else 0
            is_low = (r.reorder_level or 0) > 0 and qty <= (r.reorder_level or 0)
            item = {"sku": r.sku, "product": r.product, "unit_cost": r.unit_cost,
                    "unit_price": r.unit_price, "stock_qty": qty, "reorder_level": r.reorder_level,
                    "margin": round(margin, 2), "margin_pct": margin_pct,
                    "stock_value": round((r.unit_cost or 0) * qty, 2), "low_stock": is_low}
            items.append(item)
            inv_value    += (r.unit_cost or 0) * qty
            retail_value += (r.unit_price or 0) * qty
            total_units  += qty
            if is_low:
                low_stock.append(item)
        items.sort(key=lambda x: (not x["low_stock"], x["product"] or ""))
        return jsonify({
            "items": items,
            "low_stock": low_stock,
            "summary": {
                "sku_count": len(rows), "total_units": round(total_units, 0),
                "inventory_value": round(inv_value, 2), "retail_value": round(retail_value, 2),
                "potential_profit": round(retail_value - inv_value, 2),
                "low_stock_count": len(low_stock),
            },
        })
    finally:
        db.close()


# ── Reviews ───────────────────────────────────────────────────────────────────

@app.route("/api/upload/reviews/<int:user_id>", methods=["POST"])
def upload_reviews(user_id):
    """Upload customer reviews → ReviewData."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    try:
        from datetime import datetime as _dt
        raw, err = _read_upload_file(f)
        if err:
            return jsonify({"error": err}), 400
        if not raw:
            return jsonify({"error": "File is empty"}), 400
        hdr_i = _find_header_row(raw, _REVIEW_COL_MAP)
        rows = raw[hdr_i:]
        headers = list(rows[0])
        mapping = _resolve_mapping(
            rows, _REVIEW_COL_MAP,
            numeric_fields=("rating",),
            date_fields=("date",),
            text_fields=("sku", "product", "review_text"),
            label_field="product",
        )
        if "date" not in mapping:
            auto = _autodetect_date_col(headers, rows[1:])
            if auto is not None:
                mapping["date"] = auto
        print(f"[upload reviews] header row {hdr_i}: {headers} -> "
              f"{ {k: headers[v] for k, v in mapping.items()} }", flush=True)
        if "rating" not in mapping:
            return jsonify({"error": f"Couldn't find a rating column in this file. "
                                     f"Columns seen: {headers}"}), 400
        db = get_db()
        inserted = 0; skipped = 0
        try:
            db.query(ReviewData).filter_by(user_id=user_id, source="upload").delete()
            for row in rows[1:]:
                if all(str(v).strip() == "" for v in row):
                    continue
                rating = _safe_float(row[mapping["rating"]]) if "rating" in mapping and mapping["rating"] < len(row) else 0.0
                if rating == 0:
                    skipped += 1; continue
                date = _parse_date(row[mapping["date"]]) if "date" in mapping and mapping["date"] < len(row) else None
                sku     = str(row[mapping["sku"]]).strip()         if "sku"         in mapping and mapping["sku"]         < len(row) and row[mapping["sku"]].strip()         else None
                product = str(row[mapping["product"]]).strip()     if "product"     in mapping and mapping["product"]     < len(row) and row[mapping["product"]].strip()     else None
                text    = str(row[mapping["review_text"]]).strip() if "review_text" in mapping and mapping["review_text"] < len(row) and row[mapping["review_text"]].strip() else None
                db.add(ReviewData(user_id=user_id, date=date, sku=sku, product=product,
                                  rating=rating, review_text=text, source="upload"))
                inserted += 1
            db.commit()
        finally:
            db.close()
        return jsonify({"inserted": inserted, "skipped": skipped})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reviews/<int:user_id>", methods=["GET"])
def get_reviews(user_id):
    """Reviews dashboard: average rating, star distribution, per-product breakdown."""
    from datetime import datetime as _dt, timedelta as _td
    days = request.args.get("days")
    db = get_db()
    try:
        q = db.query(ReviewData).filter(ReviewData.user_id == user_id)
        if days and str(days).isdigit() and int(days) > 0:   # 0 / blank = all time
            q = q.filter(ReviewData.date >= _dt.now() - _td(days=int(days)))
        rows = q.order_by(ReviewData.date.desc()).all()
        dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        prod = {}
        total = 0.0
        for r in rows:
            total += r.rating or 0
            b = int(round(r.rating or 0))
            if b in dist:
                dist[b] += 1
            p = r.product or r.sku or "Unknown"
            d = prod.setdefault(p, {"sum": 0.0, "n": 0})
            d["sum"] += r.rating or 0; d["n"] += 1
        by_product = sorted(
            [{"product": p, "avg": round(d["sum"] / d["n"], 2), "count": d["n"]} for p, d in prod.items()],
            key=lambda x: x["avg"])
        reviews = [{"date": (r.date.isoformat() if r.date else None), "sku": r.sku,
                    "product": r.product, "rating": r.rating, "review_text": r.review_text}
                   for r in rows[:200]]
        return jsonify({
            "reviews": reviews,
            "summary": {"count": len(rows), "avg_rating": round(total / len(rows), 2) if rows else 0,
                        "positive_pct": round((dist[4] + dist[5]) / len(rows) * 100, 1) if rows else 0},
            "distribution": dist,
            "by_product": by_product,
        })
    finally:
        db.close()


# ── AI optimization (Dashboard) ───────────────────────────────────────────────

@app.route("/api/optimize/<int:user_id>", methods=["GET"])
def ai_optimize(user_id):
    """Small-business optimization advisor: benchmarked, cross-referencing,
    prescriptive recommendations per section. Empty sections say so explicitly.
    The engine lives in analysis/optimizer.py."""
    try:
        from analysis import optimizer
        raw = request.args.get("sections", "")
        focus = [x.strip() for x in raw.split(",") if x.strip()]
        return jsonify(optimizer.optimize(user_id, focus or None))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ask/<int:user_id>", methods=["POST"])
def ask_ai(user_id):
    """Data-grounded chat: answer a free-text question about the business using
    the user's own numbers + a small-business knowledge base."""
    body = request.json or {}
    question = body.get("question", "")
    pending = body.get("pending")     # topic the AI last asked context about, if any
    history = body.get("history")     # recent [{role,text}] so the LLM has context
    try:
        from analysis import assistant_qa
        return jsonify(assistant_qa.answer(user_id, question, pending, history))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/summary/<int:user_id>", methods=["GET"])
def data_summary(user_id):
    """Which datasets the user has uploaded + headline numbers. The Dashboard
    renders a card only for the datasets that come back non-null."""
    db = get_db()
    try:
        out = {}
        sales = db.query(SalesData).filter_by(user_id=user_id).all()
        out["sales"] = ({"count": len(sales),
                         "revenue": round(sum(s.revenue or 0 for s in sales), 2),
                         "orders": len(set(s.check_number for s in sales if s.check_number)) or len(sales)}
                        if sales else None)
        exp = db.query(ExpenseData).filter_by(user_id=user_id).all()
        out["expenses"] = ({"count": len(exp),
                            "total": round(sum(e.amount or 0 for e in exp), 2)} if exp else None)
        inv = db.query(InventoryData).filter_by(user_id=user_id).all()
        out["inventory"] = ({"count": len(inv),
                             "value": round(sum((i.unit_cost or 0) * (i.stock_qty or 0) for i in inv), 2),
                             "low_stock": sum(1 for i in inv if (i.reorder_level or 0) > 0 and (i.stock_qty or 0) <= (i.reorder_level or 0))}
                            if inv else None)
        revs = db.query(ReviewData).filter_by(user_id=user_id).all()
        out["reviews"] = ({"count": len(revs),
                           "avg": round(sum(r.rating or 0 for r in revs) / len(revs), 2)} if revs else None)
        shifts = db.query(ShiftData).filter_by(user_id=user_id).all()
        out["labor"] = ({"shifts": len(shifts),
                         "hours": round(sum(s.actual_hours or 0 for s in shifts), 1),
                         "cost": round(sum(s.labor_cost or 0 for s in shifts), 2)} if shifts else None)
        txns = db.query(TransactionData).filter_by(user_id=user_id).all()
        out["finances"] = ({"count": len(txns),
                            "net": round(sum((t.amount if t.is_deposit else -t.amount) for t in txns), 2)} if txns else None)
        tenders = db.query(TenderData).filter_by(user_id=user_id).all()
        out["tenders"] = ({"count": len(tenders),
                           "total": round(sum(t.amount or 0 for t in tenders), 2)} if tenders else None)
        return jsonify(out)
    finally:
        db.close()


@app.route("/api/business/<int:user_id>", methods=["GET"])
def get_business(user_id):
    """The user's business profile (context that sharpens the optimizer)."""
    db = get_db()
    try:
        p = db.query(BusinessProfile).filter_by(user_id=user_id).first()
        if not p:
            return jsonify({"name": "", "industry": "", "description": "",
                            "goal": "balance", "target_margin": None, "target_labor_pct": None,
                            "configured": False})
        return jsonify({"name": p.name or "", "industry": p.industry or "",
                        "description": p.description or "", "goal": p.goal or "balance",
                        "target_margin": p.target_margin, "target_labor_pct": p.target_labor_pct,
                        "configured": bool((p.industry or p.description or "").strip())})
    finally:
        db.close()


@app.route("/api/business/<int:user_id>", methods=["PUT"])
def save_business(user_id):
    """Create/update the business profile."""
    data = request.json or {}
    db = get_db()
    try:
        p = db.query(BusinessProfile).filter_by(user_id=user_id).first()
        if not p:
            p = BusinessProfile(user_id=user_id); db.add(p)
        p.name        = (data.get("name") or "").strip()[:120]
        p.industry    = (data.get("industry") or "").strip()[:40]
        p.description = (data.get("description") or "").strip()[:2000]
        p.goal        = (data.get("goal") or "balance").strip()[:40]
        def _num(v):
            try:
                return float(v) if v not in (None, "", "null") else None
            except Exception:
                return None
        p.target_margin    = _num(data.get("target_margin"))
        p.target_labor_pct = _num(data.get("target_labor_pct"))
        db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/data/<datatype>/<int:user_id>", methods=["DELETE"])
def delete_uploaded(datatype, user_id):
    """Delete a user's uploaded rows for one data type so they can replace it."""
    db = get_db()
    try:
        if datatype == "sales":
            n = db.query(SalesData).filter_by(user_id=user_id, source="upload").delete()
        elif datatype == "tenders":
            n = db.query(TenderData).filter_by(user_id=user_id, source="upload").delete()
        elif datatype == "expenses":
            n = db.query(ExpenseData).filter_by(user_id=user_id, source="upload").delete()
        elif datatype == "inventory":
            n = db.query(InventoryData).filter_by(user_id=user_id).delete()   # snapshot
        elif datatype == "reviews":
            n = db.query(ReviewData).filter_by(user_id=user_id, source="upload").delete()
        elif datatype == "labor":
            n = db.query(ShiftData).filter_by(user_id=user_id, source="upload").delete()
        elif datatype == "finances":
            n = db.query(TransactionData).filter(
                TransactionData.user_id == user_id,
                TransactionData.external_id.like(f"upload:{user_id}:%")).delete(synchronize_session=False)
        else:
            return jsonify({"error": f"Unknown data type '{datatype}'"}), 400
        db.commit()
        return jsonify({"deleted": int(n or 0)})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Connected accounts ────────────────────────────────────────────────────────

@app.route("/api/accounts/<int:user_id>", methods=["GET"])
def get_connected_accounts(user_id):
    db = get_db()
    try:
        accounts = db.query(ConnectedAccount).filter_by(user_id=user_id, is_active=True).all()
        return jsonify([{
            "id": a.id, "service": a.service, "account_name": a.account_name,
            "institution_name": a.institution_name, "external_id": a.external_id,
            "last_synced": a.last_synced.isoformat() if a.last_synced else None,
            "sync_frequency": a.sync_frequency,
            "created_at": a.created_at.isoformat()
        } for a in accounts])
    finally:
        db.close()


@app.route("/api/accounts/delete/<int:account_id>", methods=["POST"])
def delete_connected_account(account_id):
    db = get_db()
    try:
        account = db.query(ConnectedAccount).filter_by(id=account_id).first()
        if account:
            account.is_active = False
            # Also soft-delete the PlaidItem if this was a Plaid connection
            if account.service == "plaid" and account.external_id:
                item = db.query(PlaidItem).filter_by(
                    user_id=account.user_id, item_id=account.external_id
                ).first()
                if item:
                    db.delete(item)
            db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ── Plaid tokens for frontend ─────────────────────────────────────────────────

@app.route("/api/user-tokens/<int:user_id>", methods=["GET"])
def get_user_tokens(user_id):
    db = get_db()
    try:
        items = db.query(PlaidItem).filter_by(user_id=user_id).all()
        return jsonify([{
            "id": item.id, "product_type": item.product_type,
            "access_token": item.access_token, "institution_id": item.institution_id,
            "institution_name": item.institution_name or "Bank",
            "item_id": item.item_id, "created_at": item.created_at.isoformat()
        } for item in items])
    finally:
        db.close()


@app.route("/api/institution-logo/<institution_id>", methods=["GET"])
def get_institution_logo(institution_id):
    if institution_id in institution_logo_cache:
        return jsonify({"logo": institution_logo_cache[institution_id]})
    try:
        resp = client.institutions_get_by_id(InstitutionsGetByIdRequest(
            institution_id=institution_id,
            country_codes=[CountryCode("US")],
            options=InstitutionsGetByIdRequestOptions(include_optional_metadata=True)
        ))
        logo = resp.to_dict()["institution"].get("logo")
        institution_logo_cache[institution_id] = logo
        return jsonify({"logo": logo})
    except Exception as e:
        institution_logo_cache[institution_id] = None
        return jsonify({"logo": None})


# ── Plaid link & exchange ─────────────────────────────────────────────────────

@app.route("/api/link_token", methods=["POST"])
def create_link_token():
    global link_token_cache
    try:
        body = request.json or {}
        user_id = body.get("user_id", "user")
        products_list = body.get("products", ["transactions"])

        products_key = ",".join(sorted(products_list))
        if (link_token_cache["token"] and link_token_cache["products"] == products_key
                and time.time() < link_token_cache["expiry"]):
            return jsonify({"link_token": link_token_cache["token"]})

        link_request = LinkTokenCreateRequest(
            user={"client_user_id": str(user_id)},
            client_name="JetCore",
            products=[Products(p) for p in products_list],
            country_codes=[CountryCode("US")],
            language="en",
            redirect_uri="http://localhost:5000/exchange"
        )
        response = client.link_token_create(link_request)
        token = response.to_dict()["link_token"]

        link_token_cache["token"] = token
        link_token_cache["products"] = products_key
        link_token_cache["expiry"] = time.time() + 540
        return jsonify({"link_token": token})

    except Exception as e:
        print(f"[LinkToken] ERROR: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


@app.route("/exchange", methods=["GET"])
def exchange_token():
    db = get_db()
    try:
        public_token = request.args.get("public_token")
        user_id_str = request.args.get("user_id", "")
        products = request.args.get("products", "transactions,investments")

        if not public_token:
            return jsonify({"error": "No public_token"}), 400

        resp = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=public_token)
        ).to_dict()
        access_token = resp["access_token"]
        item_id = resp["item_id"]

        # Fetch institution info
        institution_id = institution_name = None
        try:
            item_resp = client.item_get(ItemGetRequest(access_token=access_token)).to_dict()
            institution_id = item_resp["item"].get("institution_id")
            if institution_id:
                inst = client.institutions_get_by_id(InstitutionsGetByIdRequest(
                    institution_id=institution_id, country_codes=[CountryCode("US")]
                )).to_dict()["institution"]
                institution_name = inst["name"]
        except Exception as e:
            print(f"[Exchange] Institution fetch failed: {e}")

        products_key = ",".join(sorted(products.split(",")))

        # Resolve user. In shell mode, force the bound user (ignore the query arg)
        # so a connected bank can never be attached to another account.
        user = get_shell_user(db) if is_shell_mode() else None
        if user is None:
            try:
                uid = int(user_id_str)
                user = db.query(User).filter_by(id=uid).first()
            except ValueError:
                user = db.query(User).filter(func.lower(User.email) == user_id_str.lower()).first()

        if not user:
            return jsonify({"error": "User not found"}), 404

        # Upsert PlaidItem
        existing = db.query(PlaidItem).filter_by(user_id=user.id, item_id=item_id).first()
        if existing:
            existing.access_token = access_token
            existing.product_type = products_key
            if institution_id:
                existing.institution_id = institution_id
            if institution_name:
                existing.institution_name = institution_name
        else:
            db.add(PlaidItem(
                user_id=user.id, product_type=products_key,
                item_id=item_id, access_token=access_token,
                institution_id=institution_id, institution_name=institution_name
            ))

        # Upsert ConnectedAccount for display
        ca = db.query(ConnectedAccount).filter_by(
            user_id=user.id, service="plaid", external_id=item_id
        ).first()
        if not ca:
            db.add(ConnectedAccount(
                user_id=user.id, service="plaid",
                account_name=institution_name or "Bank Account",
                institution_name=institution_name,
                external_id=item_id, last_synced=datetime.utcnow()
            ))
        else:
            ca.last_synced = datetime.utcnow()
            ca.is_active = True

        db.commit()
        print(f"[Exchange] Connected {institution_name} for user {user.id}")

        return """
        <html>
        <head><title>Connected - JetCore</title></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#1a1f2e 0%,#2d3561 100%)">
        <div style="background:white;padding:40px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;max-width:400px">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h1 style="color:#1a1f2e;margin-bottom:12px;font-size:24px">Bank Connected!</h1>
        <p style="color:#666;margin-bottom:28px;line-height:1.5">Your account has been linked to JetCore. Close this window and return to the app to run your analysis.</p>
        <button onclick="window.close()" style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;padding:14px 32px;font-size:16px;border-radius:8px;cursor:pointer;width:100%;font-weight:600">Close Window</button>
        </div></body></html>
        """

    except Exception as e:
        print(f"[Exchange] ERROR: {e}")
        traceback.print_exc()
        return f"<html><body><h1>Error: {str(e)}</h1><button onclick='window.close()'>Close</button></body></html>"
    finally:
        db.close()


@app.route("/link", methods=["GET"])
def plaid_link_page():
    user_id = request.args.get("user_id", "user")
    return render_template("plaid_link.html", user_id=user_id)


@app.route("/get_token", methods=["GET"])
def get_token():
    db = get_db()
    try:
        product_type = request.args.get("product_type", "transactions")
        # In shell mode, force the bound user; else use the query arg.
        if is_shell_mode():
            user = get_shell_user(db)
        else:
            user = db.query(User).filter_by(id=request.args.get("user_id")).first()
        if not user:
            return jsonify({"access_token": None, "error": "User not found"})
        item = db.query(PlaidItem).filter(
            PlaidItem.user_id == user.id,
            PlaidItem.product_type.contains(product_type)
        ).first()
        return jsonify({"access_token": item.access_token if item else None, "error": None})
    finally:
        db.close()


# ── Admin ─────────────────────────────────────────────────────────────────────

@app.route("/admin/clear-database", methods=["POST"])
def clear_database():
    db = get_db()
    try:
        data = request.json or {}
        if data.get("admin_key") != os.getenv("ADMIN_KEY", "dev-admin-key"):
            return jsonify({"error": "Unauthorized"}), 401
        for model in [ShiftData, TenderData, SalesData, UsageLog, Recommendation,
                      ConnectedAccount, Subscription, PlaidItem, User]:
            db.query(model).delete()
        db.commit()
        return jsonify({"success": True, "message": "Database cleared"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/admin/set-plan", methods=["POST"])
def admin_set_plan():
    db = get_db()
    try:
        data        = request.json or {}
        requester_id = int(data.get("requester_id", 0))
        target_id    = int(data.get("user_id", requester_id))
        new_plan     = data.get("plan", "")
        valid_plans  = ["free", "plus", "pro", "max", "enterprise"]
        if new_plan not in valid_plans:
            return jsonify({"error": "Invalid plan"}), 400
        requester = db.query(User).filter_by(id=requester_id).first()
        if not requester or not requester.is_admin:
            return jsonify({"error": "Unauthorized"}), 403
        sub = db.query(Subscription).filter_by(user_id=target_id).first()
        if sub:
            sub.plan = new_plan
        else:
            db.add(Subscription(user_id=target_id, plan=new_plan, status="active"))
        db.commit()
        return jsonify({"plan": new_plan})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/admin/clear-database-dev", methods=["POST"])
def clear_database_dev():
    """No-key clear for admin users only."""
    db = get_db()
    try:
        data = request.json or {}
        user = db.query(User).filter_by(id=data.get("user_id")).first()
        if not user or not user.is_admin:
            return jsonify({"error": "Unauthorized"}), 401
        for model in [ShiftData, TenderData, SalesData, UsageLog, Recommendation,
                      ConnectedAccount, Subscription, PlaidItem, User]:
            db.query(model).delete()
        db.commit()
        print(f"[ClearDatabase] Cleared by admin user {user.email}")
        return jsonify({"success": True, "message": "Database cleared"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── User Settings (alerts / thresholds) ──────────────────────────────────────

@app.route("/api/settings/<int:user_id>", methods=["GET"])
def get_settings(user_id):
    db = get_db()
    try:
        s = db.query(UserSettings).filter_by(user_id=user_id).first()
        if not s:
            return jsonify({"labor_threshold_pct": 35.0, "alerts_enabled": True})
        return jsonify({"labor_threshold_pct": s.labor_threshold_pct, "alerts_enabled": bool(s.alerts_enabled)})
    finally:
        db.close()

@app.route("/api/settings/<int:user_id>", methods=["POST"])
def save_settings(user_id):
    db = get_db()
    try:
        data = request.json or {}
        s = db.query(UserSettings).filter_by(user_id=user_id).first()
        if not s:
            s = UserSettings(user_id=user_id)
            db.add(s)
        if "labor_threshold_pct" in data:
            s.labor_threshold_pct = float(data["labor_threshold_pct"])
        if "alerts_enabled" in data:
            s.alerts_enabled = bool(data["alerts_enabled"])
        s.updated_at = datetime.utcnow()
        db.commit()
        return jsonify({"labor_threshold_pct": s.labor_threshold_pct, "alerts_enabled": bool(s.alerts_enabled)})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Profit (Revenue − Labor) ──────────────────────────────────────────────────

@app.route("/api/profit/<int:user_id>", methods=["GET"])
def get_profit(user_id):
    """Daily net profit = Oracle revenue - Homebase labor cost."""
    db = get_db()
    try:
        days   = int(request.args.get("days", 30))
        cutoff = datetime.utcnow() - timedelta(days=days)

        shifts  = db.query(ShiftData).filter(ShiftData.user_id == user_id, ShiftData.shift_date >= cutoff).all()
        tenders = db.query(TenderData).filter(TenderData.user_id == user_id, TenderData.date >= cutoff).all()

        labor_by_day: dict = {}
        for s in shifts:
            d = s.shift_date.strftime("%Y-%m-%d") if s.shift_date else None
            if d:
                labor_by_day[d] = labor_by_day.get(d, 0.0) + (s.labor_cost or 0.0)

        rev_by_day: dict = {}
        for t in tenders:
            d = t.date.strftime("%Y-%m-%d") if t.date else None
            if d:
                rev_by_day[d] = rev_by_day.get(d, 0.0) + (t.amount or 0.0)

        # Revenue can also come from itemised SALES (CSV uploads where each line's
        # Line Total is the revenue). Fall back to sales per-day when there are no
        # tender payments for that day — otherwise an upload shows $0 revenue.
        sales_rows = db.query(SalesData).filter(SalesData.user_id == user_id, SalesData.date >= cutoff).all()
        sales_by_day: dict = {}
        for s in sales_rows:
            d = s.date.strftime("%Y-%m-%d") if s.date else None
            if d:
                sales_by_day[d] = sales_by_day.get(d, 0.0) + (s.revenue or 0.0)

        all_dates = sorted(set(list(labor_by_day.keys()) + list(rev_by_day.keys()) + list(sales_by_day.keys())))
        daily = []
        for d in all_dates:
            labor   = labor_by_day.get(d, 0.0)
            revenue = rev_by_day.get(d, 0.0) or sales_by_day.get(d, 0.0)
            profit  = revenue - labor
            margin  = (profit / revenue * 100) if revenue > 0 else None
            daily.append({
                "date": d, "revenue": round(revenue, 2), "labor": round(labor, 2),
                "profit": round(profit, 2), "margin_pct": round(margin, 1) if margin is not None else None,
            })

        total_rev    = sum(r["revenue"] for r in daily)
        total_labor  = sum(r["labor"] for r in daily)
        total_profit = total_rev - total_labor
        avg_margin   = (total_profit / total_rev * 100) if total_rev > 0 else None

        return jsonify({
            "daily": daily,
            "summary": {
                "total_revenue": round(total_rev, 2),
                "total_labor": round(total_labor, 2),
                "total_profit": round(total_profit, 2),
                "avg_margin_pct": round(avg_margin, 1) if avg_margin is not None else None,
                "labor_pct": round(total_labor / total_rev * 100, 1) if total_rev > 0 else None,
            }
        })
    finally:
        db.close()


# ── Staffing Insights (day-of-week patterns) ──────────────────────────────────

@app.route("/api/labor/<int:user_id>/insights", methods=["GET"])
def get_labor_insights(user_id):
    """Analyze staffing vs. revenue by day of week to surface over/understaffing."""
    db = get_db()
    try:
        days   = int(request.args.get("days", 90))
        cutoff = datetime.utcnow() - timedelta(days=days)

        shifts  = db.query(ShiftData).filter(ShiftData.user_id == user_id, ShiftData.shift_date >= cutoff).all()
        tenders = db.query(TenderData).filter(TenderData.user_id == user_id, TenderData.date >= cutoff).all()

        DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
        labor_by_dow   = {d: {"cost": 0.0, "hours": 0.0, "days": set()} for d in DOW}
        revenue_by_dow = {d: {"amount": 0.0, "days": set()} for d in DOW}

        for s in shifts:
            if not s.shift_date: continue
            dow = DOW[s.shift_date.weekday()]
            labor_by_dow[dow]["cost"]  += s.labor_cost or 0.0
            labor_by_dow[dow]["hours"] += s.actual_hours or s.scheduled_hours or 0.0
            labor_by_dow[dow]["days"].add(s.shift_date.strftime("%Y-%m-%d"))

        for t in tenders:
            if not t.date: continue
            dow = DOW[t.date.weekday()]
            revenue_by_dow[dow]["amount"] += t.amount or 0.0
            revenue_by_dow[dow]["days"].add(t.date.strftime("%Y-%m-%d"))

        # Compute averages per occurrence of each day
        dow_data = []
        avg_labor_pct = None
        pcts = []
        for dow in DOW:
            n_labor = len(labor_by_dow[dow]["days"]) or 1
            n_rev   = len(revenue_by_dow[dow]["days"]) or 1
            avg_labor   = labor_by_dow[dow]["cost"]  / n_labor
            avg_hours   = labor_by_dow[dow]["hours"] / n_labor
            avg_revenue = revenue_by_dow[dow]["amount"] / n_rev
            labor_pct   = (avg_labor / avg_revenue * 100) if avg_revenue > 0 else None
            if labor_pct is not None:
                pcts.append(labor_pct)
            dow_data.append({
                "dow": dow,
                "avg_labor_cost": round(avg_labor, 2),
                "avg_hours": round(avg_hours, 2),
                "avg_revenue": round(avg_revenue, 2),
                "labor_pct": round(labor_pct, 1) if labor_pct is not None else None,
                "occurrences": n_labor,
            })

        if pcts:
            avg_labor_pct = sum(pcts) / len(pcts)

        # Flag outliers: days > 1.2× average = overstaffed; < 0.8× = potential understaffing
        insights = []
        for d in dow_data:
            if d["labor_pct"] is None or avg_labor_pct is None: continue
            ratio = d["labor_pct"] / avg_labor_pct
            if ratio >= 1.25:
                insights.append({
                    "dow": d["dow"], "type": "overstaffed",
                    "message": f"{d['dow']}s have {d['labor_pct']:.1f}% labor cost — {((ratio-1)*100):.0f}% above your weekly average. Consider trimming shifts.",
                    "labor_pct": d["labor_pct"],
                })
            elif ratio <= 0.75 and d["avg_revenue"] > 0:
                insights.append({
                    "dow": d["dow"], "type": "understaffed",
                    "message": f"{d['dow']}s drive strong revenue but only {d['labor_pct']:.1f}% labor — you may be running lean. Check if service quality is impacted.",
                    "labor_pct": d["labor_pct"],
                })

        return jsonify({"by_dow": dow_data, "insights": insights, "avg_labor_pct": round(avg_labor_pct, 1) if avg_labor_pct else None})
    finally:
        db.close()


# ── Tip Analysis ──────────────────────────────────────────────────────────────

@app.route("/api/tips/<int:user_id>", methods=["GET"])
def get_tip_analysis(user_id):
    """Analyse tip/gratuity tender lines from Oracle data."""
    db = get_db()
    try:
        days   = int(request.args.get("days", 30))
        cutoff = datetime.utcnow() - timedelta(days=days)

        tenders = db.query(TenderData).filter(TenderData.user_id == user_id, TenderData.date >= cutoff).all()

        TIP_KEYWORDS = {"tip", "gratuity", "service_charge", "service charge", "auto gratuity"}
        tip_rows    = [t for t in tenders if any(k in (t.tender_type or "").lower() for k in TIP_KEYWORDS)]
        non_tip_rev = sum(t.amount for t in tenders if not any(k in (t.tender_type or "").lower() for k in TIP_KEYWORDS))
        total_tips  = sum(t.amount for t in tip_rows)
        tip_pct     = (total_tips / non_tip_rev * 100) if non_tip_rev > 0 else None

        # Daily tip trend
        by_day: dict = {}
        for t in tip_rows:
            d = t.date.strftime("%Y-%m-%d") if t.date else None
            if d:
                by_day[d] = by_day.get(d, 0.0) + t.amount

        daily = [{"date": d, "tips": round(v, 2)} for d, v in sorted(by_day.items())]

        return jsonify({
            "total_tips": round(total_tips, 2),
            "non_tip_revenue": round(non_tip_rev, 2),
            "tip_pct": round(tip_pct, 2) if tip_pct is not None else None,
            "daily": daily,
            "has_tip_data": len(tip_rows) > 0,
        })
    finally:
        db.close()


# ── Cash Flow Projection (Plaid) ──────────────────────────────────────────────

@app.route("/api/cashflow/<int:user_id>", methods=["GET"])
def get_cashflow(user_id):
    """Historical daily cash flow + 30-day projection based on trailing 90-day averages."""
    db = get_db()
    try:
        days   = int(request.args.get("days", 90))
        cutoff = datetime.utcnow() - timedelta(days=days)

        txns = db.query(TransactionData).filter(
            TransactionData.user_id == user_id,
            TransactionData.date    >= cutoff,
        ).all()

        # Net daily cash flow (deposits positive, debits negative)
        daily_net: dict = {}
        for t in txns:
            d = t.date.strftime("%Y-%m-%d") if t.date else None
            if not d: continue
            net = -t.amount if not t.is_deposit else t.amount
            daily_net[d] = daily_net.get(d, 0.0) + net

        historical = [{"date": d, "net": round(v, 2)} for d, v in sorted(daily_net.items())]

        # Weekly average in/out for projection
        avg_weekly_in  = sum(v for v in daily_net.values() if v > 0) / max(days / 7, 1)
        avg_weekly_out = sum(v for v in daily_net.values() if v < 0) / max(days / 7, 1)
        avg_daily_net  = sum(daily_net.values()) / max(len(daily_net), 1)

        # 30-day projection from today
        today = datetime.utcnow().date()
        # Get Plaid balances for starting point
        plaid_items = db.query(PlaidItem).filter_by(user_id=user_id).all()
        current_balance = 0.0
        if plaid_items:
            try:
                from plaid.model.accounts_get_request import AccountsGetRequest as AGR
                for item in plaid_items:
                    req = AGR(access_token=item.access_token)
                    resp = client.accounts_get(req)
                    for acct in resp.accounts:
                        if acct.balances.current:
                            current_balance += acct.balances.current
            except Exception:
                pass

        projection = []
        running = current_balance
        for i in range(1, 31):
            proj_date = (today + timedelta(days=i)).isoformat()
            running += avg_daily_net
            projection.append({"date": proj_date, "projected_balance": round(running, 2)})

        return jsonify({
            "historical": historical,
            "projection": projection,
            "current_balance": round(current_balance, 2),
            "avg_daily_net": round(avg_daily_net, 2),
            "avg_weekly_in": round(avg_weekly_in, 2),
            "avg_weekly_out": round(avg_weekly_out, 2),
        })
    finally:
        db.close()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "app": "JetCore"}), 200


# ── Request / response logging hooks ─────────────────────────────────────────

@app.before_request
def _before():
    request._start_ts = time.time()
    # Shell-mode hard scoping: the embedded frontend only knows the bound user's
    # id, but to GUARANTEE no cross-user leak we force every `<int:user_id>` route
    # param to the shell user's id. This makes ALL path-scoped data endpoints
    # (sales, labor, tenders, transactions, finances, settings, workspaces,
    # accounts, credentials, recommendations, profit, tips, cashflow, insights,
    # user profile, uploads, sync, user-tokens, plaid) resolve to the shell user
    # regardless of what id is in the URL. No-op in standalone mode.
    if is_shell_mode():
        view_args = request.view_args or {}
        if "user_id" in view_args:
            db = get_db()
            try:
                su = get_shell_user(db)
                if su is not None:
                    view_args["user_id"] = su.id
            finally:
                db.close()

@app.after_request
def _after(response):
    try:
        elapsed_ms = round((time.time() - getattr(request, "_start_ts", time.time())) * 1000)
        path = request.path
        if path.startswith("/static") or path == "/health":
            return response

        # Redact sensitive fields from logged body
        body = {}
        if request.is_json:
            raw = request.get_json(silent=True) or {}
            body = {k: ("***" if k in {"password", "access_token", "token"} else v)
                    for k, v in raw.items()}

        uid_header = request.headers.get("Authorization", "")
        token_str  = uid_header.replace("Bearer ", "")
        req_user   = decode_jwt(token_str) if token_str else None

        level = "ERROR" if response.status_code >= 500 else (
                "WARN"  if response.status_code >= 400 else "INFO")

        _add_log(level, "HTTP", f"{request.method} {path} → {response.status_code} ({elapsed_ms}ms)", {
            "method":      request.method,
            "path":        path,
            "status":      response.status_code,
            "elapsed_ms":  elapsed_ms,
            "user_id":     req_user,
            "ip":          request.remote_addr,
            "body":        body,
            "query":       dict(request.args),
        })
    except Exception:
        pass
    return response


# ── Admin endpoints ───────────────────────────────────────────────────────────

def _require_admin():
    """Returns user object if admin, else (error_response, status_code)."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = decode_jwt(token)
    if not uid:
        return None, jsonify({"error": "Unauthorized"}), 401
    db = get_db()
    user = db.query(User).filter_by(id=uid).first()
    db.close()
    if not user or not user.is_admin:
        return None, jsonify({"error": "Admin only"}), 403
    return user, None, None


@app.route("/api/admin/logs", methods=["GET"])
def admin_get_logs():
    user, err, code = _require_admin()
    if err:
        return err, code
    level_filter = request.args.get("level", "").upper()
    with _log_lock:
        logs = list(_log_buffer)
    if level_filter and level_filter != "ALL":
        logs = [l for l in logs if l["level"] == level_filter]
    return jsonify(list(reversed(logs)))


@app.route("/api/admin/users", methods=["GET"])
def admin_get_users():
    user, err, code = _require_admin()
    if err:
        return err, code
    db = get_db()
    try:
        users = db.query(User).order_by(User.created_at.desc()).all()
        result = []
        for u in users:
            plan = _user_plan(db, u.id)
            acct_count = db.query(ConnectedAccount).filter_by(user_id=u.id, is_active=True).count()
            result.append({
                "id":           u.id,
                "email":        u.email,
                "first_name":   u.first_name,
                "last_name":    u.last_name,
                "company_name": u.company_name,
                "segment":      u.segment,
                "plan":         plan,
                "is_admin":     u.is_admin,
                "acct_count":   acct_count,
                "created_at":   u.created_at.isoformat(),
            })
        return jsonify(result)
    finally:
        db.close()


# ── React SPA catch-all ───────────────────────────────────────────────────────
# Serve the React build for every non-API route so client-side routing works.

@app.route("/", defaults={"path": ""}, methods=["GET", "OPTIONS"])
@app.route("/<path:path>",             methods=["GET", "OPTIONS"])
def serve_react(path):
    full = os.path.join(REACT_DIR, path)
    if path and os.path.exists(full):
        return send_from_directory(REACT_DIR, path)
    return send_from_directory(REACT_DIR, "index.html")


def _ensure_ollama():
    """Start the local LLM (userspace Ollama) if it isn't already running, so the
    AI chat has a real language model. No-op if Ollama is already up or absent."""
    import urllib.request as _u
    try:
        _u.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.5)
        return  # already running
    except Exception:
        pass
    binp = os.path.expanduser("~/ollama/dist/bin/ollama")
    if not os.path.exists(binp):
        return
    try:
        env = dict(os.environ, OLLAMA_HOST="127.0.0.1:11434",
                   OLLAMA_MODELS=os.path.expanduser("~/ollama/models"))
        import subprocess
        subprocess.Popen([binp, "serve"], env=env,
                         stdout=open(os.path.expanduser("~/ollama/serve.log"), "a"),
                         stderr=subprocess.STDOUT, start_new_session=True)
        print("[Summit] started local LLM (Ollama) for the AI assistant", flush=True)
    except Exception as e:
        print(f"[Summit] could not start Ollama: {e}", flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("JETCORE_PORT", 5000))
    host = os.environ.get("JETCORE_HOST", "0.0.0.0")  # bind all interfaces so it's reachable on the LAN
    _ensure_ollama()
    app.run(host=host, port=port, debug=False, threaded=True)
