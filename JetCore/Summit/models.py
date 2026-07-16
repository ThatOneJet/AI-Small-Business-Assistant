from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship, declarative_base, sessionmaker
from datetime import datetime
import os, sys

Base = declarative_base()

if getattr(sys, 'frozen', False):
    # PyInstaller bundle — store DB in writable AppData dir, not the install dir
    _data_dir = os.path.join(os.getenv('APPDATA', os.path.expanduser('~')), 'JetCore')
    os.makedirs(_data_dir, exist_ok=True)
    DB_PATH = os.path.join(_data_dir, "optiflow.db")
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "optiflow.db")

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    # Supabase (JetCore account) user id when running embedded under the Decks
    # shell. Lets us scope ALL Operations data to the signed-in JetCore account
    # rather than this app's own standalone Flask login. Nullable for standalone.
    supabase_uid = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=False)
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    company_name = Column(String, default="")
    segment = Column(String, default="individual")  # individual | small_biz | restaurant
    is_admin = Column(Boolean, default=False)
    avatar = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")
    connected_accounts = relationship("ConnectedAccount", back_populates="user", cascade="all, delete-orphan")
    recommendations = relationship("Recommendation", back_populates="user", cascade="all, delete-orphan")
    usage_logs = relationship("UsageLog", back_populates="user", cascade="all, delete-orphan")
    plaid_items = relationship("PlaidItem", back_populates="user", cascade="all, delete-orphan")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plan = Column(String, default="free")       # free | pro
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    status = Column(String, default="active")   # active | canceled | past_due
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="subscriptions")


class ConnectedAccount(Base):
    __tablename__ = "connected_accounts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    service = Column(String)                    # plaid | toast | square | csv
    account_name = Column(String)
    institution_name = Column(String, nullable=True)
    external_id = Column(String, nullable=True) # Plaid item_id, Toast location_id, etc.
    last_synced = Column(DateTime, nullable=True)
    sync_frequency = Column(String, default="daily")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="connected_accounts")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String)                   # inventory | labor | waste | tool_audit | tax_planning
    title = Column(String)
    description = Column(String)
    monthly_savings = Column(Float, default=0.0)
    implementation_difficulty = Column(String, default="medium")  # easy | medium | hard
    ai_confidence = Column(Float, default=0.8)  # 0.0 - 1.0
    is_implemented = Column(Boolean, default=False)
    actual_savings = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="recommendations")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String)
    feature = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="usage_logs")


class PlaidItem(Base):
    """Stores Plaid access tokens. Linked to ConnectedAccount for display."""
    __tablename__ = "plaid_items"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    product_type = Column(String, nullable=False)  # comma-joined e.g. "investments,transactions"
    item_id = Column(String, nullable=False)
    access_token = Column(String, nullable=False)
    institution_id = Column(String, nullable=True)
    institution_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="plaid_items")


class TransactionData(Base):
    """Bank transactions fetched from Plaid. Positive amount = debit (money out), negative = credit (money in)."""
    __tablename__ = "transaction_data"

    id               = Column(Integer, primary_key=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False)
    external_id      = Column(String, unique=True)       # Plaid transaction_id
    account_id       = Column(String)
    institution_name = Column(String, nullable=True)
    date             = Column(DateTime, nullable=False)
    amount           = Column(Float, nullable=False)     # always positive (abs value)
    description      = Column(String, nullable=True)     # Plaid 'name'
    merchant_name    = Column(String, nullable=True)
    logo_url         = Column(String, nullable=True)     # Plaid-provided merchant logo URL
    institution_id   = Column(String, nullable=True)     # Plaid institution_id for logo fallback
    is_deposit       = Column(Boolean, default=False)    # True = credit (money in)
    is_important     = Column(Boolean, default=False)    # user-starred for Overview tracking
    created_at       = Column(DateTime, default=datetime.utcnow)


class ExpenseData(Base):
    __tablename__ = "expense_data"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(DateTime)
    amount = Column(Float)
    category = Column(String)
    description = Column(String, nullable=True)
    source = Column(String, default="plaid")    # plaid | upload | manual
    created_at = Column(DateTime, default=datetime.utcnow)


class SalesData(Base):
    __tablename__ = "sales_data"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(DateTime)
    hour = Column(Integer, nullable=True)       # 0-23
    item = Column(String, nullable=True)
    quantity_sold = Column(Float, default=0.0)
    revenue = Column(Float, default=0.0)
    check_number = Column(String, nullable=True)  # order/check id — lets us count orders
    source = Column(String, default="manual")   # toast | square | manual
    created_at = Column(DateTime, default=datetime.utcnow)


class LaborData(Base):
    __tablename__ = "labor_data"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(DateTime)
    hour = Column(Integer, nullable=True)
    staff_count = Column(Integer, default=0)
    labor_cost = Column(Float, default=0.0)
    source = Column(String, default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)


class ShiftData(Base):
    """Individual shift records from Homebase."""
    __tablename__ = "shift_data"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    external_id = Column(String, nullable=True)       # Homebase timesheet/shift ID
    employee_name = Column(String)
    role = Column(String, nullable=True)
    department = Column(String, nullable=True)
    shift_date = Column(DateTime)
    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    scheduled_hours = Column(Float, default=0.0)
    actual_hours = Column(Float, default=0.0)
    hourly_rate = Column(Float, nullable=True)
    labor_cost = Column(Float, default=0.0)
    is_overtime = Column(Boolean, default=False)
    source = Column(String, default="homebase")
    created_at = Column(DateTime, default=datetime.utcnow)


class TenderData(Base):
    """Payment tender breakdown from Oracle MICROS/Simphony."""
    __tablename__ = "tender_data"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(DateTime)
    tender_type = Column(String)                      # cash | credit_card | gift_card | comp | etc.
    amount = Column(Float, default=0.0)
    transaction_count = Column(Integer, default=0)
    revenue_center = Column(String, nullable=True)    # bar | dining_room | takeout | etc.
    location_ref = Column(String, nullable=True)
    source = Column(String, default="oracle")
    created_at = Column(DateTime, default=datetime.utcnow)


class APICredential(Base):
    """Stores service API credentials per user. Secrets stored as-is (local SQLite only)."""
    __tablename__ = "api_credentials"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    service = Column(String)                          # homebase | oracle | plaid
    config_json = Column(String)                      # JSON blob of service-specific config
    is_active = Column(Boolean, default=True)
    last_synced = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserSettings(Base):
    """Per-user alert thresholds and preferences."""
    __tablename__ = "user_settings"

    id                  = Column(Integer, primary_key=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    labor_threshold_pct = Column(Float, default=35.0)   # alert when labor % >= this
    alerts_enabled      = Column(Boolean, default=True)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Workspace(Base):
    """A business profile the user can switch between — a physical Location or an
    expense-tracking Account. Each workspace carries its own plan/pricing tier.
    Data scoping is keyed off workspace_id on the data tables going forward; existing
    rows without a workspace_id belong to the user's default (first) workspace."""
    __tablename__ = "workspaces"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    name       = Column(String, nullable=False)
    kind       = Column(String, default="location")     # location | expense_account
    plan       = Column(String, default="free")         # free | plus | pro | max | enterprise
    segment    = Column(String, default="restaurant")   # individual | small_biz | restaurant
    is_active  = Column(Boolean, default=False)          # the currently-selected workspace
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InventoryData(Base):
    """Current inventory snapshot (uploaded). Re-import replaces the snapshot."""
    __tablename__ = "inventory_data"

    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    sku           = Column(String, nullable=True)
    product       = Column(String, nullable=True)
    unit_cost     = Column(Float, default=0.0)
    unit_price    = Column(Float, default=0.0)
    stock_qty     = Column(Float, default=0.0)
    reorder_level = Column(Float, default=0.0)
    source        = Column(String, default="upload")
    created_at    = Column(DateTime, default=datetime.utcnow)


class EnrolledEmbedding(Base):
    """Reference image embeddings for visual product recognition (enroll-by-photo).
    Multiple rows per SKU (several reference angles); a scanned frame is matched
    against the best (max cosine similarity) of a user's enrolled embeddings."""
    __tablename__ = "enrolled_embedding"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    sku        = Column(String, nullable=True)
    product    = Column(String, nullable=True)
    vec        = Column(Text, nullable=False)    # JSON list of 384 floats (L2-normalized)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReviewData(Base):
    """Customer product reviews (uploaded)."""
    __tablename__ = "review_data"

    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False)
    date        = Column(DateTime, nullable=True)
    sku         = Column(String, nullable=True)
    product     = Column(String, nullable=True)
    rating      = Column(Float, default=0.0)
    review_text = Column(String, nullable=True)
    source      = Column(String, default="upload")
    created_at  = Column(DateTime, default=datetime.utcnow)


class BusinessProfile(Base):
    """Free-form + structured description of the business so the optimizer can
    tailor its benchmarks and priorities to this specific company."""
    __tablename__ = "business_profile"

    id               = Column(Integer, primary_key=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    name             = Column(String, default="")
    industry         = Column(String, default="")        # retail | ecommerce | restaurant | services | manufacturing | other
    description      = Column(String, default="")        # free-text: what you sell, who you serve, seasonality, etc.
    goal             = Column(String, default="balance")  # grow_revenue | improve_margins | cut_costs | balance
    target_margin    = Column(Float, nullable=True)       # optional gross-margin target %
    target_labor_pct = Column(Float, nullable=True)       # optional labor-as-%-of-sales target
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)


def init_db():
    Base.metadata.create_all(engine)


def get_db():
    return SessionLocal()
