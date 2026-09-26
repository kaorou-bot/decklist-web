// 牌名中文化：保存套牌时把英文名换成中文名，原名留作查询兜底
import type { ImportedCard } from './deckImport'
import type { CardMeta } from './enrich'

/**
 * 有中文名就把牌名换成中文（原名存进 nameEn）。
 * 只在确实查到中文名时才改写，查不到的保持原样，避免把牌表改成查不到的名字。
 */
export function toChineseCards(
  cards: ImportedCard[],
  meta: Record<string, CardMeta>,
): ImportedCard[] {
  return cards.map((c) => {
    const zh = meta[c.name]?.nameZh?.trim()
    if (!zh || zh === c.name) return c
    return { ...c, name: zh, nameEn: c.name }
  })
}
