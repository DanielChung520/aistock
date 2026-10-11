export type KnowledgeStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type FileType = 'pdf' | 'docx' | 'md' | 'txt' | 'html'

export interface KnowledgeChunk {
  id: string
  position: number
  text: string
  token_count: number
  page?: number
  source: 'text' | 'image_caption'
  image_caption?: string
}

export interface KnowledgeExtractedEntity {
  id: string
  type: 'Company' | 'Industry' | 'Person' | 'NewsEvent' | 'FinancialItem'
  canonical_name: string
  mention_in_doc: string
  page?: number
  bbox?: { x: number; y: number; w: number; h: number }
}

export interface KnowledgeRelation {
  source: string
  target: string
  rel_type: string
  page?: number
  confidence: number
}

export interface KnowledgeFigure {
  id: string
  page: number
  caption: string  // VL-generated caption
  bbox: { x: number; y: number; w: number; h: number }
  width: number
  height: number
}

export interface Knowledge {
  id: string
  title: string
  source_filename: string
  file_type: FileType
  size_bytes: number
  page_count?: number
  uploaded_at: string
  uploaded_by: string
  status: KnowledgeStatus
  ontology_key: string
  ontology_version: string
  project_id: string
  vector_status: 'pending' | 'indexed' | 'failed'
  graph_status: 'pending' | 'extracted' | 'failed'
  chunk_count: number
  entity_count: number
  relation_count: number
  figure_count: number
  preview_text: string
  tags: string[]
  chunks?: KnowledgeChunk[]
  entities?: KnowledgeExtractedEntity[]
  relations?: KnowledgeRelation[]
  figures?: KnowledgeFigure[]
}

const NOW = '2026-07-08T14:32:00Z'

const tsmcEarningsCall: Knowledge = {
  id: 'k_001',
  title: '台積電 2026 Q2 法說會逐字稿',
  source_filename: 'TSMC_2026Q2_Earnings_Call_Transcript.pdf',
  file_type: 'pdf',
  size_bytes: 2_847_392,
  page_count: 42,
  uploaded_at: '2026-07-08T12:14:00Z',
  uploaded_by: 'daniel@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 287,
  entity_count: 18,
  relation_count: 24,
  figure_count: 12,
  preview_text:
    '「我們預期 3 奈米良率將在年底前達到 65%，並於 2027 年進入大量生產階段。董事長魏哲家表示，AI 需求持續強勁...」',
  tags: ['earnings', 'TSMC', '法說會', '2026Q2'],
}

const mtkAcquisition: Knowledge = {
  id: 'k_002',
  title: '聯發科宣布收購 Intel 旗下電源管理晶片部門',
  source_filename: '2026-07-07_MTK_Acquisition_Intel_PMU.pdf',
  file_type: 'pdf',
  size_bytes: 1_523_104,
  page_count: 18,
  uploaded_at: '2026-07-07T16:42:00Z',
  uploaded_by: 'daniel@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 92,
  entity_count: 7,
  relation_count: 9,
  figure_count: 3,
  preview_text:
    '「聯發科 (2454) 今日宣布與 Intel 達成最終協議，將以 1.5 億美元收購其電源管理晶片（PMU）業務部門...」',
  tags: ['M&A', '聯發科', 'Intel', '半導體'],
}

const honHaiMonthlyRevenue: Knowledge = {
  id: 'k_003',
  title: '鴻海 2026 年 6 月合併營收報告',
  source_filename: 'HonHai_2026_06_Monthly_Revenue.docx',
  file_type: 'docx',
  size_bytes: 487_200,
  page_count: 6,
  uploaded_at: '2026-07-05T10:30:00Z',
  uploaded_by: 'analyst@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 38,
  entity_count: 5,
  relation_count: 4,
  figure_count: 4,
  preview_text:
    '「鴻海 (2317) 6 月合併營收為 4,823 億元，月增 8.2%，年增 15.6%，為同期歷史新高。累計上半年合併營收 25,142 億元...」',
  tags: ['monthly_revenue', '鴻海', '2026-06'],
}

const twsePolicyDoc: Knowledge = {
  id: 'k_004',
  title: '金管會 2026 年下半年證券市場政策白皮書',
  source_filename: 'FSC_2026H2_Policy_Whitepaper.pdf',
  file_type: 'pdf',
  size_bytes: 5_201_843,
  page_count: 87,
  uploaded_at: '2026-07-03T14:20:00Z',
  uploaded_by: 'pm@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 412,
  entity_count: 34,
  relation_count: 51,
  figure_count: 0,
  preview_text:
    '「為提升台灣證券市場國際競爭力，金管會將於 2026 年下半年推動多項新制，包括當沖降稅延長、ETF 多元化等措施...」',
  tags: ['policy', '金管會', '2026H2'],
}

const usMacroeconomicOutlook: Knowledge = {
  id: 'k_005',
  title: '美國聯準會 2026 年 6 月 FOMC 會議紀要',
  source_filename: 'FOMC_Meeting_Minutes_2026_06.md',
  file_type: 'md',
  size_bytes: 24_512,
  page_count: 18,
  uploaded_at: '2026-07-01T09:00:00Z',
  uploaded_by: 'analyst@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 87,
  entity_count: 12,
  relation_count: 8,
  figure_count: 0,
  preview_text:
    '「Participants noted that recent indicators suggest economic activity has continued to expand at a solid pace. Inflation has moved closer to the Committee\'s 2 percent objective...」',
  tags: ['macro', 'Fed', 'FOMC', '2026-06'],
}

const tsmc10K: Knowledge = {
  id: 'k_006',
  title: '台積電 2025 年年報',
  source_filename: 'TSMC_2025_Annual_Report.pdf',
  file_type: 'pdf',
  size_bytes: 18_482_009,
  page_count: 248,
  uploaded_at: '2026-06-28T11:15:00Z',
  uploaded_by: 'analyst@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 1823,
  entity_count: 156,
  relation_count: 287,
  figure_count: 67,
  preview_text:
    '「民國一一四年度營業收入淨額為新台幣 2 兆 8,901 億元，較前一年度成長 31.6%。稅後淨利為 1 兆 4,023 億元，每股盈餘為 49.85 元...」',
  tags: ['annual_report', 'TSMC', '2025'],
}

const aapl10Q: Knowledge = {
  id: 'k_007',
  title: 'Apple Inc. 10-Q Filing Q2 2026',
  source_filename: 'AAPL_10Q_Q2_2026.pdf',
  file_type: 'pdf',
  size_bytes: 3_127_482,
  page_count: 64,
  uploaded_at: '2026-06-25T15:00:00Z',
  uploaded_by: 'analyst@dllm.ai',
  status: 'ready',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'indexed',
  graph_status: 'extracted',
  chunk_count: 312,
  entity_count: 28,
  relation_count: 22,
  figure_count: 8,
  preview_text:
    '「Apple Inc. reported total revenue of $94.8 billion for the second quarter of 2026, up 6% year-over-year. Services revenue reached an all-time high of $28.7 billion...」',
  tags: ['10Q', 'AAPL', '2026Q2'],
}

const pendingUpload: Knowledge = {
  id: 'k_008',
  title: '台積電 2026 年 ESG 永續報告書',
  source_filename: 'TSMC_2026_ESG_Report.pdf',
  file_type: 'pdf',
  size_bytes: 8_421_009,
  page_count: 124,
  uploaded_at: '2026-07-08T13:55:00Z',
  uploaded_by: 'pm@dllm.ai',
  status: 'processing',
  ontology_key: 'stock-investment-tw',
  ontology_version: '0.1',
  project_id: 'aistock',
  vector_status: 'pending',
  graph_status: 'pending',
  chunk_count: 0,
  entity_count: 0,
  relation_count: 0,
  figure_count: 0,
  preview_text:
    '永續報告書內容摘要，處理中（向量抽取與圖譜建立尚未完成）...',
  tags: ['ESG', 'TSMC', '2026'],
}

export const allKnowledge: Knowledge[] = [
  tsmcEarningsCall,
  mtkAcquisition,
  honHaiMonthlyRevenue,
  twsePolicyDoc,
  usMacroeconomicOutlook,
  tsmc10K,
  aapl10Q,
  pendingUpload,
]

export function getAllKnowledge(): Knowledge[] {
  return allKnowledge
}

export function getKnowledgeById(id: string): Knowledge | undefined {
  return allKnowledge.find((k) => k.id === id)
}
