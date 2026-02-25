from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://bimarket:bimarket_secret@localhost/market_intelligence"
    REDIS_URL: str = "redis://localhost:6379/0"
    SEED_DATA: bool = True

    # Scraping settings
    SCRAPE_INTERVAL_HOURS: int = 6
    MAX_CONCURRENT_SCRAPERS: int = 3
    REQUEST_DELAY_SECONDS: float = 2.0
    REQUEST_TIMEOUT_SECONDS: int = 30
    MAX_RETRIES: int = 3

    # Alert thresholds
    PRICE_CHANGE_ALERT_PCT: float = 5.0      # alert if price changes > 5%
    VELOCITY_SPIKE_THRESHOLD: float = 1.5    # alert if velocity > 1.5x average
    HEAT_INDEX_HIGH_THRESHOLD: float = 75.0  # alert if heat index > 75

    class Config:
        env_file = ".env"


settings = Settings()
