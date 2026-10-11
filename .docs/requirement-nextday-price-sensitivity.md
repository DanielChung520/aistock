# 需求定位：隔日價格敏感度分析與掛單策略（DanielMA 驗證）

> 狀態：討論收斂中，尚未進入實作
> 日期：2026-08-16
> 關聯 skill：`需求`（graph-guided requirements）

---

## 1. 需求概述與關鍵面向

**核心動機**：使用者有 DanielMA 指標（日K 漲跌預測準確率高），但「預測準 ≠ 會賺錢」——
方向準確無法解決**掛單成交問題**：買單要成交靠隔日 low 觸及掛單價，賣單靠隔日 high。
若無法預測隔日 high/low，買不到或賣不出 → 虧損。

**關鍵面向（3）**：
1. **隔日價格範圍預測**（非方向）——目標是隔日 OHLC 完整區間，非 next_close 方向
2. **機率分佈輸出**（非點估計）——分位數回歸（p5/p25/p50/p75/p95），支援「給定成交機率 → 算掛單價」
3. **特徵敏感度分析**——找出對隔日 high/low（尤其尾部 p5/p25）敏感的特徵

## 2. 已收斂決策

| # | 決策點 | 決策 | 理由 |
|---|---|---|---|
| 1 | 目標價格 | **隔日完整區間**（OHLC 四欄） | 掛單成交取決於 high/low 觸價 |
| 2 | 機率分佈形式 | **分位數回歸** | XGBoost/LightGBM 原生支援；可直接反查「成交機率→掛單價」 |
| 3 | 策略配置 | **給定成交機率 → 算掛單價** | 買單：`掛單價 = q_p(next_low)`；賣單：`掛單價 = q_{1-p}(next_high)` |
| 4 | 敏感度分析結構 | **兩階段漏斗**（10 家族 → top 家族內 SHAP） | 89 欄組內高度相關，全量一次會稀釋重要性 |
| 5 | 敏感度目標維度 | 未定（傾向先 next_low/next_high） | 對中位數敏感 ≠ 對尾部敏感；DanielMA 已覆蓋方向 |
| 6 | 整合位置 | **先討論**（未定：擴充 ai-training vs 獨立模組 vs CLI） | 尚未決定 |
| 7 | 資料範圍 | **全部 1958 檔（含 O1/C1）** | 驗證 DanielMA 用全部股票，統計結論更強 |
| 8 | O1/C1 用途 | **當特徵用**（三盤拆解、盤中強弱） | 隔日 high/low 與今日盤中結構相關 |
| 9 | 執行方式 | **一步步、分開做**，第一步＝全部資料收錄 | 使用者明確要求 |

## 3. 圖譜摘要（影響模組）

### 既有資產（可複用）
| 模組 | 角色 |
|---|---|
| `backend/src/features.py` `compute_features()` | 89 欄特徵（10 家族：pct/slope/rsi/kdj/macd/divergence/three/candle/master/bollinger），已含 o1/c1 |
| `backend/src/tasks/feature_generate.py` | `stock_daily_features` 生成（Celery，WARMUP_DAYS=400） |
| `backend/src/ml_training.py` | 訓練核心（TARGET_TASK：next_return/next_price/next_direction；5 模型） |
| `backend/src/backtest.py` `run_backtest()` | ⚠️ 現有 DanielMA 回測——**有 look-ahead bias**（買賣都在訊號當天收盤價成交） |
| `backend/src/tasks/research_download.py` `_fetch_ohlcv_incremental()` | yfinance 60m → o1/c1 → 回寫 stock_daily（方案A，僅跑 59 檔 universe） |
| `backend/src/indicators.py` `calculate_ma_daniel()` | DanielMA 指標（line 261，17 callers） |
| `.docs/charact.md` | 89 欄特徵規格（o1/c1 三盤定義） |
| `.docs/ai-training.md` | AI 訓練規格（6 步 wizard、雙軌評估） |

### 資料現況（2026-08-16 實查）
```
stock_daily：6,658,361 筆 / 1,958 檔（OHLCV 全庫）
有 o1 的：27,983 筆 / 58 檔
有 c1 的：27,982 筆 / 58 檔
stock_codes：1,961 檔（stock_codes.market = None，後綴需用 twstock.codes）
twstock.codes 判斷：上市 1,057 / 上櫃 880 / 其他 24（0 缺失）
```

### 技術驗證結果
| 項目 | 結果 |
|---|---|
| yfinance 60m 主流股 | ✅ 100% 覆蓋（483/483 天） |
| yfinance 60m 冷門股 | ✅ ~80%（缺的為停牌日） |
| 上櫃股（.TWO） | ✅ 90-93% |
| 下市/不存在代號 | ✅ 回傳空，正常跳過 |

## 4. 第一步實作藍圖：全部資料收錄（含 O1/C1）

```
新腳本 backend/scripts/backfill_o1c1_all.py（仿 backfill_all_daily.py 模式）
  1. 讀 stock_codes 全部 1961 檔
  2. 每檔後綴：twstock.codes 判斷 market（上櫃 → .TWO，其餘 → .TW）
  3. yfinance.history(period="2y", interval="60m")
     → 推導 o1/c1（09:00 bar close → o1；12:00 bar close → c1）
  4. upsert 回 stock_daily（僅更新 o1/c1 欄位，merge=True 保留既有值）
  5. batch 30 + sleep，失敗紀錄可重入（resumable）
```

- **成本**：~1961 次 60m request，約 2-3 小時
- **風險**：yfinance 限流、部分股無 60m（下市/新股/冷門）→ o1/c1 = null（既有語義）
- **後續**：每日增量維持研究清單；全庫 O1/C1 建議改每週回補（未定）

## 5. 未決問題

| # | 問題 | 狀態 |
|---|---|---|
| 1 | 敏感度分析目標維度（low/high 先行 vs OHLC 全做） | ⏳ 未定 |
| 2 | 整合位置（擴充 ai-training / 獨立模組 / CLI） | ⏳ 未定 |
| 3 | 是否先修 `backtest.py` 的 look-ahead bias 再做驗證 | ⏳ 建議先做 |
| 4 | 全庫 O1/C1 的每日增量策略 | ⏳ 未定 |
| 5 | 「每家族挑 top 2-3 欄」的 K 值 | ⏳ 未定 |
| 6 | 分位數模型的組織（每欄×每分位 vs 多輸出） | ⏳ 未定 |
| 7 | 逆選擇（adverse selection）的成交條件報酬校正 | ⏳ 策略層時處理 |

## 6. 決策脈絡（為什麼）

- **選分位數回歸不選高斯假設**：報酬率肥尾，高斯假設過強；分位數不需分佈假設
- **不先做 RL**：59 檔 × 490 天 = 59 條 episode，RL 資料嚴重不足；且 RL 的成交幻覺問題在環境
  不真實模擬 fill 時會放大——先有可信的 fill 量測（分位數模型），再談決策層
- **兩階段漏斗不全量一次**：`slope_ma8/13/21` 同源，importance 會被拆散 → 假結論
- **O1/C1 對隔日 high/low 重要**：早盤（o1）尾盤（c1）強弱是隔日高低點的結構訊號，
  只有 OHLCV 會把一日內部結構抹平
- **DanielMA 驗證基準線 = 買入持有**：ratchet effect 下，每筆都賺仍可能輸給躺平