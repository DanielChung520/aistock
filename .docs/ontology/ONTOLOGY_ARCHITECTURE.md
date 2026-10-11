# Ontology 架構規範

> **適用範圍**:aiStock 與 kag 之間的 ontology 資料流、所有權、版本管理、與多專案隔離
> **最後更新**:2026-07-08
> **狀態**:待 PM 確認 → 確認後再生成 `stock-investment-tw-v1.json`
> **相關文件**:`/home/daniel/github/.omo/plans/kag-standalone.md`(kag 端計畫)、`/home/daniel/github/kag/docs/`(kag 規格)

---

## 一、核心結論

- **aiStock 是 ontology 的擁有者**(version control、evolution、UI、審計)
- **kag 是多專案的 RAG 服務**,ontology 在 kag 是 **cache**(按 `project_id` 隔離),不是 source of truth
- AI 討論、Diff、版本發佈在 aiStock 完成後,主動 **sync 給 kag**
- KB 在 kag 透過 `(project_id, ontology_key, version)` 三元組參照快取中的 ontology

---

## 二、系統架構

```mermaid
flowchart LR
    subgraph Client["Browser (PM/分析師)"]
        UI[aiStock UI<br/>antd + Next.js]
    end

    subgraph Aistock["aiStock (single-project)"]
        AistockAPI[aiStock API<br/>Next.js route handlers]
        AistockDB[(aiStock ArangoDB<br/>ontology, ontology_version, ontology_chat)]
        AistockLLM[aiStock LLM client<br/>OpenAI SDK]
    end

    subgraph Kag["kag (multi-project)"]
        KagAPI[kag API<br/>FastAPI]
        KagCache[(kag ArangoDB<br/>kag_cached_ontologies<br/>scoped by project_id)]
        KagWorker[kag Celery worker<br/>vectorize / extract_graph]
    end

    subgraph Infra["共用基礎設施"]
        Arango[(ArangoDB)]
        Qdrant[(Qdrant)]
        SeaweedFS[(SeaweedFS)]
        Redis[(Redis)]
        Dllm[(dllm<br/>qwen3-30b-a3b-4bit<br/>qwen2.5-vl-8b<br/>bge-m3)]
    end

    UI -->|HTTP| AistockAPI
    AistockAPI -->|讀寫| AistockDB
    AistockAPI -->|AI 討論| AistockLLM
    AistockLLM -->|OpenAI API| Dllm

    AistockAPI -.->|POST /api/v1/ontologies/sync| KagAPI
    KagAPI -->|cache 寫入| KagCache

    UI -->|使用 KB 搜尋/上傳| KagAPI
    KagAPI -->|graph extract| KagWorker
    KagWorker -->|讀 ontology| KagCache
    KagWorker -->|embed / extract| Dllm
    KagWorker -->|向量| Qdrant
    KagWorker -->|graph nodes/edges| Arango
    KagAPI -->|讀寫| Arango
    KagAPI -->|讀寫| Qdrant
    KagAPI -->|讀寫| SeaweedFS
    KagAPI -->|queue| Redis
    KagWorker -->|queue| Redis

    classDef aistock fill:#1e40af,stroke:#3b82f6,color:#fff
    classDef kag fill:#7c3aed,stroke:#a78bfa,color:#fff
    classDef shared fill:#374151,stroke:#9ca3af,color:#fff
    class AistockAPI,AistockDB,AistockLLM aistock
    class KagAPI,KagCache,KagWorker kag
    class Arango,Qdrant,SeaweedFS,Redis,Dllm shared
```

**關鍵邊界**:
- **虛線** = aiStock 推 ontology 到 kag(cache 寫入)
- **實線** = 一般 API 呼叫
- aiStock 與 kag 共享 ArangoDB / Qdrant / SeaweedFS / Redis(透過 `kag_` 前綴隔離 collection / bucket / key)
- aiStock 與 kag 共享 dllm(同一個 OpenAI 相容 LLM 端點)

---

## 三、Ontology 儲存分佈

```mermaid
flowchart TB
    subgraph AistockDB["aiStock ArangoDB (source of truth)"]
        O1["collection: ontology<br/>━━━━━━━━━━<br/>_key: stock-investment-tw<br/>name: 股票投資本體(台股)<br/>status: published<br/>current_version: 3<br/>owner_project: aistock<br/>created_by, created_at, updated_at"]
        O2["collection: ontology_version<br/>━━━━━━━━━━<br/>_key: stock-investment-tw/v1<br/>_key: stock-investment-tw/v2<br/>_key: stock-investment-tw/v3<br/>━━━━━━━━━━<br/>payload: {entity_classes, ...}<br/>diff_from_previous<br/>is_breaking<br/>sync_status: synced/pending/failed<br/>kag_synced_at"]
        O3["collection: ontology_chat<br/>━━━━━━━━━━<br/>_key: stock-investment-tw/TIMESTAMP<br/>role: user / assistant<br/>content: 訊息本文<br/>context_snapshot: {current_draft: {...}}"]
    end

    subgraph KagDB["kag ArangoDB (cache)"]
        K1["collection: kag_cached_ontologies<br/>━━━━━━━━━━<br/>_key: aistock:stock-investment-tw/v3<br/>━━━━━━━━━━<br/>project_id: aistock<br/>ontology_key: stock-investment-tw<br/>version: 3<br/>payload: {entity_classes, ...}<br/>synced_at<br/>ttl: 7d"]
    end

    O2 -.->|POST /api/v1/ontologies/sync| K1

    classDef owner fill:#1e3a8a,stroke:#3b82f6,color:#fff
    classDef cache fill:#5b21b6,stroke:#a78bfa,color:#fff
    class O1,O2,O3 owner
    class K1 cache
```

**所有權矩陣**:

| 資料 | aiStock | kag | Source of truth |
|---|---|---|---|
| Ontology metadata(name, status, current_version)| 寫 | 不存 | **aiStock** |
| Ontology payload(entity_classes, object_properties)| 寫(發版時)| 寫(cache, TTL 7d)| **aiStock** |
| Ontology 對話歷史 | 寫 | 不存 | **aiStock** |
| AI 討論的 draft schema | 寫 | 不存 | **aiStock** |
| KB metadata | 不存 | 寫 | **kag** |
| KB 內 chunk / vector / graph | 不存 | 寫 | **kag** |
| KB 對 ontology 的引用(key + version)| 不存 | 寫 | **kag** |

---

## 四、Ontology 生命週期(Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor PM as PM / Domain Expert
    participant UI as aiStock UI<br/>(/admin/ontology)
    participant AS as aiStock API
    participant LLM as dllm<br/>(qwen3-30b-a3b-4bit)
    participant ASDB as aiStock ArangoDB
    participant KAPI as kag API
    participant KDB as kag ArangoDB

    Note over PM,UI: ① 建立草稿(AI 討論)
    PM->>UI: 描述領域
    UI->>AS: POST /api/v1/admin/ontology/discuss
    AS->>LLM: chat (ontology 討論 prompt)
    LLM-->>AS: 反問 + 草案
    AS-->>UI: 對話串
    PM->>UI: 繼續對話
    Note over AS,ASDB: 每輪對話寫入 ontology_chat

    Note over PM,UI: ② 生成 JSON 草案
    UI->>AS: POST /api/v1/admin/ontology/generate
    AS->>LLM: 從對話歷史生成 JSON
    LLM-->>AS: entity_classes + object_properties
    AS-->>UI: 草案 JSON
    PM->>UI: 編輯 / 確認
    UI->>AS: POST /api/v1/admin/ontology/import (dryrun=true)
    AS-->>UI: 驗證結果

    Note over PM,UI: ③ 發佈為 v1
    PM->>UI: 按「發佈為 v1」
    UI->>AS: POST /api/v1/admin/ontology/{key}/publish
    AS->>ASDB: 寫 ontology + ontology_version
    AS->>AS: 計算 diff_from_previous
    AS->>ASDB: ontology_chat 標記 finalized

    Note over AS,KDB: ④ 同步到 kag
    AS->>KAPI: POST /api/v1/ontologies/sync
    KAPI->>KDB: UPSERT kag_cached_ontologies
    KDB-->>KAPI: ok
    KAPI-->>AS: 200 synced

    Note over UI,KAPI: ⑤ 在 kag 建立 KB 引用此 ontology
    UI->>KAPI: POST /api/v1/knowledge-bases<br/>{name, project_id, ontology_key, ontology_version}
    KAPI->>KDB: 檢查 cache 存在?
    KDB-->>KAPI: ok
    KAPI->>KDB: 建立 KB(記住 ontology_key + version)

    Note over UI,KAPI: ⑥ 之後 v2 發佈
    PM->>UI: 編輯後「發佈為 v2」
    UI->>AS: POST /api/v1/admin/ontology/{key}/publish
    AS->>ASDB: 寫 v2 + diff_from_previous
    AS->>KAPI: POST /api/v1/ontologies/sync v2
    KAPI->>KDB: 寫 v2
    Note over KAPI: 舊 KB 仍綁定 v1, 不受影響
```

**發佈原則**:
- v1, v2, v3 都永久保留(immutable)
- KB 在建立時選定 ontology version,**建立後不自動升級**
- v2 為 breaking change(刪除 entity_class、改 domain/range)時,`is_breaking=true`,aiStock UI 跳出警告

---

## 五、kag 多專案隔離

```mermaid
flowchart TB
    subgraph ProjectA["Project A: aistock (台股)"]
        A1[ontology: stock-investment-tw/v3]
        A2[ontology: bond-investment-tw/v1]
        A3[kb: 2330-research<br/>pin: v3]
        A4[kb: etf-db<br/>pin: v3]
    end

    subgraph ProjectB["Project B: future-acme (美股)"]
        B1[ontology: us-stock-research/v1]
        B2[kb: aapl-tracker<br/>pin: v1]
    end

    subgraph ProjectC["Project C: future-zootopia (加密貨幣)"]
        C1[ontology: crypto-market/v2]
    end

    subgraph KagCache["kag_cached_ontologies"]
        K1["_key: aistock:stock-investment-tw/v3<br/>payload: 7 entities"]
        K2["_key: aistock:bond-investment-tw/v1"]
        K3["_key: future-acme:us-stock-research/v1"]
        K4["_key: future-zootopia:crypto-market/v2"]
    end

    A1 -.->|sync| K1
    A2 -.->|sync| K2
    B1 -.->|sync| K3
    C1 -.->|sync| K4

    A3 -.->|lookup aistock| K1
    A4 -.->|lookup aistock| K1
    B2 -.->|lookup future-acme| K3

    classDef projA fill:#1e3a8a,stroke:#3b82f6,color:#fff
    classDef projB fill:#065f46,stroke:#10b981,color:#fff
    classDef projC fill:#7c2d12,stroke:#f97316,color:#fff
    classDef cache fill:#5b21b6,stroke:#a78bfa,color:#fff
    class A1,A2,A3,A4 projA
    class B1,B2 projB
    class C1 projC
    class K1,K2,K3,K4 cache
```

**隔離機制**:
- `_key = {project_id}:{ontology_key}/v{version}` — 用 project_id 當前綴,DB 層級就分開
- KB 也有 `project_id`,graph extraction 時帶 `project_id` 查 ontology cache,查不到就 404
- 跨 project 存取:HTTP 層拒絕(只有 admin token 才能跨 project 操作 ontology 模板)

---

## 六、確認清單

請逐項 confirm 或修正:

| # | 項目 | 預設 |
|---|---|---|
| Q1 | aiStock 是 ontology 擁有者,kag 是 cache consumer | 確認 |
| Q2 | aiStock 推 ontology 到 kag 的 endpoint:`POST /api/v1/ontologies/sync` | 確認 |
| Q3 | kag 的 ontology API 只剩 sync + get(CRUD 全在 aiStock)| 確認 |
| Q4 | kag cache 用 `_key = project_id:key/vN` 形式,按 project 隔離 | 確認 |
| Q5 | aiStock 用 admin token 推 ontology,kag 信任來自 aiStock 的請求 | 確認 |
| Q6 | aiStock 新增 3 collection: `ontology`, `ontology_version`, `ontology_chat` | 確認 |
| Q7 | ontology 對話持久化在 aiStock(不在 kag)| 確認 |
| Q8 | AI 討論 prompt、NER/RE prompt template 由 aiStock 端 LLM 呼叫生成,產物存 aiStock | 確認 |
| Q9 | kag graph extraction 從 cache 載入 ontology,不需要 aiStock 介入 | 確認 |
| Q10 | KB 建立時 `ontology_key + version` 鎖定,KB 生命週期內不自動升級 ontology | 確認 |
| Q11 | KB 升級 ontology 是 aistock 的後台作業(呼叫 kag 的新 API,例如 `POST /api/v1/knowledge-bases/{kb}/rebind-ontology`),不是 ontology sync | 待確認 |
| Q12 | aistock ↔ kag 之間的通訊認證:aiStock 用 `KAG_ADMIN_TOKEN`(管理 ontology 推送),用 per-KB `X-KAG-API-Key`(呼叫 RAG)| 確認 |

---

## 七、確認後的下一步

1. 你逐項 confirm Q1-Q12(可寫 "Q1-Q12 全 OK")
2. 我把 `stock-investment-tw-v1.json` 寫到 `/home/daniel/github/aistock/.docs/ontology/stock-investment-tw-v1.json`
3. 寫對應的人類可讀說明書:`stock-investment-tw-v1.README.md`(含 NER/RE prompt template 範例、use cases)
4. 更新 kag 那邊的 `docs/API.md` 與 `docs/DATA_MODEL.md`,把 ontology 章節對齊到「aiStock-owned, kag-cached」模型

要我等你逐項確認後再做,還是你直接回 "OK 全做" 我就一氣呵成?
