"""
BI Properties Market Intelligence API
======================================
"""

import asyncio
import random
import statistics
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine, SessionLocal
from app.models import (
    Alert, AlertSeverity, AlertType,
    Competitor, Listing, MarketMetric, PropertyType
)
from app.routers.api import analytics, alerts_router, competitors_router
from app.scrapers.sources import AREAS, _gen_listings, SCRAPERS

app = FastAPI(title="BI Properties – Market Intelligence API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analytics)
app.include_router(alerts_router)
app.include_router(competitors_router)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    if settings.SEED_DATA:
        _seed_database()


def _seed_database():
    """Populate with realistic UAE property market data for demonstration."""
    db = SessionLocal()
    try:
        if db.query(Competitor).count() > 0:
            return  # Already seeded

        print("🌱 Seeding market intelligence data...")

        # ── Competitors ─────────────────────────────────────────────
        competitors_data = [
            {"name": "Bayut", "website": "https://www.bayut.com", "source_type": "PORTAL"},
            {"name": "PropertyFinder", "website": "https://www.propertyfinder.ae", "source_type": "PORTAL"},
            {"name": "Dubizzle", "website": "https://www.dubizzle.com", "source_type": "PORTAL"},
            {"name": "Allsopp & Allsopp", "website": "https://www.allsoppandallsopp.com", "source_type": "AGENCY"},
            {"name": "Betterhomes", "website": "https://www.betterhomes.com", "source_type": "AGENCY"},
        ]
        competitors = {}
        for cd in competitors_data:
            c = Competitor(**cd)
            db.add(c)
            db.flush()
            competitors[cd["name"]] = c

        # ── Listings ─────────────────────────────────────────────────
        all_listings = []
        competitor_list = list(competitors.values())
        for area in AREAS:
            for comp in competitor_list:
                scraped = _gen_listings(comp.name, area, count=random.randint(15, 30))
                for s in scraped:
                    l = Listing(
                        competitor_id=comp.id,
                        external_id=s.external_id,
                        title=s.title,
                        area=s.area,
                        sub_area=s.sub_area,
                        property_type=s.property_type,
                        price_aed=s.price_aed,
                        price_per_sqft=s.price_per_sqft,
                        bedrooms=s.bedrooms,
                        bathrooms=s.bathrooms,
                        size_sqft=s.size_sqft,
                        url=s.url,
                        content_hash=s.content_hash(),
                        listed_at=s.listed_at,
                        first_seen_at=s.listed_at or datetime.utcnow(),
                        last_seen_at=datetime.utcnow(),
                    )
                    db.add(l)
                    all_listings.append(l)

        db.commit()

        # ── Historical Market Metrics (90 days) ───────────────────────
        print("📊 Generating 90 days of market metrics...")
        for area in AREAS:
            area_listings = [l for l in all_listings if l.area == area]
            if not area_listings:
                continue

            base_price = statistics.mean([l.price_aed for l in area_listings])
            base_new = random.randint(5, 20)

            for days_ago in range(90, -1, -1):
                date = datetime.utcnow() - timedelta(days=days_ago)
                trend = 1 + (90 - days_ago) * random.uniform(0.0003, 0.001)
                noise = random.uniform(0.97, 1.03)
                avg_price = int(base_price * trend * noise)
                new_listings = max(1, int(base_new * random.uniform(0.6, 1.6)))
                total = len(area_listings)
                velocity_ratio = new_listings / max(base_new, 1)
                price_change_pct = (avg_price - base_price) / base_price * 100

                from app.analytics.engine import compute_heat_index
                heat = compute_heat_index(velocity_ratio, price_change_pct, total)

                metric = MarketMetric(
                    area=area,
                    property_type=None,
                    date=date,
                    avg_price_aed=avg_price,
                    median_price_aed=int(avg_price * random.uniform(0.92, 1.05)),
                    avg_price_per_sqft=round(avg_price / 1500, 2),
                    min_price_aed=int(avg_price * 0.5),
                    max_price_aed=int(avg_price * 2.5),
                    new_listings_count=new_listings,
                    total_active_listings=total,
                    heat_index=heat,
                )
                db.add(metric)

        db.commit()

        # ── Sample Alerts ─────────────────────────────────────────────
        sample_alerts = [
            Alert(alert_type=AlertType.PRICE_SURGE, severity=AlertSeverity.CRITICAL,
                  area="Palm Jumeirah", title="Price Surge: Palm Jumeirah",
                  description="Average villa price increased 8.2% in the last 14 days, driven by ultra-luxury demand.",
                  metric_value=8.2, threshold_value=5.0),
            Alert(alert_type=AlertType.VELOCITY_SPIKE, severity=AlertSeverity.WARNING,
                  area="Dubai Hills Estate", title="Listing Velocity Spike: Dubai Hills Estate",
                  description="New listings appearing 1.8× faster than 30-day average – potential oversupply signal.",
                  metric_value=1.8, threshold_value=1.5),
            Alert(alert_type=AlertType.HIGH_HEAT_INDEX, severity=AlertSeverity.WARNING,
                  area="Downtown Dubai", title="Hot Market: Downtown Dubai",
                  description="Market heat index reached 81.5/100. Expect competitive bidding on new listings.",
                  metric_value=81.5, threshold_value=75.0),
            Alert(alert_type=AlertType.PRICE_DROP, severity=AlertSeverity.INFO,
                  area="Business Bay", title="Price Softening: Business Bay",
                  description="Median apartment price declined 3.1% vs prior month.",
                  metric_value=-3.1, threshold_value=5.0),
            Alert(alert_type=AlertType.LISTING_FLOOD, severity=AlertSeverity.WARNING,
                  area="JBR", title="Listing Flood: JBR",
                  description="42 new listings added by Bayut in 24 hours – unusual activity detected.",
                  metric_value=42.0, threshold_value=20.0),
        ]
        for a in sample_alerts:
            db.add(a)

        db.commit()
        print("✅ Seed data complete.")

    except Exception as e:
        print(f"❌ Seed error: {e}")
        db.rollback()
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "healthy", "service": "market-intelligence-api"}


@app.get("/")
def root():
    return {
        "name": "BI Properties Market Intelligence API",
        "version": "1.0.0",
        "docs": "/docs",
    }
