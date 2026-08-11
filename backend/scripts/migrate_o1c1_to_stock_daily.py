#!/usr/bin/env python3
"""
One-time migration (方案A): copy O1/C1 from `stock_daily_o1c1` into
`stock_daily` so ML features read the single yfinance OHLCV source.

stock_daily_o1c1 and stock_daily share the key convention {stock_id}_{date},
so UPDATE-by-key merges o1/c1 onto the existing OHLCV docs directly.

Resumable/idempotent: re-running overwrites the same o1/c1 values.
"""
import sys

sys.path.insert(0, "/home/daniel/github/aistock/backend/scripts")
import _dns_fix  # noqa: E402
_dns_fix.patch()

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

SOURCE = "stock_daily_o1c1"
TARGET = "stock_daily"


def main() -> None:
    db = get_db()
    pre = list(db.aql.execute(
        f"""
        FOR d IN {SOURCE}
          FILTER d.o1 != null OR d.c1 != null
          COLLECT WITH COUNT INTO cnt
          RETURN cnt
        """
    ))
    print(f"source rows with o1/c1: {pre}")

    aql = f"""
    FOR d IN {SOURCE}
      FILTER d.o1 != null OR d.c1 != null
      UPDATE {{ _key: d._key, o1: d.o1, c1: d.c1 }} IN {TARGET}
      OPTIONS {{ ignoreErrors: true, keepNull: false }}
    """
    db.aql.execute(aql)
    after = list(db.aql.execute(
        f"""
        FOR d IN {TARGET}
          FILTER d.o1 != null OR d.c1 != null
          COLLECT WITH COUNT INTO cnt
          RETURN cnt
        """
    ))
    print(f"target rows with o1/c1 after: {after}")


if __name__ == "__main__":
    main()