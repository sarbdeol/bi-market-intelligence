"""
Celery Tasks
============
Scheduled jobs for data collection and analytics computation.

Schedule:
  scrape_all_sources  – every 6 hours (configurable)
  compute_metrics     – every hour
  check_alerts        – every 30 minutes
  cleanup_old_data    – daily
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta

from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "market_intelligence",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.beat_schedule = {
    "scrape-all-sources": {
        "task": "app.tasks.scrape_all_sources",
        "schedule": timedelta(hours=settings.SCRAPE_INTERVAL_HOURS),
    },
    "compute-daily-metrics": {
        "task": "app.tasks.compute_daily_metrics",
        "schedule": crontab(minute=0),  # every hour
    },
    "check-alerts": {
        "task": "app.tasks.check_alerts",
        "schedule": timedelta(minutes=30),
    },
    "cleanup-old-scrape-jobs": {
        "task": "app.tasks.cleanup_old_data",
        "schedule": crontab(hour=2, minute=0),  # 2 AM daily
    },
}

celery_app.conf.task_routes = {
    "app.tasks.scrape_*": {"queue": "scraping"},
    "app.tasks.compute_*": {"queue": "analytics"},
    "app.tasks.check_*": {"queue": "analytics"},
}


@celery_app.task(name="app.tasks.scrape_all_sources", bind=True, max_retries=2)
def scrape_all_sources(self):
    """
    Runs all configured scrapers across all tracked areas.
    Each (scraper × area) pair runs independently.
    Deduplication and upsert logic runs on each result.
    """
    from app.database import SessionLocal
    from app.models import Competitor, ScrapeJob, Listing
    from app.scrapers.sources import SCRAPERS, AREAS

    db = SessionLocal()
    try:
        for competitor_name, ScraperClass in SCRAPERS.items():
            competitor = db.query(Competitor).filter(Competitor.name == competitor_name).first()
            if not competitor or not competitor.is_active:
                continue

            for area in AREAS:
                job = ScrapeJob(
                    competitor_id=competitor.id,
                    source_url=f"{ScraperClass.base_url}/{area}",
                    status="RUNNING",
                    started_at=datetime.utcnow(),
                )
                db.add(job)
                db.commit()

                try:
                    scraper = ScraperClass()
                    # Run async scraper in sync Celery context
                    listings = asyncio.run(scraper.scrape(area))

                    new_count = updated_count = 0

                    for scraped in listings:
                        content_hash = scraped.content_hash()
                        existing = db.query(Listing).filter(
                            Listing.external_id == scraped.external_id,
                            Listing.competitor_id == competitor.id,
                        ).first()

                        if existing:
                            # Update if content changed (price change detection)
                            if existing.content_hash != content_hash:
                                from app.models import PriceHistory
                                # Log price change
                                if existing.price_aed != scraped.price_aed:
                                    change_pct = (
                                        (scraped.price_aed - existing.price_aed) / existing.price_aed * 100
                                    )
                                    ph = PriceHistory(
                                        listing_id=existing.id,
                                        old_price_aed=existing.price_aed,
                                        new_price_aed=scraped.price_aed,
                                        change_pct=round(change_pct, 2),
                                    )
                                    db.add(ph)
                                    if abs(change_pct) >= 5:
                                        existing.status = "PRICE_REDUCED" if change_pct < 0 else "ACTIVE"

                                existing.price_aed = scraped.price_aed
                                existing.price_per_sqft = scraped.price_per_sqft
                                existing.content_hash = content_hash
                                existing.last_seen_at = datetime.utcnow()
                                updated_count += 1
                            else:
                                existing.last_seen_at = datetime.utcnow()
                        else:
                            # New listing
                            new_listing = Listing(
                                competitor_id=competitor.id,
                                external_id=scraped.external_id,
                                title=scraped.title,
                                area=scraped.area,
                                sub_area=scraped.sub_area,
                                property_type=scraped.property_type,
                                price_aed=scraped.price_aed,
                                price_per_sqft=scraped.price_per_sqft,
                                bedrooms=scraped.bedrooms,
                                bathrooms=scraped.bathrooms,
                                size_sqft=scraped.size_sqft,
                                url=scraped.url,
                                content_hash=content_hash,
                                listed_at=scraped.listed_at,
                            )
                            db.add(new_listing)
                            new_count += 1

                    db.commit()
                    job.status = "SUCCESS"
                    job.listings_found = len(listings)
                    job.listings_new = new_count
                    job.listings_updated = updated_count
                    job.completed_at = datetime.utcnow()
                    db.commit()

                except Exception as e:
                    job.status = "FAILED"
                    job.error_message = str(e)[:500]
                    job.completed_at = datetime.utcnow()
                    db.commit()

    finally:
        db.close()


@celery_app.task(name="app.tasks.compute_daily_metrics")
def compute_daily_metrics():
    """Aggregates MarketMetric rows for all areas."""
    import statistics
    from sqlalchemy import func
    from app.database import SessionLocal
    from app.models import Listing, MarketMetric
    from app.analytics.engine import compute_heat_index

    db = SessionLocal()
    try:
        # Get distinct areas
        areas = [r[0] for r in db.query(Listing.area).distinct().all()]
        now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        yesterday = now - timedelta(days=1)

        for area in areas:
            listings = db.query(Listing).filter(
                Listing.area == area,
                Listing.status == "ACTIVE",
            ).all()

            if not listings:
                continue

            prices = [l.price_aed for l in listings]
            sqft = [l.price_per_sqft for l in listings if l.price_per_sqft]
            new_today = sum(1 for l in listings if l.first_seen_at >= yesterday)

            # Get previous period avg for velocity ratio
            prev_metric = (
                db.query(MarketMetric)
                .filter(MarketMetric.area == area, MarketMetric.property_type == None)
                .order_by(MarketMetric.date.desc())
                .first()
            )
            prev_avg = prev_metric.avg_price_aed if prev_metric else None
            price_change_pct = (
                (statistics.mean(prices) - prev_avg) / prev_avg * 100
                if prev_avg else 0
            )
            velocity_ratio = new_today / (prev_metric.new_listings_count or 1) if prev_metric else 1.0

            heat = compute_heat_index(velocity_ratio, price_change_pct, len(listings))

            metric = MarketMetric(
                area=area,
                property_type=None,
                date=now,
                avg_price_aed=int(statistics.mean(prices)),
                median_price_aed=int(statistics.median(prices)),
                avg_price_per_sqft=round(statistics.mean(sqft), 2) if sqft else None,
                min_price_aed=min(prices),
                max_price_aed=max(prices),
                new_listings_count=new_today,
                total_active_listings=len(listings),
                heat_index=heat,
            )
            db.add(metric)

        db.commit()
    finally:
        db.close()


@celery_app.task(name="app.tasks.check_alerts")
def check_alerts():
    """Runs alert threshold checks across all areas."""
    from app.database import SessionLocal
    from app.models import MarketMetric
    from app.analytics.engine import check_and_create_alerts

    db = SessionLocal()
    try:
        latest = db.query(MarketMetric).order_by(MarketMetric.date.desc()).limit(20).all()
        for m in latest:
            check_and_create_alerts(db, m.area, {
                "heat_index": m.heat_index,
                "price_change_pct": None,
                "velocity_ratio": m.new_listings_count / max(m.total_active_listings, 1) * 10,
            })
    finally:
        db.close()


@celery_app.task(name="app.tasks.cleanup_old_data")
def cleanup_old_data():
    """Remove scrape jobs older than 30 days and stale listings."""
    from app.database import SessionLocal
    from app.models import ScrapeJob, Listing

    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(days=30)
    try:
        db.query(ScrapeJob).filter(ScrapeJob.created_at < cutoff).delete()
        # Mark listings not seen in 14+ days as REMOVED
        db.query(Listing).filter(
            Listing.last_seen_at < datetime.utcnow() - timedelta(days=14),
            Listing.status == "ACTIVE",
        ).update({"status": "REMOVED"})
        db.commit()
    finally:
        db.close()
