// 严格导入：无法识别的行直接报错，绝不静默丢弃卡牌
// 规则与 Android 端 ui/collection/DeckImport.kt 保持一致

export interface ImportedCard {
  name: string
  quantity: number
  sideboard: boolean
}

export interface ImportedDeck {
  cards: ImportedCard[]
  name?: string
  player?: string
  format?: string
}

const MAX_CHARS = 200_000
const MAX_LINES = 1000

// 分节行允许带张数，因为 deckToText 与自己导出的牌表会长成「主牌 60 / 备牌 15」
const RE_SIDEBOARD = /^(?:sideboard|side board|备牌)\s*[:：]?(?:\s*[（(]\d+[)）])?(?:\s+\d+)?$/i
const RE_MAINBOARD = /^(?:deck|maindeck|mainboard|main deck|主牌|套牌)\s*[:：]?(?:\s*[（(]\d+[)）])?(?:\s+\d+)?$/i
const RE_NAME = /^(?:套牌名称|name|deck name)\s*[:：]\s*(.*)$/i
const RE_PLAYER = /^(?:玩家|使用人|player)\s*[:：]\s*(.*)$/i
const RE_FORMAT = /^(?:赛制|format)\s*[:：]\s*(.*)$/i
const RE_CARD = /^(?:SB:\s*)?(\d+)\s*[x×]?\s+(.+)$/i
const RE_ARENA_SUFFIX = /\s+\([A-Za-z0-9]+\)\s+\d+[A-Za-z]?$/

/** 归一化牌名：连体牌的三种写法统一为 " // " */
export function normalizeCardName(raw: string): string {
  return raw
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s*\|\|\s*/g, ' // ')
    .replace(/\s*\/\s*\/\s*/g, ' // ')
    .replace(/\s{2,}/g, ' ')
}

/** 用于同名合并/匹配的键 */
export function matchingKey(name: string): string {
  return normalizeCardName(name)
    .toLowerCase()
    // 兼容重音字符（Lórien / Lorien）
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // 弯撇号与不同横线
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
}

function checked(name: string, quantity: number | null, side: boolean, lineHint?: string): ImportedCard {
  if (quantity === null || !Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
    throw new Error(`单卡数量必须为 1–999${lineHint ? `（${lineHint}）` : ''}`)
  }
  const clean = normalizeCardName(name)
  if (!clean || clean.length > 200) throw new Error('牌名为空或过长')
  return { name: clean, quantity: Math.floor(quantity), sideboard: side }
}

function merge(cards: ImportedCard[]): ImportedCard[] {
  if (cards.length === 0) throw new Error('牌表为空')
  if (cards.length > MAX_LINES) throw new Error(`牌表需包含 1–${MAX_LINES} 行单卡`)
  const map = new Map<string, ImportedCard>()
  for (const c of cards) {
    const key = `${c.sideboard ? 's' : 'm'}:${matchingKey(c.name)}`
    const prev = map.get(key)
    if (prev) prev.quantity += c.quantity
    else map.set(key, { ...c })
  }
  return [...map.values()]
}

function afterColon(line: string): string {
  const idx = line.search(/[:：]/)
  return idx >= 0 ? line.slice(idx + 1).trim() : ''
}

export function parseDeckText(input: string): ImportedDeck {
  if (input.length > MAX_CHARS) throw new Error('牌表过大，请导入 200 KB 以内的文本')
  const text = input.trim().replace(/^﻿/, '')
  if (!text) throw new Error('牌表为空')
  if (text.startsWith('{')) return parseJson(text)
  if (text.startsWith('<')) throw new Error('请导出为包含牌名的文本牌表（TXT / DEK），再导入')

  let side = false
  let name: string | undefined
  let player: string | undefined
  let format: string | undefined
  const cards: ImportedCard[] = []

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    const hint = `第 ${index + 1} 行`
    if (!line || line.startsWith('#') || line.startsWith('//') || /^[=\-]+$/.test(line)) return
    if (RE_SIDEBOARD.test(line)) {
      side = true
      return
    }
    if (RE_MAINBOARD.test(line)) {
      side = false
      return
    }
    if (RE_NAME.test(line)) {
      name = afterColon(line) || name
      return
    }
    if (RE_PLAYER.test(line)) {
      player = afterColon(line) || player
      return
    }
    if (RE_FORMAT.test(line)) {
      format = afterColon(line) || format
      return
    }
    if (line.startsWith('战绩：')) return

    const m = RE_CARD.exec(line)
    if (!m) throw new Error(`${hint}无法识别，请使用“数量 牌名”`)
    const cardName = m[2].replace(RE_ARENA_SUFFIX, '')
    const isSb = side || /^SB:/i.test(line)
    cards.push(checked(cardName, parseInt(m[1], 10), isSb, hint))
  })

  return { cards: merge(cards), name, player, format }
}

function parseJson(text: string): ImportedDeck {
  let root: Record<string, unknown>
  try {
    root = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('JSON 牌表格式不正确')
  }
  const cards: ImportedCard[] = []
  const groups: [string, boolean][] = [
    ['mainDeck', false],
    ['mainboard', false],
    ['sideboard', true],
  ]
  for (const [key, side] of groups) {
    const arr = root[key]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (!item || typeof item !== 'object') throw new Error('JSON 单卡格式不正确')
      const obj = item as Record<string, unknown>
      const n = obj.name ?? obj.card_name
      if (typeof n !== 'string' || !n.trim()) {
        throw new Error('JSON 单卡需要 name 或 card_name 牌名，不能仅包含 ID')
      }
      const q = typeof obj.quantity === 'string' ? parseInt(obj.quantity, 10) : (obj.quantity as number)
      cards.push(checked(n, typeof q === 'number' ? q : null, side))
    }
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { cards: merge(cards), name: str(root.name), player: str(root.player), format: str(root.format) }
}

/** 导出为 "数量 牌名" 文本 */
export function deckToText(deck: ImportedDeck): string {
  const main = deck.cards.filter((c) => !c.sideboard)
  const side = deck.cards.filter((c) => c.sideboard)
  const lines: string[] = []
  if (deck.name) lines.push(`套牌名称：${deck.name}`)
  if (deck.player) lines.push(`玩家：${deck.player}`)
  if (deck.format) lines.push(`赛制：${deck.format}`)
  if (lines.length) lines.push('')
  lines.push(`主牌 ${main.reduce((s, c) => s + c.quantity, 0)}`)
  lines.push(...main.map((c) => `${c.quantity} ${c.name}`))
  if (side.length) {
    lines.push('')
    lines.push(`备牌 ${side.reduce((s, c) => s + c.quantity, 0)}`)
    lines.push(...side.map((c) => `${c.quantity} ${c.name}`))
  }
  return lines.join('\n')
}
