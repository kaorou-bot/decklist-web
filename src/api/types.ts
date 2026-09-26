// 与 Android 端 ForgeDeckApi.kt 的 DTO 一一对应

export interface ServerDeckCard {
  quantity: number
  name: string
  card_id: string | null
  name_zh: string | null
  image_url: string | null
}

export interface ServerRepresentativeCard {
  card_id: string | null
  name: string
  name_zh: string | null
  mana_value: number | null
  mana_cost: string | null
  type_line: string | null
  type_line_zh: string | null
  image_url: string | null
}

export interface ServerDeck {
  id: string
  source: string
  source_url: string
  event_id: string
  event_name: string
  event_date: string
  format_code: string
  format: string
  deck_name: string
  player: string
  place: string
  mainboard_count: number
  sideboard_count: number
  mainboard: ServerDeckCard[]
  sideboard: ServerDeckCard[]
  commanders?: ServerDeckCard[]
  commander_count?: number | null
  similar_group_id: string | null
  similar_deck_count: number
  representative_card: ServerRepresentativeCard | null
  representative_card_complete: boolean | null
  event_deck_count: number | null
  colors: string[] | null
  colors_complete: boolean | null
}

export interface ServerDeckPage {
  page: number
  total_pages: number
  total: number
  items: ServerDeck[]
}

export interface SimilarDeckPage {
  page: number
  total_pages: number
  total: number
  deck_id: string
  similar_group_id: string | null
  items: ServerDeck[]
}

export interface ServerFormat {
  code: string
  name: string
  deck_count: number
}

export interface ServerFormats {
  items: ServerFormat[]
  last_updated: string | null
}

export interface UsageCard {
  rank: number
  name: string
  name_zh: string | null
  card_id: string | null
  image_url: string | null
  deck_count: number
  copy_count: number
  usage_rate: number
  previous_usage_rate: number | null
  usage_rate_change_pp: number | null
}

export interface UsageGroup {
  format_code: string
  window_days: number
  board: string
  window_start: string
  window_end: string
  total_decks: number
  top_n: number
  items: UsageCard[]
}

export interface UsageSnapshot {
  calculation_date: string
  source_fetched_at: string | null
  sync_complete: boolean
  comparison_date: string | null
  comparison_available: boolean
  groups: UsageGroup[]
}

// 由 ServerDeck 聚合出的赛事视图（对应 ServerDeck.event()）
export interface ServerEvent {
  id: string
  name: string
  date: string
  format: string
  representativeCard: ServerRepresentativeCard | null
  representativeComplete: boolean | null
  deckCount: number | null
}

export function deckToEvent(d: ServerDeck): ServerEvent {
  return {
    id: d.event_id,
    name: d.event_name,
    date: d.event_date,
    format: d.format_code,
    representativeCard: d.representative_card,
    representativeComplete: d.representative_card_complete,
    deckCount: d.event_deck_count,
  }
}

// 卡牌面（多部分牌 / 双面牌的各个部分）
export interface CardFace {
  name?: string
  name_zh?: string | null
  mana_cost?: string | null
  mana_value?: number | null
  colors?: string[]
  type_line?: string | null
  type_line_zh?: string | null
  oracle_text?: string | null
  oracle_text_zh?: string | null
  power?: string | null
  toughness?: string | null
  loyalty?: string | null
  defense?: string | null
  image_url?: string | null
}

/** 卡牌列表项（GET /cards）。注意列表接口不含 layout / oracle_text，需详情才能拿到 */
export interface ForgeCard {
  id: string
  oracle_id?: string | null
  name: string
  name_zh?: string | null
  mana_cost?: string | null
  mana_value?: number | null
  colors?: string[] | null
  color_identity?: string[] | null
  type_line?: string | null
  type_line_zh?: string | null
  set_code?: string | null
  set_name?: string | null
  set_name_zh?: string | null
  collector_number?: string | null
  rarity?: string | null
  layout?: string | null
  image_url?: string | null
  back_image_url?: string | null
  faces?: CardFace[] | null
}

/** 卡牌详情（GET /cards/{id}），在列表字段基础上补 layout / 规则文本 / P·T / 印刷版本 */
export interface ForgeCardDetail extends ForgeCard {
  oracle_text?: string | null
  oracle_text_zh?: string | null
  power?: string | null
  toughness?: string | null
  loyalty?: string | null
  defense?: string | null
  printings?: ForgeCard[] | null
}

export interface CardSearchResponse {
  page: number
  page_size: number
  total: number
  total_pages: number
  items: ForgeCard[]
}

/** GET /cards 的结构化筛选参数（ForgeCardApi.searchCards） */
export interface CardSearchParams {
  q?: string
  page?: number
  pageSize?: number
  /** 逗号分隔 W,U,B,R,G,C */
  colors?: string
  /** contains / exact / any */
  colorMode?: 'contains' | 'exact' | 'any'
  manaValue?: number
  minManaValue?: number
  maxManaValue?: number
  type?: string
  rarity?: string
  set?: string
}

export interface ForgeSet {
  code: string
  name: string
  name_zh?: string | null
  type?: string | null
  release_date?: string | null
  card_count?: number | null
}

export interface ForgeSetPage {
  page: number
  page_size: number
  total: number
  total_pages: number
  items: ForgeSet[]
}

export const RARITY_OPTIONS = [
  { value: 'common', label: '普通' },
  { value: 'uncommon', label: '非普通' },
  { value: 'rare', label: '稀有' },
  { value: 'mythic', label: '秘稀' },
  { value: 'special', label: '特殊' },
] as const

export const COLOR_OPTIONS = [
  { code: 'W', symbol: 'W', label: '白' },
  { code: 'U', symbol: 'U', label: '蓝' },
  { code: 'B', symbol: 'B', label: '黑' },
  { code: 'R', symbol: 'R', label: '红' },
  { code: 'G', symbol: 'G', label: '绿' },
  { code: 'C', symbol: 'C', label: '无色' },
] as const

/** 常见类别关键词（中英均可，服务端双支持） */
export const TYPE_OPTIONS = [
  { value: '', label: '不限' },
  { value: 'creature', label: '生物 Creature' },
  { value: 'instant', label: '瞬间 Instant' },
  { value: 'sorcery', label: '法术 Sorcery' },
  { value: 'enchantment', label: '结界 Enchantment' },
  { value: 'artifact', label: '神器 Artifact' },
  { value: 'planeswalker', label: '鹏洛客 Planeswalker' },
  { value: 'land', label: '地 Land' },
  { value: 'battle', label: '战役 Battle' },
] as const

export const COLOR_MODE_OPTIONS = [
  { value: 'contains', label: '至少包含所选色' },
  { value: 'exact', label: '正好是所选色' },
  { value: 'any', label: '含有任一所选色' },
] as const
