// Mock data for stock-investment-tw-v0.1 ontology
// Mirrors /home/daniel/github/aistock/.docs/ontology/stock-investment-tw-v0.1.json
// Will be replaced by real API calls when kag is online.

export type EntityClassPropertyType = 'string' | 'number' | 'date' | 'enum' | 'boolean' | 'array'

export interface EntityClassProperty {
  name: string
  type: EntityClassPropertyType
  description: string
  values?: string[]
  example?: string
}

export interface EntityClass {
  name: string
  description: string
  examples: string[]
  properties: EntityClassProperty[]
  color: string
}

export interface ObjectProperty {
  name: string
  description: string
  domain: string
  range: string
  examples: string[]
}

export interface OntologyEvolutionEvent {
  id: string
  event_type: 'created' | 'added' | 'modified' | 'removed' | 'rejected' | 'discussed'
  target_type: 'ontology' | 'entity_class' | 'object_property' | 'use_case'
  target_name: string
  reason: string
  context?: {
    source_type?: 'user_request' | 'ai_discussion' | 'extraction_failure' | 'data_source_added'
    trigger_question?: string
    user_story?: string
  }
  created_by: string
  created_at: string
}

export interface Ontology {
  name: string
  display_name: string
  version: string
  status: 'draft' | 'active' | 'deprecated'
  description: string
  tags: string[]
  use_cases: string[]
  entity_classes: EntityClass[]
  object_properties: ObjectProperty[]
  evolution: OntologyEvolutionEvent[]
  updated_at: string
}

const NOW = '2026-07-08T14:32:00Z'

const stockInvestmentTw: Ontology = {
  name: 'stock-investment-tw',
  display_name: '股票投資本體（台股）',
  version: '0.1',
  status: 'draft',
  description:
    '台股投資本體 v0.1（最小可用版本）：涵蓋個股辨識、所屬產業、即時新聞、財務數字 4 個 entity，足以回答「這家公司最近怎麼樣？」「它在哪個產業？」「EPS 多少？」等散戶基本查詢。',
  tags: ['tw-stock', 'retail', 'minimal-viable'],
  use_cases: [
    '個股辨識：「台積電是 2330 對嗎？」',
    '產業歸屬：「台積電屬於哪個產業？同產業還有哪些公司？」',
    '新聞追蹤：「聯發科最近有什麼重要消息？」',
    '財務查詢：「台積電 2026 Q2 EPS 多少？」',
    '跨 entity 查詢：「台積電 Q2 法說會提到哪些重點？」',
  ],
  updated_at: NOW,
  entity_classes: [
    {
      name: 'Company',
      description: '在台灣證券交易所 (TWSE) 或證券櫃買中心 (TPEx) 掛牌的公司',
      examples: ['台積電', 'TSMC', '2330', 'TWSE:2330', '聯發科', '2454', '鴻海', '2317'],
      color: '#3b82f6',
      properties: [
        { name: 'stock_code', type: 'string', description: '台股代碼，如 2330', example: '2330' },
        { name: 'name_zh', type: 'string', description: '中文公司簡稱', example: '台積電' },
        { name: 'name_en', type: 'string', description: '英文公司簡稱', example: 'TSMC' },
        {
          name: 'market',
          type: 'enum',
          description: '掛牌市場',
          values: ['TWSE', 'TPEx'],
          example: 'TWSE',
        },
      ],
    },
    {
      name: 'Industry',
      description: 'TWSE/TPEx 行業分類',
      examples: ['半導體業', '金融保險', '電機機械', '23', 'M2320'],
      color: '#10b981',
      properties: [
        { name: 'code', type: 'string', description: 'TWSE/TPEx 行業代碼', example: '23' },
        { name: 'name', type: 'string', description: '行業中文名稱', example: '半導體業' },
      ],
    },
    {
      name: 'NewsEvent',
      description: '與公司、產業或市場相關的時效性事件',
      examples: [
        '台積電 7 月法說會聚焦 3 奈米',
        '聯發科宣布併購 Intel 旗下部門',
        '央行升息半碼',
      ],
      color: '#ef4444',
      properties: [
        { name: 'date', type: 'date', description: '事件日期', example: '2026-07-08' },
        { name: 'title', type: 'string', description: '事件標題', example: '台積電 7 月法說會' },
        {
          name: 'category',
          type: 'enum',
          description: '事件類別',
          values: ['earnings', 'merger', 'regulatory', 'product', 'executive', 'market'],
          example: 'earnings',
        },
        { name: 'source', type: 'string', description: '消息來源', example: '工商時報' },
      ],
    },
    {
      name: 'FinancialItem',
      description: '公司財務報表項目（合併 / 個體、月 / 季 / 年）',
      examples: ['2025 Q3 EPS 7.8 元', '聯發科 2024 全年合併營收 4,500 億元', '台積電 2025 Q3 毛利率 53%'],
      color: '#f59e0b',
      properties: [
        { name: 'metric', type: 'string', description: '財務指標名稱', example: 'EPS' },
        { name: 'value', type: 'number', description: '數值', example: '7.8' },
        { name: 'unit', type: 'string', description: '單位', example: '元' },
        { name: 'period', type: 'string', description: '報告期', example: '2025Q3' },
        {
          name: 'period_type',
          type: 'enum',
          description: '週期類型',
          values: ['monthly', 'quarterly', 'yearly'],
          example: 'quarterly',
        },
      ],
    },
  ],
  object_properties: [
    {
      name: 'operates_in',
      description: '公司所屬產業',
      domain: 'Company',
      range: 'Industry',
      examples: ['台積電屬於半導體業', '聯發科 2454 為 IC 設計業'],
    },
    {
      name: 'mentions',
      description: '新聞 / 重大訊息 / 法說會提到某公司',
      domain: 'NewsEvent',
      range: 'Company',
      examples: ['台積電 7 月法說會聚焦 3 奈米', '聯發科宣布併購 Intel 旗下部門'],
    },
    {
      name: 'reported_in',
      description: '財務數據所屬公司',
      domain: 'FinancialItem',
      range: 'Company',
      examples: ['台積電 Q3 EPS 7.8 元', '聯發科 2024 全年營收 4,500 億'],
    },
  ],
  evolution: [
    {
      id: 'ev_001',
      event_type: 'created',
      target_type: 'ontology',
      target_name: 'stock-investment-tw',
      reason: 'Initial minimal-viable version based on PM 的 4 大類高頻查詢',
      context: {
        source_type: 'user_request',
        user_story: 'Build a stock investment ontology for Taiwan retail investors',
      },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:32:00Z',
    },
    {
      id: 'ev_002',
      event_type: 'added',
      target_type: 'entity_class',
      target_name: 'Company',
      reason: '個股辨識是散戶最基本查詢',
      context: { source_type: 'user_request', trigger_question: '台積電是 2330 對嗎？' },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:33:00Z',
    },
    {
      id: 'ev_003',
      event_type: 'added',
      target_type: 'entity_class',
      target_name: 'Industry',
      reason: '需要回答產業歸屬與同產業比較',
      context: { source_type: 'user_request', trigger_question: '台積電屬於哪個產業？' },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:35:00Z',
    },
    {
      id: 'ev_004',
      event_type: 'added',
      target_type: 'entity_class',
      target_name: 'NewsEvent',
      reason: '散戶最常問的「最近怎麼樣」屬於新聞類',
      context: { source_type: 'user_request', trigger_question: '聯發科最近有什麼重要消息？' },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:36:00Z',
    },
    {
      id: 'ev_005',
      event_type: 'added',
      target_type: 'entity_class',
      target_name: 'FinancialItem',
      reason: '財務數字是基本面分析必備',
      context: { source_type: 'user_request', trigger_question: '台積電 2026 Q2 EPS 多少？' },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:37:00Z',
    },
    {
      id: 'ev_006',
      event_type: 'added',
      target_type: 'object_property',
      target_name: 'operates_in',
      reason: '最常見的 entity 關係',
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:40:00Z',
    },
    {
      id: 'ev_007',
      event_type: 'rejected',
      target_type: 'entity_class',
      target_name: 'Person',
      reason: 'v0.1 故意排除，等真實觸發再加',
      context: {
        trigger_question: 'PM 問台積電董事長是誰？',
        user_story: '等實際使用後再加，避免 premature 設計',
      },
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:42:00Z',
    },
    {
      id: 'ev_008',
      event_type: 'discussed',
      target_type: 'use_case',
      target_name: '本益比多少？',
      reason: 'v0.1 沒 FinancialConcept 還回答不出來，記錄為「v0.2 待觸發」',
      created_by: 'daniel@dllm.ai',
      created_at: '2026-07-08T14:45:00Z',
    },
  ],
}

const allOntologies: Ontology[] = [stockInvestmentTw]

export function getAllOntologies(): Ontology[] {
  return allOntologies
}

export function getOntologyByKey(key: string): Ontology | undefined {
  return allOntologies.find((o) => o.name === key)
}
