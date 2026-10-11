from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from src.db import get_db
from src.models import WatchlistAddRequest


class WatchlistJobCreateRequest(BaseModel):
    stock_id: str


class WatchlistJobUpdateRequest(BaseModel):
    status: str | None = None
    progress: int | None = None
    total_days: int | None = None
    done_days: int | None = None
    error: str | None = None

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("")
def get_watchlist() -> list[dict[str, str]]:
    db = get_db()
    aql = """
    FOR w IN watchlist
      LET code = FIRST(
        FOR s IN stock_codes
          FILTER s.stock_id == w.stock_id
          LIMIT 1
          RETURN s
      )
      SORT w.added_at DESC
      RETURN {
        stock_id: w.stock_id,
        name: code != null ? code.name : "",
        added_at: w.added_at
      }
    """
    cursor = db.aql.execute(aql)
    return [item for item in cursor]


@router.post("")
def add_watchlist_item(payload: WatchlistAddRequest) -> dict[str, str]:
    db = get_db()

    stock_aql = """
    FOR s IN stock_codes
      FILTER s.stock_id == @stock_id
      LIMIT 1
      RETURN { stock_id: s.stock_id, name: s.name }
    """
    stock_cursor = db.aql.execute(stock_aql, bind_vars={"stock_id": payload.stock_id})
    stock_rows = [item for item in stock_cursor]
    if not stock_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stock_id not found")

    if db.collection("watchlist").has(payload.stock_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="stock already in watchlist")

    count_aql = """
    RETURN LENGTH(watchlist)
    """
    count_cursor = db.aql.execute(count_aql)
    counts = [item for item in count_cursor]
    current_count = int(counts[0]) if counts else 0
    if current_count >= 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自選股上限為 100 檔")

    added_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "_key": payload.stock_id,
        "stock_id": payload.stock_id,
        "added_at": added_at,
    }
    db.collection("watchlist").insert(doc)

    try:
        jobs_col = db.collection("watchlist_jobs")
        jobs_col.insert({
            "_key": payload.stock_id,
            "stock_id": payload.stock_id,
            "status": "pending",
            "progress": 0,
            "total_days": 50,
            "done_days": 0,
            "started_at": None,
            "completed_at": None,
            "error": "",
        }, overwrite=True)
        from src.tasks.calc_volume_profile import calc_volume_profile
        calc_volume_profile.delay(
            stock_id=payload.stock_id, date_str="", days=50
        )
    except Exception:
        pass

    # Async: backfill the full daily history (2010 onward) so charts and
    # Daniel MA cover the whole range without blocking the add request.
    try:
        from src.tasks.backfill_daily import backfill_daily_history
        backfill_daily_history.delay(stock_id=payload.stock_id)
    except Exception:
        pass

    return {
        "stock_id": payload.stock_id,
        "name": stock_rows[0]["name"],
        "added_at": added_at,
    }


@router.delete("/{stock_id}")
def delete_watchlist_item(stock_id: str) -> dict[str, bool | str]:
    watchlist = get_db().collection("watchlist")
    if not watchlist.has(stock_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stock_id not found")

    watchlist.delete(stock_id)
    try:
        get_db().collection("watchlist_jobs").delete(stock_id)
    except Exception:
        pass
    return {"deleted": True, "stock_id": stock_id}


# ── Watchlist jobs endpoints ────────────────────────────────────


@router.get("/jobs")
def list_watchlist_jobs() -> list[dict]:
    """Return all watchlist_jobs documents."""
    db = get_db()
    aql = "FOR j IN watchlist_jobs SORT j._key ASC RETURN j"
    cursor = db.aql.execute(aql)
    return [item for item in cursor]


@router.get("/jobs/{stock_id}")
def get_watchlist_job(stock_id: str) -> dict:
    """Return a single job by stock_id."""
    db = get_db()
    col = db.collection("watchlist_jobs")
    if not col.has(stock_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return col.get(stock_id)


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
def create_watchlist_job(payload: WatchlistJobCreateRequest) -> dict:
    """Create a new watchlist_jobs entry for a stock."""
    db = get_db()
    stock_id = payload.stock_id
    col = db.collection("watchlist_jobs")

    if col.has(stock_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="job already exists")

    doc = {
        "_key": stock_id,
        "stock_id": stock_id,
        "status": "pending",
        "progress": 0,
        "total_days": 50,
        "done_days": 0,
        "started_at": None,
        "completed_at": None,
        "error": "",
    }
    col.insert(doc)
    return doc


@router.post("/jobs/run-all")
async def run_all_jobs():
    from src.tasks.calc_volume_profile import calc_watchlist_all
    calc_watchlist_all.delay()
    return {"status": "triggered", "message": "Batch calculation enqueued"}


@router.patch("/jobs/{stock_id}")
def update_watchlist_job(stock_id: str, payload: WatchlistJobUpdateRequest) -> dict:
    """Update job status, progress, or error fields."""
    db = get_db()
    col = db.collection("watchlist_jobs")

    if not col.has(stock_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")

    existing = col.get(stock_id)
    update_fields: dict = {}

    if payload.status is not None:
        update_fields["status"] = payload.status
    if payload.progress is not None:
        update_fields["progress"] = payload.progress
    if payload.total_days is not None:
        update_fields["total_days"] = payload.total_days
    if payload.done_days is not None:
        update_fields["done_days"] = payload.done_days
    if payload.error is not None:
        update_fields["error"] = payload.error

    now = datetime.now(timezone.utc).isoformat()
    if payload.status == "running" and existing.get("started_at") is None:
        update_fields["started_at"] = now
    if payload.status in ("done", "failed"):
        update_fields["completed_at"] = now

    if update_fields:
        col.update({"_key": stock_id, **update_fields})

    return col.get(stock_id)
