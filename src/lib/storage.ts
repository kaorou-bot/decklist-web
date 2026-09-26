import type { ImportedCard } from './deckImport'
import type { VersionMap } from './deckVersion'

export interface CustomDeck {
  id: string // local://deck/<uuid>
  name: string
  player?: string
  format?: string
  cards: ImportedCard[]
  /** 每张卡选中的印刷版本，key = versionKey(卡名, 是否备牌) */
  versions?: VersionMap
  representative?: string // 代表单卡名（用于封面）
  /** 来自哪副服务器套牌（赛事套牌存入套牌集时记录，用于去重） */
  sourceDeckId?: string
  createdAt: number
  updatedAt: number
}

const KEY = 'decklist-web/custom-decks/v1'

export function loadDecks(): CustomDeck[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CustomDeck[]) : []
  } catch {
    return []
  }
}

export function saveDecks(decks: CustomDeck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks))
  } catch {
    // 配额超限时静默失败，避免打断编辑
  }
}

export function newDeckId(): string {
  return `local://deck/${crypto.randomUUID()}`
}

export function deckTotals(cards: ImportedCard[]) {
  const main = cards.filter((c) => !c.sideboard).reduce((s, c) => s + c.quantity, 0)
  const side = cards.filter((c) => c.sideboard).reduce((s, c) => s + c.quantity, 0)
  return { main, side, total: main + side }
}
