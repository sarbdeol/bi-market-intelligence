"""
Source-specific scrapers for UAE real estate portals.

NOTE: These scrapers demonstrate the architecture and parsing logic.
In production, each scraper targets the actual portal's listing pages.
Scrapers simulate data for assessment demonstration purposes.
"""

import random
from datetime import datetime, timedelta
from typing import Optional

from app.scrapers.base import BaseScraper, ScrapedListing


AREAS = [
    "Downtown Dubai", "Dubai Marina", "Palm Jumeirah",
    "Business Bay", "Jumeirah", "Emirates Hills",
    "Arabian Ranches", "Dubai Hills Estate", "JBR", "DIFC"
]

PROPERTY_TYPES = ["VILLA", "APARTMENT", "TOWNHOUSE", "PENTHOUSE"]


def _gen_listings(source: str, area: str, count: int = 25, price_multiplier: float = 1.0) -> list[ScrapedListing]:
    """Generate realistic mock listings for a given source and area."""
    BASE_PRICES = {
        "Downtown Dubai":    {"APARTMENT": 1_800_000, "PENTHOUSE": 8_500_000},
        "Dubai Marina":      {"APARTMENT": 1_500_000, "PENTHOUSE": 5_000_000},
        "Palm Jumeirah":     {"VILLA": 12_000_000, "APARTMENT": 3_500_000, "PENTHOUSE": 15_000_000},
        "Business Bay":      {"APARTMENT": 1_200_000, "PENTHOUSE": 4_000_000},
        "Jumeirah":          {"VILLA": 6_500_000, "TOWNHOUSE": 3_200_000},
        "Emirates Hills":    {"VILLA": 25_000_000},
        "Arabian Ranches":   {"VILLA": 4_500_000, "TOWNHOUSE": 2_800_000},
        "Dubai Hills Estate": {"VILLA": 5_500_000, "TOWNHOUSE": 2_400_000, "APARTMENT": 1_400_000},
        "JBR":               {"APARTMENT": 1_600_000, "PENTHOUSE": 7_000_000},
        "DIFC":              {"APARTMENT": 2_200_000, "PENTHOUSE": 9_000_000},
    }

    area_prices = BASE_PRICES.get(area, {"APARTMENT": 1_500_000})
    listings = []

    for i in range(count):
        prop_type = random.choice(list(area_prices.keys()))
        base = area_prices[prop_type]
        variance = random.uniform(0.75, 1.35)
        price = int(base * variance * price_multiplier)
        beds = {"VILLA": random.randint(3, 7), "APARTMENT": random.randint(1, 3),
                "TOWNHOUSE": random.randint(3, 5), "PENTHOUSE": random.randint(3, 5)}.get(prop_type, 2)
        size = beds * random.uniform(600, 900)
        listed_days_ago = random.randint(0, 90)

        listings.append(ScrapedListing(
            external_id=f"{source}-{area[:3].lower()}-{i:04d}-{random.randint(1000, 9999)}",
            title=f"{beds}BR {prop_type.title()} in {area}",
            area=area,
            sub_area=f"{area} Phase {random.randint(1,3)}" if random.random() > 0.5 else None,
            property_type=prop_type,
            price_aed=price,
            price_per_sqft=round(price / size, 2) if size else None,
            bedrooms=beds,
            bathrooms=beds,
            size_sqft=round(size, 1),
            url=f"https://{source.lower().replace(' ', '')}.com/property/{area.lower().replace(' ', '-')}/{i}",
            listed_at=datetime.utcnow() - timedelta(days=listed_days_ago),
        ))

    return listings


class BayutScraper(BaseScraper):
    """
    Scraper for Bayut.com – UAE's largest property portal.

    Real implementation would:
    1. GET https://www.bayut.com/for-sale/property/dubai/{area}/
    2. Parse JSON-LD structured data or HTML listing cards
    3. Handle pagination via ?page= parameter
    4. Extract: price, beds, baths, sqft, listing date, agent name
    """
    source_name = "Bayut"
    base_url = "https://www.bayut.com"

    async def scrape(self, area: str, page: int = 1) -> list[ScrapedListing]:
        # In production: await self._fetch(f"{self.base_url}/for-sale/property/dubai/{area}/?page={page}")
        # For assessment: return realistic simulated data
        return _gen_listings("bayut", area, count=random.randint(20, 35), price_multiplier=1.02)


class PropertyFinderScraper(BaseScraper):
    """
    Scraper for PropertyFinder.ae

    Real implementation would:
    1. GET https://www.propertyfinder.ae/en/search?c=2&t=1&l={area_code}
    2. Parse listing grid from server-rendered HTML or intercept XHR API
    3. Handle infinite scroll pagination
    """
    source_name = "PropertyFinder"
    base_url = "https://www.propertyfinder.ae"

    async def scrape(self, area: str, page: int = 1) -> list[ScrapedListing]:
        return _gen_listings("propertyfinder", area, count=random.randint(18, 30), price_multiplier=0.98)


class DubizzleScraper(BaseScraper):
    """
    Scraper for Dubizzle.com (classifieds – price tends to be lower)

    Real implementation would:
    1. Use Dubizzle's unofficial API endpoint
    2. Parse JSON response: /api/listings/?category=properties&location={area}
    """
    source_name = "Dubizzle"
    base_url = "https://www.dubizzle.com"

    async def scrape(self, area: str, page: int = 1) -> list[ScrapedListing]:
        return _gen_listings("dubizzle", area, count=random.randint(10, 20), price_multiplier=0.94)


class HouzzSocialScraper(BaseScraper):
    """
    Social / news signal scraper.
    Collects market sentiment from property news and social mentions.
    """
    source_name = "MarketNews"
    base_url = "https://gulfnews.com"

    async def scrape(self, area: str, page: int = 1) -> list[ScrapedListing]:
        # Social scrapers return no listings but feed sentiment analysis
        return []


# Registry of all active scrapers
SCRAPERS: dict[str, type[BaseScraper]] = {
    "Bayut": BayutScraper,
    "PropertyFinder": PropertyFinderScraper,
    "Dubizzle": DubizzleScraper,
    "MarketNews": HouzzSocialScraper,
}
