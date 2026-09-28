// 文字牌表导出
//
// 分享图适合发群里，但很多场景要的是纯文本：贴进 MTGO / Moxfield / 微信群、发邮件、
// 或者自己再贴回本 App 的导入框。所以牌表必须能原样导出成「数量 牌名」的文本，
// 而且导出的格式要能被 parseDeckText 直接吃回去（闭环）。
//
// 牌名有中英两套：详情页从服务器拿到的是「英文 name + 中文 name_zh」，
// 本机套牌存的是中文名 + 可选的英文原名 nameEn。这里统一成一张卡两个名字，
// 导出时按用户选的语言挑一个。

import { deckToText, type ImportedCard } from './deckImport'

export interface DeckTextCard {
  /** 中文牌名（没有中文名时就是原名） */
  name: string
  /** 英文原名，导出英文牌表时用 */
  nameEn?: string | null
  quantity: number
  sideboard: boolean
}

export interface DeckTextSource {
  name?: string | null
  player?: string | null
  format?: string | null
  cards: DeckTextCard[]
}

export type DeckTextLang = 'zh' | 'en'

export function deckTextName(c: DeckTextCard, lang: DeckTextLang): string {
  const zh = (c.name ?? '').trim()
  const en = (c.nameEn ?? '').trim()
  return lang === 'en' ? en || zh : zh || en
}

/** 生成牌表文本。指挥官并入主牌（导入时也按主牌处理，保证张数对得上） */
export function buildDeckText(deck: DeckTextSource, lang: DeckTextLang = 'zh'): string {
  const cards: ImportedCard[] = deck.cards
    .filter((c) => c.quantity > 0)
    .map((c) => ({
      name: deckTextName(c, lang),
      quantity: c.quantity,
      sideboard: c.sideboard,
      nameEn: c.nameEn ?? undefined,
    }))
    .filter((c) => !!c.name)
  return deckToText({
    name: deck.name?.trim() || undefined,
    player: deck.player?.trim() || undefined,
    format: deck.format?.trim() || undefined,
    cards,
  })
}
