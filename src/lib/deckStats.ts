// 套牌统计：法术力曲线 / 颜色分布 / 类别分布
// 与 Android 端 ui/analysis/DeckAnalysisViewModel 的口径保持一致

export interface StatCard {
  name: string
  quantity: number
  sideboard: boolean
  manaCost?: string | null
  manaValue?: number | null
  typeLine?: string | null
  typeLineZh?: string | null
  colors?: string[] | null
}

export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export const MANA_COLOR_LABEL: Record<string, string> = {
  W: '白',
  U: '蓝',
  B: '黑',
  R: '红',
  G: '绿',
}

/** 中文type_line 形如「传奇生物～天使」；英文形如「Legendary Creature - Angel」 */
const TYPE_RULES: { key: string; en: string; zh: string }[] = [
  { key: 'creature', en: 'creature', zh: '生物' },
  { key: 'planeswalker', en: 'planeswalker', zh: '鹏洛客' },
  { key: 'battle', en: 'battle', zh: '战役' },
  { key: 'enchantment', en: 'enchantment', zh: '结界' },
  { key: 'artifact', en: 'artifact', zh: '神器' },
  { key: 'instant', en: 'instant', zh: '瞬间' },
  { key: 'sorcery', en: 'sorcery', zh: '法术' },
  { key: 'land', en: 'land', zh: '地' },
]

/** 按主类别归类；多类别卡（如神器生物）会同时计入各自类别 */
export function classifyType(card: StatCard): string | null {
  const line = (card.typeLineZh || card.typeLine || '').toLowerCase()
  if (!line) return null
  for (const r of TYPE_RULES) {
    if (line.includes(r.en) || line.includes(r.zh)) return r.key
  }
  return null
}

export const TYPE_LABEL: Record<string, string> = {
  creature: '生物',
  planeswalker: '鹏洛客',
  battle: '战役',
  enchantment: '结界',
  artifact: '神器',
  instant: '瞬间',
  sorcery: '法术',
  land: '地',
}

/** 从费用串里取出颜色符号（含混色 {2/W}；纯数字记为无色不参与） */
function costColors(manaCost: string | null | undefined): string[] {
  if (!manaCost) return []
  const out = new Set<string>()
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const ch of m[1].toUpperCase()) {
      if (MANA_COLORS.includes(ch as (typeof MANA_COLORS)[number])) out.add(ch)
    }
  }
  return [...out]
}

export interface DeckStats {
  totalCards: number
  uniqueCards: number
  curve: { bucket: number; label: string; count: number }[]
  curveMax: number
  colorCount: { code: string; label: string; count: number }[]
  typeCount: { key: string; label: string; count: number }[]
  avgManaValue: number | null
  landCount: number
  creatureCount: number
  unknownCount: number
}

export function computeStats(cards: StatCard[], includeSideboard = false): DeckStats {
  const rows = includeSideboard ? cards : cards.filter((c) => !c.sideboard)
  const buckets = new Map<number, number>()
  for (let i = 0; i <= 7; i++) buckets.set(i, 0)
  const colors = new Map<string, number>()
  for (const c of MANA_COLORS) colors.set(c, 0)
  const types = new Map<string, number>()

  let quantitySum = 0
  let mvSum = 0
  let mvKnown = 0
  let landCount = 0
  let creatureCount = 0
  let unknown = 0

  for (const c of rows) {
    const mv = c.manaValue ?? manaValueFromCost(c.manaCost)
    if (mv == null) unknown += c.quantity
    else {
      const b = Math.min(Math.max(Math.round(mv), 0), 7)
      buckets.set(b, (buckets.get(b) ?? 0) + c.quantity)
      quantitySum += c.quantity
      mvSum += mv * c.quantity
      mvKnown += c.quantity
    }
    const palette = c.colors ?? costColors(c.manaCost)
    for (const col of palette) {
      const upper = col.toUpperCase()
      if (colors.has(upper)) colors.set(upper, (colors.get(upper) ?? 0) + c.quantity)
    }
    const key = classifyType(c)
    if (key) {
      types.set(key, (types.get(key) ?? 0) + c.quantity)
      if (key === 'land') landCount += c.quantity
      if (key === 'creature') creatureCount += c.quantity
    }
  }

  const curve = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({
      bucket,
      label: bucket === 7 ? '7+' : String(bucket),
      count,
    }))

  return {
    totalCards: rows.reduce((s, c) => s + c.quantity, 0),
    uniqueCards: rows.length,
    curve,
    curveMax: Math.max(1, ...curve.map((c) => c.count)),
    colorCount: MANA_COLORS.map((code) => ({ code, label: MANA_COLOR_LABEL[code], count: colors.get(code) ?? 0 })),
    typeCount: TYPE_RULES.map((r) => ({ key: r.key, label: TYPE_LABEL[r.key], count: types.get(r.key) ?? 0 })).filter(
      (t) => t.count > 0,
    ),
    avgManaValue: mvKnown > 0 ? mvSum / mvKnown : null,
    landCount,
    creatureCount,
    unknownCount: unknown,
  }
}

function manaValueFromCost(manaCost?: string | null): number | null {
  if (!manaCost) return null
  let total = 0
  let found = false
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const t = m[1]
    const hybrid = t.match(/^(\d+)\/([WUBRGC])$/i)
    if (hybrid) {
      total += parseInt(hybrid[1], 10)
      found = true
      continue
    }
    if (/^\d+$/.test(t)) {
      total += parseInt(t, 10)
      found = true
      continue
    }
    if (/^[WUBRGC]$/i.test(t) || /^[WUBRGC]\/P$/i.test(t)) {
      total += 1
      found = true
      continue
    }
    if (/^[XYZ]$/i.test(t)) found = true
  }
  return found ? total : null
}
