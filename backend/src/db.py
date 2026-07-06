from arango import ArangoClient
from arango.database import StandardDatabase
from arango.exceptions import DatabaseCreateError

from src.config import get_settings

_client: ArangoClient | None = None
_db: StandardDatabase | None = None


def get_client() -> ArangoClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = ArangoClient(hosts=settings.ARANGO_URL)
    return _client


def get_db() -> StandardDatabase:
    global _db
    if _db is None:
        settings = get_settings()
        _db = get_client().db(
            name=settings.ARANGO_DB,
            username=settings.ARANGO_USER,
            password=settings.ARANGO_PASSWORD,
        )
    return _db


def ensure_database() -> StandardDatabase:
    settings = get_settings()
    client = get_client()
    system_db = client.db("_system", username=settings.ARANGO_USER, password=settings.ARANGO_PASSWORD)
    if not system_db.has_database(settings.ARANGO_DB):
        try:
            system_db.create_database(settings.ARANGO_DB)
        except DatabaseCreateError:
            pass
    return get_db()


def ensure_collection(name: str) -> None:
    db = get_db()
    if not db.has_collection(name):
        db.create_collection(name)
