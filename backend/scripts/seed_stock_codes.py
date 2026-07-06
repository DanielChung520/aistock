import importlib
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _normalize_market(stock_type: str) -> str:
    value = stock_type.lower()
    if "上櫃" in stock_type or "tpex" in value or "otc" in value:
        return "tpex"
    return "twse"


def main() -> None:
    from src.db import ensure_collection, ensure_database, get_db

    twstock_module = importlib.import_module("twstock")
    arango_exceptions = importlib.import_module("arango.exceptions")
    document_insert_error = getattr(arango_exceptions, "DocumentInsertError")

    ensure_database()
    ensure_collection("stock_codes")
    collection = get_db().collection("stock_codes")
    collection.truncate()

    total = len(twstock_module.codes)
    processed = 0

    for code, info in twstock_module.codes.items():
        if not code.isdigit() or len(code) != 4:
            continue

        document = {
            "_key": code,
            "stock_id": code,
            "name": info.name,
            "isin_code": info.ISIN or "",
            "market_type": _normalize_market(info.type),
            "industry": info.group or "",
            "listed_date": info.start or "",
        }

        try:
            collection.insert(document, overwrite=True)
        except document_insert_error:
            collection.replace(code, document)

        processed += 1
        if processed % 100 == 0:
            print(f"Seeded {processed}/{total} stock codes")

    print(f"Seeding complete: {processed} stock codes")


if __name__ == "__main__":
    main()
