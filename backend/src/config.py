from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent.parent / ".env"),
        env_file_encoding="utf-8",
    )

    ARANGO_URL: str = "http://localhost:8530"
    ARANGO_DB: str = "aistock"
    ARANGO_USER: str = "root"
    ARANGO_PASSWORD: str = "aistock2024"
    FASTAPI_PORT: int = 8000

    SEAWEEDFS_ENDPOINT: str = "http://localhost:8334"
    SEAWEEDFS_ACCESS_KEY: str = "admin"
    SEAWEEDFS_SECRET_KEY: str = "admin123"
    SEAWEEDFS_BUCKET: str = "aistock-market-data"
    FINMIND_TOKEN: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
