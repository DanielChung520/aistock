from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from src.db import get_db
from src.models import WatchlistAddRequest

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
    if current_count >= 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自選股上限為 50 檔")

    added_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "_key": payload.stock_id,
        "stock_id": payload.stock_id,
        "added_at": added_at,
    }
    db.collection("watchlist").insert(doc)
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
    return {"deleted": True, "stock_id": stock_id}
