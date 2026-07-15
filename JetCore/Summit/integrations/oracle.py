"""
Oracle MICROS / Simphony integration — sales, tenders, and revenue data.

Oracle Simphony Cloud REST API:
  Docs:    https://docs.oracle.com/en/industries/food-beverage/simphony/
  Auth:    OAuth 2.0 client credentials
  Config:  {
             "environment_url": "https://<your-env>.oraclehospitality.com",
             "client_id":       "...",
             "client_secret":   "...",
             "location_ref":    "...",   # Revenue center / location GUID
           }

Oracle MICROS On-Premise (older installs):
  Uses a different base URL and may require a service account key instead of OAuth.
  Set "auth_type": "api_key" and "api_key": "..." in config to use that path.
"""
import requests
from datetime import datetime, timedelta, timezone


class OracleClient:
    def __init__(self, environment_url: str, client_id: str, client_secret: str,
                 location_ref: str, auth_type: str = "oauth"):
        self.base_url = environment_url.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.location_ref = location_ref
        self.auth_type = auth_type
        self._token = None
        self._token_expiry = datetime.min

    # ── Auth ──────────────────────────────────────────────────────────────────

    def _ensure_token(self):
        if self.auth_type != "oauth":
            return
        if self._token and datetime.now(timezone.utc) < self._token_expiry:
            return
        # Oracle Simphony Cloud OIDC token endpoint (client_credentials flow)
        resp = requests.post(
            f"{self.base_url}/oidc-provider/v1/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "openid",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10
        )
        resp.raise_for_status()
        body = resp.json()
        self._token = body["access_token"]
        self._token_expiry = datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)

    def _headers(self) -> dict:
        self._ensure_token()
        if self.auth_type == "oauth":
            return {
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        # API key path (MICROS on-premise)
        return {
            "Authorization": f"Bearer {self.client_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    # ── API calls ─────────────────────────────────────────────────────────────

    def verify(self) -> dict:
        """
        Verify credentials. For OAuth, confirms the token endpoint accepts the
        client credentials. For API key, confirms the environment URL is reachable.
        Uses OIDC discovery endpoint — available on all Simphony Cloud hosts.
        """
        if self.auth_type == "oauth":
            # _ensure_token() will raise if client_id/secret are wrong
            self._ensure_token()
            return {"authenticated": True, "location_ref": self.location_ref}
        else:
            # On-premise: just check the host is reachable
            resp = requests.get(f"{self.base_url}/oidc-provider/v1/.well-known/openid-configuration",
                                timeout=10)
            resp.raise_for_status()
            return resp.json()

    def get_daily_totals(self, date: datetime) -> dict:
        """
        Fetch daily revenue summary for a given date.
        Returns: { "net_sales": float, "check_count": int, "guest_count": int, ... }
        """
        date_str = date.strftime("%Y-%m-%d")
        resp = requests.get(
            f"{self.base_url}/reports/v1/daily-totals",
            headers=self._headers(),
            params={"locationRef": self.location_ref, "businessDate": date_str},
            timeout=15
        )
        resp.raise_for_status()
        return resp.json()

    def get_tender_report(self, start_date: datetime, end_date: datetime) -> list:
        """
        Fetch payment tender breakdown for a date range.
        Returns list of: { "tenderType": str, "amount": float, "count": int, "date": str, ... }
        """
        resp = requests.get(
            f"{self.base_url}/reports/v1/tender-media",
            headers=self._headers(),
            params={
                "locationRef": self.location_ref,
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
            },
            timeout=15
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("tenderMedia", body) if isinstance(body, dict) else body

    def get_item_sales(self, start_date: datetime, end_date: datetime) -> list:
        """
        Fetch item-level sales (menu mix report).
        Returns list of: { "itemName": str, "category": str, "quantitySold": int, "netSales": float, ... }
        """
        resp = requests.get(
            f"{self.base_url}/reports/v1/menu-mix",
            headers=self._headers(),
            params={
                "locationRef": self.location_ref,
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
            },
            timeout=15
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("menuItems", body) if isinstance(body, dict) else body

    def get_hourly_sales(self, start_date: datetime, end_date: datetime) -> list:
        """
        Fetch revenue aggregated by hour across the date range.
        Returns list of: { "hour": int, "netSales": float, "checkCount": int, "date": str }
        """
        resp = requests.get(
            f"{self.base_url}/reports/v1/hourly-totals",
            headers=self._headers(),
            params={
                "locationRef": self.location_ref,
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
            },
            timeout=15
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("hourlyTotals", body) if isinstance(body, dict) else body

    # ── Sync to DB ────────────────────────────────────────────────────────────

    def sync_to_db(self, user_id: int, days: int, db, progress_cb=None) -> dict:
        """
        Pull the last `days` days of tender and sales data,
        upsert into TenderData and SalesData tables.
        Returns {"tenders": N, "items": N, "hourly": N}.
        """
        from models import TenderData, SalesData

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        tender_count = item_count = hourly_count = 0

        # ── Tenders ───────────────────────────────────────────────────────
        try:
            tenders = self.get_tender_report(start, end)
            for row in tenders:
                date = _parse_dt(row.get("date") or row.get("businessDate"))
                if not date:
                    continue
                tender_type = _normalise_tender(
                    row.get("tenderType") or row.get("tender_type") or row.get("name", "other")
                )
                amount = float(row.get("amount") or row.get("netAmount") or 0)
                count = int(row.get("count") or row.get("transactionCount") or 0)
                rev_center = row.get("revenueCenter") or row.get("revenue_center") or ""

                existing = db.query(TenderData).filter_by(
                    user_id=user_id, date=date.date() if hasattr(date, 'date') else date,
                    tender_type=tender_type, location_ref=self.location_ref
                ).first()

                if existing:
                    existing.amount = amount
                    existing.transaction_count = count
                else:
                    db.add(TenderData(
                        user_id=user_id, date=date, tender_type=tender_type,
                        amount=amount, transaction_count=count,
                        revenue_center=rev_center, location_ref=self.location_ref,
                        source="oracle"
                    ))
                tender_count += 1
            db.commit()
        except Exception as e:
            print(f"[Oracle] Tender sync error: {e}")
            db.rollback()
        if progress_cb:
            progress_cb(1)

        # ── Item sales ────────────────────────────────────────────────────
        try:
            items = self.get_item_sales(start, end)
            for row in items:
                date = _parse_dt(row.get("date") or row.get("businessDate")) or end
                item_name = row.get("itemName") or row.get("name") or "Unknown"
                category = row.get("category") or row.get("menuCategory") or ""
                qty = float(row.get("quantitySold") or row.get("quantity") or 0)
                revenue = float(row.get("netSales") or row.get("revenue") or 0)

                existing = db.query(SalesData).filter_by(
                    user_id=user_id, item=item_name, source="oracle",
                    date=date
                ).first()

                if existing:
                    existing.quantity_sold = qty
                    existing.revenue = revenue
                else:
                    db.add(SalesData(
                        user_id=user_id, date=date, item=item_name,
                        quantity_sold=qty, revenue=revenue,
                        source="oracle"
                    ))
                item_count += 1
            db.commit()
        except Exception as e:
            print(f"[Oracle] Item sales sync error: {e}")
            db.rollback()
        if progress_cb:
            progress_cb(2)

        # ── Hourly sales ──────────────────────────────────────────────────
        try:
            hourly = self.get_hourly_sales(start, end)
            for row in hourly:
                date = _parse_dt(row.get("date") or row.get("businessDate")) or end
                hour = int(row.get("hour") or 0)
                revenue = float(row.get("netSales") or row.get("revenue") or 0)

                existing = db.query(SalesData).filter_by(
                    user_id=user_id, date=date, hour=hour, source="oracle_hourly"
                ).first()

                if existing:
                    existing.revenue = revenue
                else:
                    db.add(SalesData(
                        user_id=user_id, date=date, hour=hour,
                        quantity_sold=float(row.get("checkCount") or 0),
                        revenue=revenue, source="oracle_hourly"
                    ))
                hourly_count += 1
            db.commit()
        except Exception as e:
            print(f"[Oracle] Hourly sync error: {e}")
            db.rollback()
        if progress_cb:
            progress_cb(3)

        return {"tenders": tender_count, "items": item_count, "hourly": hourly_count}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value)[:len(fmt)], fmt)
        except ValueError:
            continue
    return None


_TENDER_MAP = {
    "cash": "cash",
    "visa": "credit_card", "mastercard": "credit_card", "amex": "credit_card",
    "american express": "credit_card", "credit": "credit_card", "debit": "debit_card",
    "gift": "gift_card", "giftcard": "gift_card", "gift card": "gift_card",
    "comp": "comp", "void": "void", "house account": "house_account",
}


def _normalise_tender(raw: str) -> str:
    key = raw.strip().lower()
    for pattern, canonical in _TENDER_MAP.items():
        if pattern in key:
            return canonical
    return key.replace(" ", "_")
