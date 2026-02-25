# BI Properties – Competitive Market Intelligence & Monitoring Dashboard

## System Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     DATA COLLECTION LAYER                          │
│                                                                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐   │
│  │ Bayut Scraper│  │PropertyFinder    │  │ Dubizzle Scraper  │   │
│  │ (Portal)     │  │ Scraper (Portal) │  │ (Classifieds)     │   │
│  └──────┬───────┘  └────────┬─────────┘  └─────────┬─────────┘   │
│         └──────────────────┬┘────────────────────────┘            │
│                             ▼                                      │
│                   ┌─────────────────┐                             │
│                   │  Celery Workers  │  ← Redis broker            │
│                   │ (async scraping) │                             │
│                   └────────┬────────┘                             │
└────────────────────────────│───────────────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                   NORMALIZATION & STORAGE                          │
│                                                                    │
│  Deduplicate (external_id + competitor_id)                        │
│  Hash-based change detection (SHA-256 of price + title)           │
│  Upsert: new → INSERT, changed → UPDATE + PriceHistory log        │
│  Missing → mark as REMOVED after 14 days                          │
│                         │                                          │
│                         ▼                                          │
│               ┌──────────────────┐                                │
│               │   PostgreSQL     │                                 │
│               │ (normalized      │                                 │
│               │  relational DB)  │                                 │
│               └──────────────────┘                                │
└────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                      ANALYTICS ENGINE                              │
│                                                                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐   │
│  │ Price Tracker│  │ Listing Velocity  │  │ Market Heat Index │   │
│  │              │  │                  │  │                   │   │
│  │ avg, median, │  │ new listings/day │  │ composite 0–100   │   │
│  │ trend, psf   │  │ velocity ratio   │  │ score per area    │   │
│  └──────────────┘  └──────────────────┘  └───────────────────┘   │
│                          + Alert Engine                            │
└────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                     FASTAPI REST API                               │
│  /analytics/price-tracker                                         │
│  /analytics/listing-velocity                                      │
│  /analytics/heat-map                                              │
│  /analytics/competitor-comparison                                 │
│  /analytics/overview                                              │
│  /alerts/                                                         │
│  /competitors/                                                    │
└────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│              REACT DASHBOARD (Vite + Recharts)                     │
│  Overview · Price Tracker · Listing Velocity · Competitors · Alerts│
└────────────────────────────────────────────────────────────────────┘
```

---

## Data Collection Layer

### Sources & Scrapers

| Source | Type | Update Frequency | Data Points |
|--------|------|-----------------|-------------|
| Bayut.com | Portal | Every 6 hours | Price, beds, baths, sqft, area, agent |
| PropertyFinder.ae | Portal | Every 6 hours | Price, beds, baths, sqft, listed date |
| Dubizzle.com | Classifieds | Every 6 hours | Price, basic specs |
| Allsopp & Allsopp | Agency | Daily | Exclusive listings |
| Betterhomes | Agency | Daily | Exclusive listings |

### Update Frequency Strategy

```
Data Collection:  Every 6 hours (configurable via SCRAPE_INTERVAL_HOURS)
Metrics Computation: Every hour (Celery Beat)
Alert Checks: Every 30 minutes
Stale Data Cleanup: 2 AM daily
```

The 6-hour interval balances freshness with respectful scraping load. Critical price changes are detected on the next scheduled run and immediately trigger alerts.

### Normalisation

Every scraped listing is converted to a `ScrapedListing` dataclass with:
- Standardised area names (e.g., "Downtown Dub." → "Downtown Dubai")
- Price cleaned from string formats ("AED 2,500,000" → `2500000` integer)
- `property_type` mapped to enum: `VILLA | APARTMENT | TOWNHOUSE | PENTHOUSE | DUPLEX`
- `price_per_sqft` computed where `size_sqft` is available

### Deduplication

Two-level deduplication strategy:

1. **Platform-level dedup**: Unique constraint on `(external_id, competitor_id)`. If a listing already exists → upsert (update metadata + last_seen_at).
2. **Content-change detection**: SHA-256 hash of `{ external_id, price, title }`. If the hash differs → a `PriceHistory` record is logged and the listing is updated. If the hash is the same → only `last_seen_at` is refreshed (no write amplification).
3. **Stale detection**: Listings not seen in 14+ days are automatically marked `REMOVED`.

### Anti-Scraping Strategy

| Technique | Implementation |
|-----------|---------------|
| Rotating User-Agents | Pool of 5 realistic browser UAs, rotated per request |
| Request throttling | Minimum 2-second delay + random 0.5–1.5× jitter |
| Exponential backoff | Retry on 429/503 with 4s min → 30s max backoff |
| Session rotation | New `httpx.AsyncClient` per scraping batch |
| Robots.txt compliance | Honoured by default; override per-scraper if partnership grants access |
| **In production (additional)** | |
| Residential proxy pool | Bright Data / Oxylabs residential IPs |
| Browser fingerprint spoofing | Playwright with stealth plugin |
| CAPTCHA solving | 2captcha / Anti-Captcha service |
| Official data partnerships | Preferred route — API access instead of scraping |

---

## Analytical Insights

### 1. Price Tracker

Tracks price statistics and trends per area and property type.

**Metrics computed:**
- `avg_price_aed`, `median_price_aed`, `min`, `max`
- `avg_price_per_sqft`
- `std_dev_aed` (distribution spread)
- 90-day historical trend (daily aggregation stored in `MarketMetric`)

**Price change detection**: Every scrape compares the new price against the stored price. Changes are logged to the immutable `PriceHistory` table with `old_price`, `new_price`, and `change_pct`.

---

### 2. Listing Velocity

Measures the rate at which new listings enter the market per area.

**Formula:**
```
velocity_ratio = avg_daily_new_listings_last_7d / avg_daily_new_listings_last_30d
```

**Trend classification:**
- `> 1.5×` → ACCELERATING (potential supply surge or high interest)
- `1.2–1.5×` → RISING
- `0.8–1.2×` → STABLE
- `< 0.8×` → SLOWING (possible market tightening)

**Interpretation**: A velocity spike in a high-heat-index area signals imminent price competition. A velocity spike in a cool area may indicate distressed selling.

---

### 3. Market Heat Index

A composite 0–100 score representing overall market activity per area.

**Formula:**
```
Heat Index = velocity_score (0–40) + price_score (0–40) + demand_score (0–20)

velocity_score = min(40, (velocity_ratio - 0.5) × 40)
price_score    = min(40, max(0, 20 + price_change_pct × 4))
demand_score   = (1 - saturation) × 20
                 where saturation = active_listings / area_capacity
```

**Interpretation:**
| Score | Status | Meaning |
|-------|--------|---------|
| 75–100 | HOT 🔥 | Competitive bidding expected; prices rising |
| 50–74 | ACTIVE | Strong market, balanced supply/demand |
| 25–49 | BALANCED | Normal conditions |
| 0–24 | COOL | Buyer's market, supply exceeds demand |

---

## Dashboard Features

### Overview
- KPI strip: total listings, average price, new listings (7d), unread alerts
- Price trend area chart (selected area, 30-day)
- Listing velocity bar chart (selected area, 30-day)
- Market Heat Index grid for all areas (click to select)

### Price Tracker
- Area stats card (avg, median, price/sqft, heat index)
- 90-day dual-axis chart: price + price/sqft
- Area comparison table with % change vs 30 days ago

### Listing Velocity
- Velocity ratio KPI with trend classification
- 60-day colour-coded bar chart (red = spike, yellow = elevated, blue = normal)
- All-areas velocity comparison panel

### Competitor Analysis
- Horizontal bar chart: listings by competitor
- Pie chart: market share by listing count
- Avg price comparison bar chart
- Detailed competitor table

### Alerts & Signals
- Filterable alert feed (all / unread only)
- Alert types: Price Surge, Price Drop, Velocity Spike, High Heat Index, Listing Flood
- Severity levels: CRITICAL, WARNING, INFO
- One-click acknowledge

---

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/sarbdeol/bi-market-intelligence
cd bi-market-intelligence
cp .env.example .env

# 2. Start everything
docker-compose up --build -d

# Wait ~30 seconds for seed data generation

# 3. Access
#  Dashboard:  http://localhost:3000
#  API docs:   http://localhost:8000/docs
#  Flower (Celery monitor): optional, add to docker-compose

# 4. Trigger a manual scrape
curl -X POST http://localhost:8000/analytics/run-scrape

# 5. View heat map
curl http://localhost:8000/analytics/heat-map

# 6. View unread alerts
curl "http://localhost:8000/alerts/?unread_only=true"
```

---

## API Reference

```
GET  /analytics/overview                         Dashboard KPIs
GET  /analytics/price-tracker?area=X&days=30    Price stats + trend
GET  /analytics/listing-velocity?area=X          Velocity + trend
GET  /analytics/heat-map                         All-area heat indices
GET  /analytics/competitor-comparison?area=X     Competitor stats
GET  /alerts/?unread_only=true&severity=CRITICAL  Alert feed
PATCH /alerts/{id}/acknowledge                   Mark alert read
GET  /competitors/                               Competitor list
GET  /competitors/scrape-jobs                    Collection audit log
```

---

## Scalability Plan

### Current (Single Server)
- PostgreSQL + Redis + FastAPI + 2 Celery workers
- Handles ~10 areas × 5 sources × 25 listings = ~1,250 listings/run
- Sub-second API responses due to pre-computed `MarketMetric` rows

### Scale-Out Path

| Component | Strategy |
|-----------|----------|
| Scrapers | Increase Celery worker replicas; partition areas across workers |
| Database | Read replicas for analytics queries; connection pooling (PgBouncer) |
| Metrics | Pre-compute on write (current approach) → scales to millions of listings |
| API | Horizontal FastAPI replicas behind Nginx/ALB |
| Data retention | Partition `price_history` and `access_logs` by month; archive to S3 |
| Cache | Redis caching on `/analytics/heat-map` and `/analytics/overview` (TTL 5 min) |

### For 50+ Areas / 10+ Sources
- Replace Celery Beat with Airflow for complex DAG scheduling
- Stream price changes to Kafka for real-time alerting
- Move to TimescaleDB for time-series queries
- Consider Elasticsearch for full-text listing search

---

## Legal & Compliance Considerations

| Issue | Approach |
|-------|----------|
| **Terms of Service** | Review each portal's ToS. Prefer official data partnership APIs where available (PropertyFinder has a data API program) |
| **robots.txt** | Respected by default. `BaseScraper` can be configured to check before crawling |
| **Rate limiting** | Enforce minimum delays to avoid overloading servers |
| **Personal data** | Agent names/contacts not stored unless publicly shown. No GDPR-sensitive data collected |
| **Copyright** | Only listing metadata (price, area, spec, date) is stored — not listing photographs |
| **Data accuracy** | All data attributed to source; no modifications to original prices |
| **UAE Law** | Comply with TDRA cybercrime law; scraping publicly available property data is generally permissible if ToS allows |
| **Best practice** | Identify bot with a clear User-Agent string in production (e.g., "BIPropertiesBot/1.0 +https://biprops.com/bot") |

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | FastAPI + Python 3.11 | Async-native, fast, OpenAPI auto-docs |
| ORM | SQLAlchemy 2.0 | Type-safe, migrations via Alembic |
| Database | PostgreSQL 15 | Excellent for time-series-adjacent analytics |
| Task Queue | Celery + Redis | Reliable distributed job scheduling |
| Scraping | httpx + BeautifulSoup | Async HTTP, robust HTML parsing |
| Retry logic | tenacity | Exponential backoff with flexible policies |
| Frontend | React 18 + Recharts | Component-based, excellent chart library |
| Build | Vite | Fast dev server and optimised production builds |
| Containers | Docker + Compose | Reproducible, one-command setup |

---

## Project Structure

```
bi-market-intelligence/
├── docker-compose.yml
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py              # FastAPI app + database seeding
│       ├── models.py            # SQLAlchemy models
│       ├── database.py
│       ├── config.py
│       ├── scrapers/
│       │   ├── base.py          # BaseScraper: throttling, retry, UA rotation
│       │   └── sources.py       # Bayut, PropertyFinder, Dubizzle scrapers
│       ├── analytics/
│       │   └── engine.py        # Price Tracker, Velocity, Heat Index, Alerts
│       ├── tasks/
│       │   └── celery_app.py    # Celery tasks + Beat schedule
│       └── routers/
│           └── api.py           # Analytics, Alerts, Competitors routers
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        └── App.jsx              # Full dashboard (5 views, Recharts, dark theme)
```
