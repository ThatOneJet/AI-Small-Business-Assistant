"""
Toast POS integration stub.
Get sandbox credentials at: https://developer.toasttab.com/
"""
import requests
from datetime import datetime, timedelta


class ToastIntegration:
    BASE_URL = "https://ws-api.toasttab.com/orders/v2"

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._access_token = None

    def _authenticate(self):
        """Exchange client credentials for access token."""
        resp = requests.post(
            "https://ws-api.toasttab.com/authentication/v1/authentication/login",
            json={
                "clientId": self.client_id,
                "clientSecret": self.client_secret,
                "userAccessType": "TOAST_MACHINE_CLIENT"
            }
        )
        resp.raise_for_status()
        self._access_token = resp.json()["token"]["accessToken"]

    def _headers(self):
        if not self._access_token:
            self._authenticate()
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Toast-Restaurant-External-ID": self.restaurant_guid
        }

    def fetch_orders(self, restaurant_guid: str, start_date: datetime, end_date: datetime):
        """Fetch order data from Toast for a given restaurant and date range."""
        self.restaurant_guid = restaurant_guid
        resp = requests.get(
            f"{self.BASE_URL}/orders",
            headers=self._headers(),
            params={
                "startDate": start_date.strftime("%Y%m%d%H%M%S%f")[:-3],
                "endDate": end_date.strftime("%Y%m%d%H%M%S%f")[:-3]
            }
        )
        resp.raise_for_status()
        return resp.json()

    def parse_sales_data(self, orders: list) -> list:
        """Convert Toast orders into SalesData-compatible dicts."""
        rows = []
        for order in orders:
            created = order.get("createdDate", "")
            try:
                dt = datetime.fromisoformat(created[:19])
            except Exception:
                continue

            for check in order.get("checks", []):
                for selection in check.get("selections", []):
                    rows.append({
                        "date": dt,
                        "hour": dt.hour,
                        "item": selection.get("displayName", "Unknown"),
                        "quantity_sold": float(selection.get("quantity", 1)),
                        "revenue": float(selection.get("price", 0)) / 100,
                        "source": "toast"
                    })
        return rows

    def sync(self, restaurant_guid: str, days: int = 30) -> list:
        """Sync last N days of sales data. Returns list of sale dicts."""
        end = datetime.utcnow()
        start = end - timedelta(days=days)
        orders = self.fetch_orders(restaurant_guid, start, end)
        return self.parse_sales_data(orders)
