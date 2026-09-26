// 套牌集（localStorage 里的自定义套牌）与详情页之间的桥接
//
// App 端的逻辑关系：
//   · 套牌集列表点一行 → 直接进 DeckDetailActivity 看牌表（只读）
//   · 编辑 / 删除等在列表项的「管理」入口里
//   · 服务器套牌要在详情页点收藏，才会进套牌集
// 网页端以前不一致：套牌集的卡片完全点不开，详情页的「存入套牌集」也只是跳编辑器。
// 这里把「本地 ⇄ 服务器」两套数据结构的互转与保存逻辑集中管理。

import type { ServerDeck, ServerDeckCard } from '../api/types'
import { deckTotals, loadDecks, newDeckId, saveDecks, type CustomDeck } from './storage'

export const LOCAL_PREFIX = 'local://deck/'

export function localDeckId(uuid: string): string {
  return LOCAL_PREFIX + uuid
}

export function isLocalDeckId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('local://')
}

/** local://deck/<uuid> → <uuid> */
export function uuidOfLocalDeck(id: string): string {
  return id.startsWith(LOCAL_PREFIX) ? id.slice(LOCAL_PREFIX.length) : id
}

/** 详情页路由。用 local/:uuid 而不是把 local:// 塞进 path，避免斜杠编码带来的坑 */
export function detailPathOf(deckId: string): string {
  return `/deck/local/${encodeURIComponent(uuidOfLocalDeck(deckId))}`
}

export function editorPathOf(deckId: string): string {
  return `/custom/${encodeURIComponent(deckId)}`
}

export function findLocalDeck(deckId: string): CustomDeck | null {
  if (!isLocalDeckId(deckId)) return null
  return loadDecks().find((d) => d.id === deckId) ?? null
}

const toCard = (name: string, quantity: number): ServerDeckCard => ({
  quantity,
  name,
  card_id: null,
  name_zh: null,
  image_url: null,
})

/** 自定义套牌 → 详情页所需的 ServerDeck 形状（缺失字段用空值填充） */
export function customDeckToServerDeck(d: CustomDeck): ServerDeck {
  const t = deckTotals(d.cards)
  return {
    id: d.id,
    source: 'local',
    source_url: '',
    event_id: '',
    event_name: '',
    event_date: '',
    format_code: d.format ?? '',
    format: d.format ?? '',
    deck_name: d.name || '未命名套牌',
    player: d.player ?? '',
    place: '',
    mainboard_count: t.main,
    sideboard_count: t.side,
    mainboard: d.cards.filter((c) => !c.sideboard).map((c) => toCard(c.name, c.quantity)),
    sideboard: d.cards.filter((c) => c.sideboard).map((c) => toCard(c.name, c.quantity)),
    commanders: [],
    commander_count: null,
    similar_group_id: null,
    similar_deck_count: 0,
    representative_card: null,
    representative_card_complete: null,
    event_deck_count: null,
    colors: null,
    colors_complete: null,
  }
}

/** 服务器套牌 → 本地套牌记录 */
export function serverDeckToCustomDeck(deck: ServerDeck): CustomDeck {
  const now = Date.now()
  return {
    id: newDeckId(),
    name: deck.deck_name || '未命名套牌',
    player: deck.player || undefined,
    format: deck.format || deck.format_code || undefined,
    cards: [
      ...(deck.commanders ?? []).map((c) => ({ name: c.name, quantity: c.quantity, sideboard: false })),
      ...(deck.mainboard ?? []).map((c) => ({ name: c.name, quantity: c.quantity, sideboard: false })),
      ...(deck.sideboard ?? []).map((c) => ({ name: c.name, quantity: c.quantity, sideboard: true })),
    ],
    representative: deck.representative_card?.name ?? undefined,
    // 记录来源，避免同一副服务器套牌反复保存出副本
    sourceDeckId: deck.id,
    createdAt: now,
    updatedAt: now,
  }
}

export interface SaveOutcome {
  outcome: 'saved' | 'duplicate'
  id: string
  name: string
}

/** 把一副服务器套牌写进套牌集；若已存过则返回 duplicate */
export function saveServerDeck(deck: ServerDeck): SaveOutcome {
  const decks = loadDecks()
  const existing = decks.find((d) => d.sourceDeckId === deck.id)
  if (existing) return { outcome: 'duplicate', id: existing.id, name: existing.name }
  const record = serverDeckToCustomDeck(deck)
  saveDecks([...decks, record])
  return { outcome: 'saved', id: record.id, name: record.name }
}

/** 已经存进套牌集的服务器套牌 id 集合 */
export function savedServerDeckIds(): Set<string> {
  return new Set(
    loadDecks()
      .map((d) => d.sourceDeckId)
      .filter((v): v is string => !!v),
  )
}
