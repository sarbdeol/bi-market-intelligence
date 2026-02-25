"""
Data Models for Market Intelligence System
==========================================

Core entities:
  Competitor    – tracked real-estate agencies/portals
  Listing       – individual property listing snapshot
  PriceHistory  – price changes per listing over time
  MarketMetric  – aggregated daily metrics per area
  Alert         – triggered when thresholds are crossed
  ScrapeJob     – audit log of every collection run
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime,
    Enum, Text, ForeignKey, Index, UniqueConstraint, BigInteger
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class PropertyType(str, enum.Enum):
    VILLA = "VILLA"
    APARTMENT = "APARTMENT"
    TOWNHOUSE = "TOWNHOUSE"
    PENTHOUSE = "PENTHOUSE"
    DUPLEX = "DUPLEX"


class ListingStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SOLD = "SOLD"
    REMOVED = "REMOVED"
    PRICE_REDUCED = "PRICE_REDUCED"


class AlertType(str, enum.Enum):
    PRICE_SURGE = "PRICE_SURGE"
    PRICE_DROP = "PRICE_DROP"
    VELOCITY_SPIKE = "VELOCITY_SPIKE"
    HIGH_HEAT_INDEX = "HIGH_HEAT_INDEX"
    NEW_COMPETITOR = "NEW_COMPETITOR"
    LISTING_FLOOD = "LISTING_FLOOD"


class AlertSeverity(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class Competitor(Base):
    """Tracked competitor agencies / portals."""
    __tablename__ = "competitors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, unique=True)
    website = Column(String(500), nullable=True)
    source_type = Column(String(50), nullable=False)   # PORTAL | AGENCY | SOCIAL
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    listings = relationship("Listing", back_populates="competitor")


class Listing(Base):
    """
    A snapshot of a property listing from a competitor source.
    Deduplication key: (external_id, competitor_id)
    """
    __tablename__ = "listings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    competitor_id = Column(UUID(as_uuid=True), ForeignKey("competitors.id"), nullable=False)
    external_id = Column(String(200), nullable=False)    # ID on the source platform
    title = Column(String(500), nullable=False)
    area = Column(String(200), nullable=False, index=True)
    sub_area = Column(String(200), nullable=True)
    property_type = Column(Enum(PropertyType), nullable=False)
    status = Column(Enum(ListingStatus), default=ListingStatus.ACTIVE)

    # Price
    price_aed = Column(BigInteger, nullable=False)
    price_per_sqft = Column(Float, nullable=True)
    bedrooms = Column(Integer, nullable=True)
    bathrooms = Column(Integer, nullable=True)
    size_sqft = Column(Float, nullable=True)

    # Metadata
    url = Column(String(1000), nullable=True)
    content_hash = Column(String(64), nullable=True)   # SHA-256 of key fields for change detection
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    listed_at = Column(DateTime, nullable=True)         # date on the original listing

    competitor = relationship("Competitor", back_populates="listings")
    price_history = relationship("PriceHistory", back_populates="listing", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("external_id", "competitor_id", name="uq_listing_external"),
        Index("ix_listings_area_type", "area", "property_type"),
        Index("ix_listings_price", "price_aed"),
        Index("ix_listings_status", "status"),
    )


class PriceHistory(Base):
    """Immutable price change log per listing."""
    __tablename__ = "price_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"))
    old_price_aed = Column(BigInteger, nullable=True)
    new_price_aed = Column(BigInteger, nullable=False)
    change_pct = Column(Float, nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)

    listing = relationship("Listing", back_populates="price_history")


class MarketMetric(Base):
    """
    Daily aggregated market metrics per area.
    Pre-computed by Celery analytics task.
    """
    __tablename__ = "market_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    area = Column(String(200), nullable=False, index=True)
    property_type = Column(Enum(PropertyType), nullable=True)   # None = all types
    date = Column(DateTime, nullable=False, index=True)

    # Price metrics
    avg_price_aed = Column(BigInteger, nullable=True)
    median_price_aed = Column(BigInteger, nullable=True)
    avg_price_per_sqft = Column(Float, nullable=True)
    min_price_aed = Column(BigInteger, nullable=True)
    max_price_aed = Column(BigInteger, nullable=True)

    # Listing velocity (new listings per day in this area)
    new_listings_count = Column(Integer, default=0)
    total_active_listings = Column(Integer, default=0)
    removed_listings_count = Column(Integer, default=0)

    # Market Heat Index (0-100)
    # Formula: weighted score of (velocity + price trend + demand signals)
    heat_index = Column(Float, nullable=True)

    computed_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("area", "property_type", "date", name="uq_metric_area_date"),
        Index("ix_market_metrics_area_date", "area", "date"),
    )


class Alert(Base):
    """Triggered when market conditions cross defined thresholds."""
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_type = Column(Enum(AlertType), nullable=False, index=True)
    severity = Column(Enum(AlertSeverity), nullable=False)
    area = Column(String(200), nullable=True)
    competitor_id = Column(UUID(as_uuid=True), ForeignKey("competitors.id"), nullable=True)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id"), nullable=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=False)
    metric_value = Column(Float, nullable=True)       # the value that triggered the alert
    threshold_value = Column(Float, nullable=True)    # the threshold that was crossed
    is_acknowledged = Column(Boolean, default=False)
    triggered_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_alerts_severity_time", "severity", "triggered_at"),
    )


class ScrapeJob(Base):
    """Audit trail for every data collection run."""
    __tablename__ = "scrape_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    competitor_id = Column(UUID(as_uuid=True), ForeignKey("competitors.id"), nullable=False)
    source_url = Column(String(1000), nullable=True)
    status = Column(String(50), nullable=False)       # PENDING | RUNNING | SUCCESS | FAILED | BLOCKED
    listings_found = Column(Integer, default=0)
    listings_new = Column(Integer, default=0)
    listings_updated = Column(Integer, default=0)
    listings_removed = Column(Integer, default=0)
    error_message = Column(String(1000), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
