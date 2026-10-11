/**
 * Backfill `.docs/indicators/*.json` with `tags` and `llm_intent` fields.
 *
 * - tags: derived from category synonyms + signals[].pattern + combines_with; only
 *   fills when the field is missing (does NOT overwrite hand-curated values).
 * - llm_intent: derived from category → intent template; only fills when missing.
 *
 * Run: npx tsx scripts/backfill-indicator-tags.ts
 */
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const KB_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '.docs', 'indicators',
)

// category → 標籤同義詞 + LLM 意圖模板
const CATEGORY_META: Record<string, { tags: string[]; intent: string }> = {
  trend: {
    tags: ['趨勢'],
    intent: '判斷價格趨勢方向與強度，作為順勢交易或多空分界的依據',
  },
  momentum: {
    tags: ['動能'],
    intent: '衡量價格變動的動能與速度，用於尋找超買超賣或動能持續性',
  },
  volatility: {
    tags: ['波動'],
    intent: '衡量價格波動幅度與風險，用於停損設定與波動率判斷',
  },
  volume: {
    tags: ['量能'],
    intent: '分析成交量能變化，驗證價格走勢的可靠性與量價關係',
  },
  pattern: {
    tags: ['型態'],
    intent: '辨識價格型態與突破訊號，作為進出場的結構性依據',
  },
  statistical: {
    tags: ['統計'],
    intent: '以統計方法計算價格的相對位置與分布，供均值回歸或偏離判斷',
  },
}

function deriveTags(doc: Record<string, unknown>): string[] {
  const meta = CATEGORY_META[(doc.category as string) ?? ''] ?? { tags: [] }
  const tags = new Set<string>(meta.tags)

  const signals = (doc.signals as Array<{ pattern?: string }> | undefined) ?? []
  for (const s of signals) {
    if (s.pattern) tags.add(s.pattern)
  }

  const combines = (doc.combines_with as string[] | undefined) ?? []
  for (const c of combines) tags.add(c)

  return [...tags].slice(0, 8)
}

function deriveIntent(doc: Record<string, unknown>): string {
  const meta = CATEGORY_META[(doc.category as string) ?? '']
  const name = (doc.name as string) ?? (doc.metric as string)
  if (meta) return `${meta.intent}（${name}）`
  return `${name}：依其公式與訊號作為選股或分析依據`
}

async function main() {
  const entries = await fs.readdir(KB_DIR)
  const files = entries.filter((f) => f.endsWith('.json'))

  let updated = 0
  for (const file of files) {
    const filePath = path.join(KB_DIR, file)
    const raw = await fs.readFile(filePath, 'utf-8')
    const doc = JSON.parse(raw) as Record<string, unknown>

    let changed = false
    if (!Array.isArray(doc.tags)) {
      doc.tags = deriveTags(doc)
      changed = true
    }
    if (typeof doc.llm_intent !== 'string' || doc.llm_intent.trim() === '') {
      doc.llm_intent = deriveIntent(doc)
      changed = true
    }

    if (changed) {
      await fs.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8')
      console.log(`  ~ ${file}: tags=${JSON.stringify(doc.tags)}`)
      updated++
    }
  }
  console.log(`Done. Updated ${updated} / ${files.length} files.`)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
