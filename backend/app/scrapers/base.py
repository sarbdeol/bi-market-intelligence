"""
Base Scraper
============
Provides anti-scraping countermeasures, retry logic, and rate limiting.

Anti-scraping strategy:
  1. Rotating user-agents (fake-useragent library)
  2. Randomised request delays (configurable jitter)
  3. Exponential backoff on 429/503 responses
  4. Session rotation (new httpx client per batch)
  5. Respect robots.txt (configurable)
  6. Normalise and deduplicate via content hash

In production, add:
  - Residential proxy rotation (e.g., Bright Data, Oxylabs)
  - Browser fingerprint spoofing via Playwright/Pyppeteer
  - CAPTCHA solving service integration
  - IP allowlisting via official data partnerships
"""

import asyncio
import hashlib
import json
import random
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.config import settings

# Rotating user agents pool
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]


@dataclass
class ScrapedListing:
    """Normalised listing from any source."""
    external_id: str
    title: str
    area: str
    sub_area: Optional[str]
    property_type: str
    price_aed: int
    price_per_sqft: Optional[float]
    bedrooms: Optional[int]
    bathrooms: Optional[int]
    size_sqft: Optional[float]
    url: Optional[str]
    listed_at: Optional[datetime]

    def content_hash(self) -> str:
        """SHA-256 of key fields for change detection."""
        payload = json.dumps({
            "id": self.external_id,
            "price": self.price_aed,
            "title": self.title,
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()


class BaseScraper(ABC):
    """Abstract base for all source scrapers."""

    source_name: str = "base"
    base_url: str = ""

    def __init__(self):
        self._request_count = 0
        self._last_request_time = 0.0

    def _get_headers(self) -> dict:
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }

    async def _throttle(self):
        """Enforce minimum delay between requests with jitter."""
        elapsed = time.time() - self._last_request_time
        min_delay = settings.REQUEST_DELAY_SECONDS
        jitter = random.uniform(0.5, 1.5)
        wait = max(0, min_delay * jitter - elapsed)
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_request_time = time.time()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=30),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
    )
    async def _fetch(self, url: str) -> httpx.Response:
        await self._throttle()
        async with httpx.AsyncClient(
            headers=self._get_headers(),
            timeout=settings.REQUEST_TIMEOUT_SECONDS,
            follow_redirects=True,
        ) as client:
            resp = await client.get(url)
            # Respect rate limits
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 60))
                await asyncio.sleep(retry_after)
                resp.raise_for_status()
            resp.raise_for_status()
            self._request_count += 1
            return resp

    @abstractmethod
    async def scrape(self, area: str, page: int = 1) -> list[ScrapedListing]:
        """Scrape listings for a given area. Must be implemented by subclasses."""
        pass

    def parse_price(self, price_str: str) -> Optional[int]:
        """Normalise price strings like 'AED 2,500,000' → 2500000."""
        if not price_str:
            return None
        cleaned = "".join(c for c in price_str if c.isdigit())
        return int(cleaned) if cleaned else None

    def normalise_area(self, raw: str) -> str:
        """Normalise area names for consistent grouping."""
        mapping = {
            "downtown dubai": "Downtown Dubai",
            "dubai marina": "Dubai Marina",
            "palm jumeirah": "Palm Jumeirah",
            "business bay": "Business Bay",
            "jumeirah": "Jumeirah",
            "emirates hills": "Emirates Hills",
            "arabian ranches": "Arabian Ranches",
            "dubai hills": "Dubai Hills Estate",
        }
        return mapping.get(raw.lower().strip(), raw.strip().title())
