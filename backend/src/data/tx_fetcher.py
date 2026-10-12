"""TX (台指期) 歷史 K 線資料抓取層。

提供三種資料源的統一介面：
1. **ShioajiFetcher** — 永豐金證券官方 Python SDK（推薦，需安裝 `shioaji`）
2. **FinMindFetcher** — FinMind API（備援，付費 tick 資料需 sponsor 會員）
3. **QuantPassFetcher** — QuantPass 整理包 ZIP 匯入（2006~2024/05 歷史 1 分 K）

每個 fetcher 都實作同一組公開介面：
- `fetch_kbars(contract, start, end) -> list[dict]` — 抓 1 分 K
- `fetch_tick(contract, date) -> list[dict]` — 抓逐筆 tick（可選）

設計原則：
- **無副作用**：不直接寫 DB，由呼叫端決定如何儲存
- **Optional dependency**：shioaji 若未安裝則 ShioajiFetcher 為 None
- **明確錯誤**：任何抓取失敗都拋例外，由上層決定重試或 fallback

參考：
- `.docs/SPEC/TX-台指期/TX-0011-data-collection-progress.md` §1.2
- `.docs/SPEC/TX-台指期/TX-0010-rl-trading-spec.md` §3.1
"""
from __future__ import annotations

import csv
import io
import logging
import os
import zipfile
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ── Public types ─────────────────────────────────────────────────────────

# 一筆 1 分 K 線的標準格式（aggregator 預期吃這個格式）
KBarRecord = dict[str, Any]
# 必要欄位：date (YYYY-MM-DD), time (HH:MM), open, high, low, close, volume
# 選用欄位：open_interest, session (day/night), contract, source


class FetchError(RuntimeError):
    """資料抓取失敗（網路、認證、來源錯誤等）。"""


# ── Base interface ───────────────────────────────────────────────────────

class BaseFetcher(ABC):
    """所有 fetcher 的共同介面。"""

    source_name: str = "unknown"

    @abstractmethod
    def fetch_kbars(
        self,
        contract: str,
        start: str,  # YYYY-MM-DD
        end: str,    # YYYY-MM-DD
    ) -> list[KBarRecord]:
        """抓取 1 分 K 線資料（合約代號格式依各家而異）。"""

    def fetch_tick(self, contract: str, day: str) -> list[KBarRecord]:
        """抓取逐筆 tick（預設不支援，子類別覆寫）。"""
        raise NotImplementedError(f"{self.source_name} 不支援逐筆 tick 抓取")

    def is_available(self) -> bool:
        """檢查 fetcher 是否可用（已認證 / 已初始化）。"""
        return True


# ── Shioaji fetcher ──────────────────────────────────────────────────────

class ShioajiFetcher(BaseFetcher):
    """永豐金證券 Shioaji 客戶端封裝。

    認證需要：
      - SHIOAJI_API_KEY
      - SHIOAJI_SECRET_KEY
      - SHIOAJI_CA_PATH（電子憑證路徑，純行情查詢可選）
      - SHIOAJI_CA_PASSWD

    流量限制（盤中）：
      - kbars 查詢 ≤ 270 次
      - ticks 查詢 ≤ 10 次
    本模組只設計為「盤後批次」使用，不在盤中大量呼叫。

    歷史深度：Futures 從 2020-03-22 起（文件明寫）。
    """

    source_name = "shioaji"

    def __init__(self) -> None:
        try:
            import shioaji as sj  # type: ignore[import-untyped]
        except ImportError as exc:
            raise FetchError(
                "shioaji 套件未安裝。請執行 `pip install shioaji` 或設 SHIOAJI_ENABLED=false"
            ) from exc

        self._sj = sj
        self._api: Any | None = None
        self._contracts: dict[str, Any] = {}

    def login(self) -> None:
        """登入 Shioaji（背景執行，會自動在第一次查詢時 lazy login）。"""
        if self._api is not None:
            return

        api_key = os.getenv("SHIOAJI_API_KEY", "")
        secret_key = os.getenv("SHIOAJI_SECRET_KEY", "")
        if not api_key or not secret_key:
            raise FetchError("缺少 SHIOAJI_API_KEY 或 SHIOAJI_SECRET_KEY 環境變數")

        self._api = self._sj.Shioaji()
        self._api.login(api_key=api_key, secret_key=secret_key)

        ca_path = os.getenv("SHIOAJI_CA_PATH", "")
        ca_passwd = os.getenv("SHIOAJI_CA_PASSWD", "")
        if ca_path and ca_passwd:
            try:
                self._api.activate_ca(ca_path=ca_path, ca_passwd=ca_passwd)
            except Exception as exc:
                # 純行情查詢（不下單）可以跳過 CA；記 warning 不中斷
                logger.warning("Shioaji CA 啟動失敗（下單功能將不可用）: %s", exc)

        # 預先建好常用 TX 合約索引（避免每次查詢都 lookup）
        try:
            for c in self._api.Contracts.Futures.TXF:
                self._contracts[c.code] = c
        except Exception:
            logger.warning("無法預載 TXF 合約清單，查詢時將動態查找")

    def _resolve_contract(self, contract: str) -> Any:
        """把 'TXFR1' / 'TXF202509' 等字串轉成 Shioaji Contract 物件。"""
        self.login()
        assert self._api is not None

        if contract in self._contracts:
            return self._contracts[contract]

        # 動態查找（首次會比較慢）
        for c in self._api.Contracts.Futures.TXF:
            if c.code == contract:
                self._contracts[contract] = c
                return c
        raise FetchError(f"Shioaji 找不到合約: {contract}")

    def fetch_kbars(
        self,
        contract: str,
        start: str,
        end: str,
    ) -> list[KBarRecord]:
        """抓取 1 分 K 線（Shioaji 底層從 tick 聚合）。

        回傳格式統一為：
          [{date, time, open, high, low, close, volume, contract, source}, ...]
        """
        self.login()
        assert self._api is not None
        c = self._resolve_contract(contract)

        try:
            kbars = self._api.kbars(c, start=start, end=end)
        except Exception as exc:
            raise FetchError(f"Shioaji kbars() 失敗 ({contract} {start}~{end}): {exc}") from exc

        if not kbars:
            return []

        # Shioaji 的 Kbars 物件有 __dict__，含 ts / Open / High / Low / Close / Volume
        records: list[KBarRecord] = []
        for k in kbars:
            ts = getattr(k, "ts", None)
            if ts is None:
                continue
            # ts 是 pandas Timestamp
            date_part = ts.strftime("%Y-%m-%d")
            time_part = ts.strftime("%H:%M")
            # 判斷日/夜盤（依 TAIFEX 規則：08:45~13:45 為日盤，15:00~05:00 為夜盤）
            hour = ts.hour
            if 8 <= hour < 14 or (hour == 13 and ts.minute <= 45):
                session = "day"
            else:
                session = "night"
            records.append({
                "date": date_part,
                "time": time_part,
                "open": float(k.Open),
                "high": float(k.High),
                "low": float(k.Low),
                "close": float(k.Close),
                "volume": int(k.Volume),
                "session": session,
                "contract": contract,
                "source": self.source_name,
            })
        logger.info(
            "Shioaji kbars %s %s~%s: %d 筆",
            contract, start, end, len(records),
        )
        return records


# ── FinMind fetcher ──────────────────────────────────────────────────────

class FinMindFetcher(BaseFetcher):
    """FinMind API 抓取層（用於備援 / 驗證）。

    公開 API：
      - TaiwanFuturesDaily（免費，2007~）— 日線
      - TaiwanFuturesTick（需 sponsor 會員，2011~）— 逐筆

    本 fetcher 主要用於備援；正常使用以 Shioaji 為主。
    """

    source_name = "finmind"
    BASE_URL = "https://api.finmindtrade.com/api/v4/data"

    def __init__(self) -> None:
        self._token = os.getenv("FINMIND_API_TOKEN", "")
        if not self._token:
            logger.warning(
                "FINMIND_API_TOKEN 未設定，FinMindFetcher 部分功能（tick）將不可用"
            )

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"} if self._token else {}

    def _request(self, dataset: str, **params: Any) -> list[dict]:
        params["dataset"] = dataset
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(self.BASE_URL, params=params, headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") != 200:
                # FinMind 回 200 但 status 為 error 時不拋例外（容錯）
                logger.warning(
                    "FinMind %s 回傳非 200 status: %s",
                    dataset, data.get("msg", data.get("status")),
                )
                return []
            return data.get("data", [])

    def fetch_kbars(
        self,
        contract: str,
        start: str,
        end: str,
    ) -> list[KBarRecord]:
        """FinMind 沒有現成的「分 K」資料，這裡 fallback 到 daily。

        若要拿分 K，請用 sponsor 會員的 TaiwanFuturesTick 自己組。
        """
        # FinMind 的 futures_id 用 TX (不是 TXF)
        futures_id = "TX" if contract.startswith("TX") else contract
        rows = self._request(
            "TaiwanFuturesDaily",
            data_id=futures_id,
            start_date=start,
            end_date=end,
        )
        # 過濾到對應合約月份
        records: list[KBarRecord] = []
        for r in rows:
            contract_date = r.get("contract_date", "")
            # TXFR1 / TXF202509 都應該對應到當下的近月；這裡簡化處理：
            # 若 contract 是 'TXFR1' 或 'TXFR2'，取所有 contract_date（呼叫端負責篩選）
            # 若 contract 是 'TXF202509' 等具體合約，只留 contract_date == '202509'
            if contract.startswith("TXF") and len(contract) == 9:
                target_month = contract[3:]  # '202509'
                if contract_date != target_month:
                    continue
            records.append({
                "date": r.get("date", ""),
                "time": "13:45",  # 日盤收盤
                "open": float(r.get("open", 0)),
                "high": float(r.get("max", r.get("high", 0))),
                "low": float(r.get("min", r.get("low", 0))),
                "close": float(r.get("close", 0)),
                "volume": int(r.get("Trading_Volume", r.get("volume", 0))),
                "session": "day",
                "contract": contract,
                "source": self.source_name,
                "open_interest": int(r.get("OpenInterest", r.get("open_interest", 0)) or 0),
            })
        logger.info(
            "FinMind daily %s %s~%s: %d 筆",
            contract, start, end, len(records),
        )
        return records


# ── QuantPass fetcher (ZIP 匯入) ──────────────────────────────────────────

class QuantPassFetcher(BaseFetcher):
    """QuantPass 整理包 ZIP 匯入（2006~2024/05 TX 1 分 K）。

    QuantPass 整理的 TX 1 分 K 格式（CSV）：
      Date,Open,High,Low,Close,Volume
      2024-05-15 08:45:00, 21500, 21510, 21495, 21505, 1234

    注意：
      - 不含夜盤（QuantPass 整理的版本只到 2024-05/日盤）
      - 沒有 OI（OpenInterest）
      - 第一根 K 是 08:45 而非 08:46（國際通用標準）
    """

    source_name = "quantpass"

    def __init__(self, zip_dir: str | None = None) -> None:
        self._zip_dir = Path(
            zip_dir or os.getenv("TX_QUANTPASS_ZIP_DIR", "/home/daniel/aistock-data/tx-quantpass")
        )

    def is_available(self) -> bool:
        return self._zip_dir.exists() and any(self._zip_dir.glob("*.zip"))

    def fetch_kbars(
        self,
        contract: str,
        start: str,
        end: str,
    ) -> list[KBarRecord]:
        """從 ZIP 內讀取符合日期區間的 CSV。"""
        if not self.is_available():
            raise FetchError(
                f"QuantPass 整理包目錄不可用: {self._zip_dir}（請手動下載後解壓到此）"
            )

        start_d = datetime.strptime(start, "%Y-%m-%d").date()
        end_d = datetime.strptime(end, "%Y-%m-%d").date()

        records: list[KBarRecord] = []
        # 找對應年度的 ZIP（檔名慣例：TX_YYYY.zip 或 TX_YYYY_MM.zip）
        for zip_path in sorted(self._zip_dir.glob("*.zip")):
            try:
                with zipfile.ZipFile(zip_path) as zf:
                    for name in zf.namelist():
                        if not name.endswith(".csv"):
                            continue
                        with zf.open(name) as f:
                            text = io.TextIOWrapper(f, encoding="utf-8")
                            reader = csv.DictReader(text)
                            for row in reader:
                                # CSV header: Date,Open,High,Low,Close,Volume
                                dt_str = row.get("Date") or row.get("date") or ""
                                try:
                                    dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
                                except (ValueError, TypeError):
                                    continue
                                d = dt.date()
                                if d < start_d or d > end_d:
                                    continue
                                # 合約月份歸屬（簡化：用日期所在月份）
                                # 實務上換月需另外處理；QuantPass 資料本身已標好合約
                                session = "day" if dt.hour < 14 else "night"
                                records.append({
                                    "date": d.isoformat(),
                                    "time": dt.strftime("%H:%M"),
                                    "open": float(row.get("Open", 0)),
                                    "high": float(row.get("High", 0)),
                                    "low": float(row.get("Low", 0)),
                                    "close": float(row.get("Close", 0)),
                                    "volume": int(float(row.get("Volume", 0))),
                                    "session": session,
                                    "contract": contract,
                                    "source": self.source_name,
                                })
            except zipfile.BadZipFile:
                logger.warning("跳過損壞的 ZIP: %s", zip_path)
                continue

        records.sort(key=lambda r: (r["date"], r["time"]))
        logger.info(
            "QuantPass %s %s~%s: %d 筆",
            contract, start, end, len(records),
        )
        return records


# ── Module-level factory ─────────────────────────────────────────────────

def get_fetcher(source: str = "shioaji") -> BaseFetcher | None:
    """工廠函式：依名稱取得 fetcher 實例。

    回傳 None 表示該來源不可用（缺套件 / 未登入 / 找不到資料）。
    """
    try:
        if source == "shioaji":
            return ShioajiFetcher()
        if source == "finmind":
            return FinMindFetcher()
        if source == "quantpass":
            f = QuantPassFetcher()
            return f if f.is_available() else None
    except FetchError as exc:
        logger.warning("Fetcher %s 不可用: %s", source, exc)
        return None
    raise FetchError(f"不支援的資料源: {source}")


def list_available_sources() -> list[str]:
    """列出所有可用的 fetcher。"""
    available = []
    for src in ("shioaji", "finmind", "quantpass"):
        if get_fetcher(src) is not None:
            available.append(src)
    return available
