"""API Routers for the Market Intelligence Dashboard."""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Alert, Competitor, Listing, MarketMetric, PriceHistory, ScrapeJob
)
from app.analytics.engine import (
    compute_price_stats, get_price_trend,
    compute_listing_velocity, get_velocity_trend, get_heat_map
)

# ─── Analytics Router ─────────────────────────────────────────────────
analytics = APIRouter(prefix="/analytics", tags=["Analytics"])


@analytics.get("/price-tracker")
def price_tracker(
    area: Optional[str] = None,
    property_type: Optional[str] = None,
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """Price statistics with trend for one or all areas."""
    if area:
        stats = compute_price_stats(db, area, property_type, days)
        trend = get_price_trend(db, area, days)
        return {"area": area, "stats": stats, "trend": trend}

    # All areas
    areas = [r[0] for r in db.query(Listing.area).distinct().all()]
    result = []
    for a in areas:
        stats = compute_price_stats(db, a, property_type, days)
        if stats:
            result.append(stats)
    return {"areas": result}


@analytics.get("/listing-velocity")
def listing_velocity(
    area: Optional[str] = None,
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(get_db),
):
    """Listing velocity (new listings/day) for one or all areas."""
    if area:
        velocity = compute_listing_velocity(db, area, days)
        trend = get_velocity_trend(db, area, 90)
        return {"area": area, "velocity": velocity, "trend": trend}

    areas = [r[0] for r in db.query(Listing.area).distinct().all()]
    return {"areas": [compute_listing_velocity(db, a, days) for a in areas]}


@analytics.get("/heat-map")
def heat_map(db: Session = Depends(get_db)):
    """Market Heat Index for all areas."""
    return {"areas": get_heat_map(db)}


@analytics.get("/competitor-comparison")
def competitor_comparison(
    area: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Compare average prices and listing counts across competitors."""
    query = db.query(
        Competitor.name,
        func.count(Listing.id).label("listing_count"),
        func.avg(Listing.price_aed).label("avg_price"),
        func.avg(Listing.price_per_sqft).label("avg_psf"),
    ).join(Listing, Listing.competitor_id == Competitor.id)

    if area:
        query = query.filter(Listing.area == area)

    results = query.group_by(Competitor.name).all()

    return {
        "area": area or "All Areas",
        "competitors": [
            {
                "name": r.name,
                "listing_count": r.listing_count,
                "avg_price_aed": int(r.avg_price) if r.avg_price else None,
                "avg_price_per_sqft": round(r.avg_psf, 2) if r.avg_psf else None,
            }
            for r in results
        ],
    }


@analytics.get("/overview")
def overview(db: Session = Depends(get_db)):
    """High-level dashboard overview stats."""
    total_listings = db.query(func.count(Listing.id)).filter(Listing.status == "ACTIVE").scalar()
    total_competitors = db.query(func.count(Competitor.id)).filter(Competitor.is_active == True).scalar()
    unread_alerts = db.query(func.count(Alert.id)).filter(Alert.is_acknowledged == False).scalar()
    areas = db.query(func.count(func.distinct(Listing.area))).scalar()

    # Avg price across all active listings
    avg_price = db.query(func.avg(Listing.price_aed)).filter(Listing.status == "ACTIVE").scalar()

    # New listings in last 7 days
    since = datetime.utcnow() - timedelta(days=7)
    new_7d = db.query(func.count(Listing.id)).filter(Listing.first_seen_at >= since).scalar()

    return {
        "total_active_listings": total_listings,
        "total_competitors": total_competitors,
        "unread_alerts": unread_alerts,
        "tracked_areas": areas,
        "avg_price_aed": int(avg_price) if avg_price else 0,
        "new_listings_7d": new_7d,
    }


# ─── Alerts Router ────────────────────────────────────────────────────
alerts_router = APIRouter(prefix="/alerts", tags=["Alerts"])


@alerts_router.get("/")
def list_alerts(
    unread_only: bool = False,
    area: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Alert)
    if unread_only:
        query = query.filter(Alert.is_acknowledged == False)
    if area:
        query = query.filter(Alert.area == area)
    if severity:
        query = query.filter(Alert.severity == severity)

    alerts = query.order_by(Alert.triggered_at.desc()).limit(limit).all()
    return {
        "alerts": [
            {
                "id": str(a.id),
                "type": a.alert_type.value,
                "severity": a.severity.value,
                "area": a.area,
                "title": a.title,
                "description": a.description,
                "metric_value": a.metric_value,
                "threshold_value": a.threshold_value,
                "is_acknowledged": a.is_acknowledged,
                "triggered_at": a.triggered_at.isoformat(),
            }
            for a in alerts
        ],
        "total": len(alerts),
    }


@alerts_router.patch("/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, db: Session = Depends(get_db)):
    from uuid import UUID
    alert = db.query(Alert).filter(Alert.id == UUID(alert_id)).first()
    if alert:
        alert.is_acknowledged = True
        db.commit()
    return {"message": "Alert acknowledged"}


# ─── Competitors Router ───────────────────────────────────────────────
competitors_router = APIRouter(prefix="/competitors", tags=["Competitors"])


@competitors_router.get("/")
def list_competitors(db: Session = Depends(get_db)):
    competitors = db.query(Competitor).filter(Competitor.is_active == True).all()
    return {
        "competitors": [
            {
                "id": str(c.id),
                "name": c.name,
                "website": c.website,
                "source_type": c.source_type,
                "listing_count": len([l for l in c.listings if l.status == "ACTIVE"]),
            }
            for c in competitors
        ]
    }


@competitors_router.get("/scrape-jobs")
def scrape_jobs(limit: int = 20, db: Session = Depends(get_db)):
    jobs = db.query(ScrapeJob).order_by(ScrapeJob.created_at.desc()).limit(limit).all()
    return {
        "jobs": [
            {
                "id": str(j.id),
                "competitor_id": str(j.competitor_id),
                "status": j.status,
                "listings_found": j.listings_found,
                "listings_new": j.listings_new,
                "listings_updated": j.listings_updated,
                "error_message": j.error_message,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            }
            for j in jobs
        ]
    }
