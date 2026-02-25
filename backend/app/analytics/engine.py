"""
Analytics Engine
================
Three core analytical insights:

1. Price Tracker    – tracks price changes per area/type over time
2. Listing Velocity – measures how fast new listings appear
3. Market Heat Index – composite 0-100 score per area

All metrics are pre-computed daily and stored in MarketMetric table.
The API reads from pre-computed rows for fast response.
"""

import statistics
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from app.models import Listing, PriceHistory, MarketMetric, Alert, AlertType, AlertSeverity, PropertyType
from app.config import settings


# ─── 1. Price Tracker ─────────────────────────────────────────────────

def compute_price_stats(db: Session, area: str, property_type: Optional[str] = None, days: int = 30) -> dict:
    """
    Computes current price statistics for an area.
    Returns avg, median, min, max, and % change vs previous period.
    """
    since = datetime.utcnow() - timedelta(days=days)

    query = db.query(Listing).filter(
        Listing.area == area,
        Listing.last_seen_at >= since,
    )
    if property_type:
        query = query.filter(Listing.property_type == PropertyType(property_type))

    listings = query.all()
    if not listings:
        return {}

    prices = [l.price_aed for l in listings]
    sqft_prices = [l.price_per_sqft for l in listings if l.price_per_sqft]

    return {
        "area": area,
        "property_type": property_type,
        "listing_count": len(listings),
        "avg_price_aed": int(statistics.mean(prices)),
        "median_price_aed": int(statistics.median(prices)),
        "min_price_aed": min(prices),
        "max_price_aed": max(prices),
        "avg_price_per_sqft": round(statistics.mean(sqft_prices), 2) if sqft_prices else None,
        "std_dev_aed": int(statistics.stdev(prices)) if len(prices) > 1 else 0,
    }


def get_price_trend(db: Session, area: str, days: int = 90) -> list[dict]:
    """Returns daily average price trend for an area (reads MarketMetric)."""
    since = datetime.utcnow() - timedelta(days=days)
    metrics = (
        db.query(MarketMetric)
        .filter(
            MarketMetric.area == area,
            MarketMetric.date >= since,
            MarketMetric.property_type == None,
        )
        .order_by(MarketMetric.date)
        .all()
    )
    return [
        {
            "date": m.date.strftime("%Y-%m-%d"),
            "avg_price_aed": m.avg_price_aed,
            "avg_price_per_sqft": m.avg_price_per_sqft,
            "total_active": m.total_active_listings,
        }
        for m in metrics
    ]


# ─── 2. Listing Velocity ──────────────────────────────────────────────

def compute_listing_velocity(db: Session, area: str, days: int = 7) -> dict:
    """
    Listing velocity = rate of new listings per day.
    Compare against 30-day rolling average to detect spikes.
    """
    since = datetime.utcnow() - timedelta(days=days)
    month_ago = datetime.utcnow() - timedelta(days=30)

    recent_count = db.query(func.count(Listing.id)).filter(
        Listing.area == area,
        Listing.first_seen_at >= since,
    ).scalar() or 0

    monthly_count = db.query(func.count(Listing.id)).filter(
        Listing.area == area,
        Listing.first_seen_at >= month_ago,
    ).scalar() or 0

    daily_recent = recent_count / days
    daily_avg_30 = monthly_count / 30

    velocity_ratio = daily_recent / daily_avg_30 if daily_avg_30 > 0 else 1.0

    return {
        "area": area,
        "new_listings_last_7d": recent_count,
        "avg_daily_new_listings_7d": round(daily_recent, 2),
        "avg_daily_new_listings_30d": round(daily_avg_30, 2),
        "velocity_ratio": round(velocity_ratio, 2),
        "trend": "ACCELERATING" if velocity_ratio > 1.2 else ("SLOWING" if velocity_ratio < 0.8 else "STABLE"),
    }


def get_velocity_trend(db: Session, area: str, days: int = 90) -> list[dict]:
    """Returns daily new-listing counts from MarketMetric."""
    since = datetime.utcnow() - timedelta(days=days)
    metrics = (
        db.query(MarketMetric)
        .filter(
            MarketMetric.area == area,
            MarketMetric.date >= since,
            MarketMetric.property_type == None,
        )
        .order_by(MarketMetric.date)
        .all()
    )
    return [
        {
            "date": m.date.strftime("%Y-%m-%d"),
            "new_listings": m.new_listings_count,
            "total_active": m.total_active_listings,
        }
        for m in metrics
    ]


# ─── 3. Market Heat Index ─────────────────────────────────────────────

def compute_heat_index(
    velocity_ratio: float,
    price_change_pct: float,
    active_listings: int,
    area_capacity: int = 500,
) -> float:
    """
    Market Heat Index (0-100).

    Formula:
      velocity_score (0-40):   how fast new listings appear vs baseline
      price_score (0-40):      direction and magnitude of price changes
      demand_score (0-20):     listing saturation (fewer = hotter market)

    > 75  = Hot market
    50-75 = Active
    25-50 = Balanced
    < 25  = Cool
    """
    # Velocity score (higher velocity = hotter market)
    velocity_score = min(40, (velocity_ratio - 0.5) * 40)

    # Price score (positive trend = hotter)
    price_score = min(40, max(0, 20 + price_change_pct * 4))

    # Demand score (fewer listings relative to capacity = more demand)
    saturation = min(1.0, active_listings / area_capacity)
    demand_score = (1 - saturation) * 20

    heat = velocity_score + price_score + demand_score
    return round(max(0, min(100, heat)), 1)


def get_heat_map(db: Session) -> list[dict]:
    """Returns latest heat index for all tracked areas."""
    # Get the most recent date in MarketMetric
    latest_date = db.query(func.max(MarketMetric.date)).scalar()
    if not latest_date:
        return []

    metrics = (
        db.query(MarketMetric)
        .filter(
            MarketMetric.date >= latest_date - timedelta(hours=1),
            MarketMetric.property_type == None,
        )
        .all()
    )

    return [
        {
            "area": m.area,
            "heat_index": m.heat_index,
            "avg_price_aed": m.avg_price_aed,
            "new_listings": m.new_listings_count,
            "total_active": m.total_active_listings,
            "date": m.date.strftime("%Y-%m-%d"),
        }
        for m in metrics
    ]


# ─── Alert generation ─────────────────────────────────────────────────

def check_and_create_alerts(db: Session, area: str, metrics: dict) -> list[Alert]:
    """Evaluate current metrics and create alerts if thresholds are exceeded."""
    alerts = []

    # Price surge/drop alert
    if metrics.get("price_change_pct") is not None:
        pct = metrics["price_change_pct"]
        if abs(pct) >= settings.PRICE_CHANGE_ALERT_PCT:
            severity = AlertSeverity.CRITICAL if abs(pct) >= 10 else AlertSeverity.WARNING
            atype = AlertType.PRICE_SURGE if pct > 0 else AlertType.PRICE_DROP
            alert = Alert(
                alert_type=atype,
                severity=severity,
                area=area,
                title=f"{'Price Surge' if pct > 0 else 'Price Drop'} in {area}",
                description=f"Average price in {area} changed by {pct:+.1f}% vs previous period.",
                metric_value=pct,
                threshold_value=settings.PRICE_CHANGE_ALERT_PCT,
            )
            db.add(alert)
            alerts.append(alert)

    # Velocity spike alert
    if metrics.get("velocity_ratio", 1.0) >= settings.VELOCITY_SPIKE_THRESHOLD:
        alert = Alert(
            alert_type=AlertType.VELOCITY_SPIKE,
            severity=AlertSeverity.WARNING,
            area=area,
            title=f"Listing Velocity Spike in {area}",
            description=f"New listings appearing {metrics['velocity_ratio']:.1f}× faster than 30-day average.",
            metric_value=metrics["velocity_ratio"],
            threshold_value=settings.VELOCITY_SPIKE_THRESHOLD,
        )
        db.add(alert)
        alerts.append(alert)

    # Heat index alert
    if metrics.get("heat_index", 0) >= settings.HEAT_INDEX_HIGH_THRESHOLD:
        alert = Alert(
            alert_type=AlertType.HIGH_HEAT_INDEX,
            severity=AlertSeverity.WARNING,
            area=area,
            title=f"High Market Heat Index: {area}",
            description=f"Market heat index reached {metrics['heat_index']:.1f}/100 – market is HOT.",
            metric_value=metrics["heat_index"],
            threshold_value=settings.HEAT_INDEX_HIGH_THRESHOLD,
        )
        db.add(alert)
        alerts.append(alert)

    if alerts:
        db.commit()

    return alerts
