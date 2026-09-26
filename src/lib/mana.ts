// 法术力符号渲染：直接复用 Scryfall 的官方 SVG（与 Android 端 mana_*.xml 同源）
// 来源 https://svgs.scryfall.io/card-symbols/ ，图形版权归 Wizards of the Coast

const SYMBOL_BASE = 'https://svgs.scryfall.io/card-symbols'

/** "{2/B}" -> "2B.svg"；"{B/P}" -> "BP.svg"；"{W}" -> "W.svg" */
export function symbolFile(token: string): string {
  return token.replace(/\//g, '').toUpperCase()
}

export function symbolUrl(token: string): string {
  return `${SYMBOL_BASE}/${symbolFile(token)}.svg`
}

export type ManaToken = { type: 'symbol'; token: string; url: string } | { type: 'text'; text: string }

/**
 * 解析法术力费用串为 token 序列。
 * 保留原始字符串，仅把花括号内的符号替换为图片；未知符号原样保留（对齐 Android 端行为）。
 */
export function parseManaCost(manaCost: string | null | undefined): ManaToken[] {
  if (!manaCost) return []
  const out: ManaToken[] = []
  const re = /\{([^}]+)\}|([^{]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(manaCost)) !== null) {
    if (m[1] !== undefined) {
      out.push({ type: 'symbol', token: m[1], url: symbolUrl(m[1]) })
    } else if (m[2]) {
      out.push({ type: 'text', text: m[2] })
    }
  }
  return out
}

/** 粗略估算法术力值（无元数据时的排序回退） */
export function estimateManaValue(manaCost: string | null | undefined): number | null {
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
    if (/^[XYZ]$/i.test(t)) {
      found = true // X 记为 0
    }
  }
  return found ? total : null
}
