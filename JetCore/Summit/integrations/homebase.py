"""
Homebase API integration — scheduled shifts and labor costs.

Auth:   Bearer token — generate at app.joinhomebase.com → Settings → Integrations → API
Config: {"api_key": "..."}

Confirmed response shapes (from live API inspection):
  Location:  { uuid, name, address_1, city, state, ... }
  Shift:     { id, first_name, last_name, role, department, start_at, end_at,
               wage_rate, labor: { scheduled_hours, scheduled_costs,
               scheduled_daily_overtime, scheduled_overtime, ... } }
  Employee:  { id, first_name, last_name, email,
               job: { default_role, wage_rate, wage_type } }

Note: /timesheets endpoint does not exist on the public API. Only scheduled
shifts are available, so actual_hours/actual_start/actual_end stay null.
"""
import time
import requests
from datetime import datetime, timedelta, timezone


BASE_URL = "https://app.joinhomebase.com/api/public"


class HomebaseClient:
    def __init__(self, api_key: str):
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    # ── API calls ────────────────────────────────────────────────────────────

    def get_locations(self) -> list:
        resp = self.session.get(f"{BASE_URL}/locations", timeout=10)
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, list) else body.get("locations", body.get("data", []))

    def verify(self) -> dict:
        locations = self.get_locations()
        return {"locations": locations, "count": len(locations)}

    def get_employees(self, location_uuid: str) -> list:
        resp = self.session.get(
            f"{BASE_URL}/locations/{location_uuid}/employees",
            timeout=10
        )
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, list) else body.get("employees", body.get("data", []))

    def get_shifts(self, location_uuid: str, start_date: datetime, end_date: datetime) -> list:
        """
        Scheduled shifts, paginated (25 per page via Link header).
        Retries on 429 using Retry-After header (or exponential backoff).
        """
        all_shifts = []
        params = {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date":   end_date.strftime("%Y-%m-%d"),
        }
        url = f"{BASE_URL}/locations/{location_uuid}/shifts"

        while url:
            resp = self._get_with_retry(url, params=params)
            body = resp.json()
            page = body if isinstance(body, list) else body.get("shifts", body.get("data", []))
            all_shifts.extend(page)

            # Parse Link header for rel="next"
            url = _next_link(resp.headers.get("Link", ""))
            params = {}  # URL already contains params after page 1

        return all_shifts

    def _get_with_retry(self, url: str, params: dict = None, max_retries: int = 5):
        """GET with exponential backoff on 429 Too Many Requests."""
        delay = 2.0
        for attempt in range(max_retries):
            resp = self.session.get(url, params=params, timeout=15)
            if resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", delay))
                wait = max(retry_after, delay)
                print(f"[Homebase] 429 rate-limited — waiting {wait:.0f}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                delay = min(delay * 2, 60)  # cap at 60s
                continue
            resp.raise_for_status()
            return resp
        # final attempt
        resp = self.session.get(url, params=params, timeout=15)
        resp.raise_for_status()
        return resp

    # ── Sync to DB ────────────────────────────────────────────────────────────

    def sync_to_db(self, user_id: int, days: int, db, progress_cb=None) -> dict:
        """
        Pull the last `days` days of scheduled shifts across all locations
        and upsert into ShiftData. Returns {"shifts": N}.
        """
        from models import ShiftData

        end   = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        locations = self.get_locations()
        if not locations:
            print("[Homebase] No locations found for this API key.")
            return {"shifts": 0}

        shift_count = 0

        for loc in locations:
            loc_uuid = loc.get("uuid") or loc.get("id") or ""
            if not loc_uuid:
                continue

            try:
                # Chunk into 30-day windows — Homebase caps date ranges per request.
                # Each chunk is caught individually so a failed older chunk doesn't
                # roll back the successful recent ones.
                raw_shifts: list = []
                chunk_end = end
                chunk_num = 0
                while chunk_end > start:
                    chunk_start = max(start, chunk_end - timedelta(days=30))
                    chunk_num += 1
                    try:
                        chunk_data = self.get_shifts(loc_uuid, chunk_start, chunk_end)
                        raw_shifts.extend(chunk_data)
                        print(
                            f"[Homebase] chunk {chunk_num}: "
                            f"{chunk_start.strftime('%Y-%m-%d')} → "
                            f"{chunk_end.strftime('%Y-%m-%d')}: "
                            f"{len(chunk_data)} shifts"
                        )
                    except Exception as chunk_err:
                        print(
                            f"[Homebase] chunk {chunk_num} error "
                            f"({chunk_start.strftime('%Y-%m-%d')} → "
                            f"{chunk_end.strftime('%Y-%m-%d')}): {chunk_err}"
                        )
                    chunk_end = chunk_start
                    if progress_cb:
                        progress_cb(chunk_num)
                    time.sleep(1.5)  # throttle between chunks to avoid 429

                # Deduplicate across chunks
                seen_ids: set = set()
                shifts: list = []
                for s in raw_shifts:
                    sid = s.get("id")
                    if sid not in seen_ids:
                        seen_ids.add(sid)
                        shifts.append(s)

                print(f"[Homebase] loc={loc_uuid} total unique shifts={len(shifts)} across {chunk_num} chunks")

                for sh in shifts:
                    ext_id = f"sh_{sh.get('id', '')}"

                    # ── Employee name (flat fields on the shift record) ─────
                    first    = (sh.get("first_name") or "").strip()
                    last     = (sh.get("last_name")  or "").strip()
                    emp_name = f"{first} {last}".strip() or "Unknown"

                    role = sh.get("role") or ""
                    dept = sh.get("department") or ""

                    # ── Times ─────────────────────────────────────────────
                    sched_start = _parse_dt(sh.get("start_at"))
                    sched_end   = _parse_dt(sh.get("end_at"))

                    # ── Labor nested object ────────────────────────────────
                    labor      = sh.get("labor") or {}
                    sched_hrs  = float(
                        labor.get("scheduled_hours") or
                        labor.get("scheduled_regular") or
                        _hours_between(sched_start, sched_end)
                    )
                    wage_rate  = float(sh.get("wage_rate") or 0)
                    labor_cost = float(
                        labor.get("scheduled_costs") or
                        (sched_hrs * wage_rate)
                    )
                    ot_hrs = float(
                        labor.get("scheduled_daily_overtime") or
                        labor.get("scheduled_overtime") or
                        labor.get("scheduled_weekly_overtime") or 0
                    )
                    is_ot = ot_hrs > 0

                    existing = db.query(ShiftData).filter_by(
                        user_id=user_id, external_id=ext_id
                    ).first()

                    if existing:
                        existing.employee_name   = emp_name
                        existing.role            = role
                        existing.department      = dept
                        existing.shift_date      = sched_start or existing.shift_date
                        existing.scheduled_start = sched_start
                        existing.scheduled_end   = sched_end
                        existing.scheduled_hours = sched_hrs
                        existing.actual_hours    = sched_hrs  # best proxy — no timesheets API
                        existing.hourly_rate     = wage_rate
                        existing.labor_cost      = labor_cost
                        existing.is_overtime     = is_ot
                    else:
                        db.add(ShiftData(
                            user_id=user_id,
                            external_id=ext_id,
                            employee_name=emp_name,
                            role=role,
                            department=dept,
                            shift_date=sched_start or datetime.now(timezone.utc),
                            scheduled_start=sched_start,
                            scheduled_end=sched_end,
                            scheduled_hours=sched_hrs,
                            actual_hours=sched_hrs,  # best proxy — no timesheets API
                            hourly_rate=wage_rate,
                            labor_cost=labor_cost,
                            is_overtime=is_ot,
                            source="homebase",
                        ))
                    shift_count += 1

                db.commit()
            except Exception as e:
                print(f"[Homebase] Shift sync error (loc {loc_uuid}): {e}")
                db.rollback()

        return {"shifts": shift_count}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_dt(value) -> datetime | None:
    """Parse ISO 8601 datetime strings, returning UTC-naive datetime for DB storage."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    s = str(value).strip()
    # fromisoformat handles "2026-04-23T11:00:00-07:00" in Python 3.7+
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        # Convert to UTC-naive so it's comparable with datetime.utcnow() in the DB layer
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, AttributeError):
        pass
    # Fallback for non-standard formats
    for fmt, length in [("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d", 10)]:
        try:
            return datetime.strptime(s[:length], fmt)
        except ValueError:
            continue
    return None


def _next_link(link_header: str) -> str | None:
    """Parse RFC 5988 Link header and return the rel='next' URL, or None."""
    for part in link_header.split(","):
        url_part, *rels = part.strip().split(";")
        if any("next" in r for r in rels):
            return url_part.strip().strip("<>")
    return None


def _hours_between(start: datetime | None, end: datetime | None) -> float:
    if not start or not end:
        return 0.0
    try:
        delta = (end.replace(tzinfo=None) - start.replace(tzinfo=None)).total_seconds()
        return max(0.0, round(delta / 3600, 2))
    except Exception:
        return 0.0
