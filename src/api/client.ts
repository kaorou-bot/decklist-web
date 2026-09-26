import type {
  CardSearchParams,
  CardSearchResponse,
  ForgeCard,
  ForgeCardDetail,
  ForgeSetPage,
  ServerDeck,
  ServerDeckPage,
  ServerFormats,
  SimilarDeckPage,
  UsageSnapshot,
} from './types'
import { pickBestCard } from '../lib/printings'

export const API_BASE = 'https://play.mtg-forge-kaorou.vip:8443/api/v1'

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) throw new Error(`请求失败 ${res.status}：${path}`)
  return (await res.json()) as T
}

export const api = {
  formats: (signal?: AbortSignal) => get<ServerFormats>('/decks/formats', {}, signal),

  decks: (
    args: {
      format: string
      page?: number
      pageSize?: number
      q?: string
      dateFrom?: string
      dateTo?: string
      similarGroupId?: string
    },
    signal?: AbortSignal,
  ) =>
    get<ServerDeckPage>(
      '/decks',
      {
        format: args.format,
        page: args.page ?? 1,
        page_size: args.pageSize ?? 100,
        q: args.q,
        date_from: args.dateFrom,
        date_to: args.dateTo,
        similar_group_id: args.similarGroupId,
      },
      signal,
    ),

  deck: (id: string, signal?: AbortSignal) => get<ServerDeck>(`/decks/${encodeURIComponent(id)}`, {}, signal),

  similar: (id: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    get<SimilarDeckPage>(
      `/decks/${encodeURIComponent(id)}/similar`,
      { page, page_size: pageSize },
      signal,
    ),

  usage: (format: string, days: number, board: 'mainboard' | 'sideboard', signal?: AbortSignal) =>
    get<UsageSnapshot>('/decks/card-usage', { format, window_days: days, board }, signal),

  /** 结构化高级查牌：服务端支持 q / colors / color_mode / mana_value / min-max / type / rarity / set */
  cardSearch: (params: CardSearchParams = {}, signal?: AbortSignal) =>
    get<CardSearchResponse>(
      '/cards',
      {
        q: params.q,
        page: params.page ?? 1,
        page_size: params.pageSize ?? 20,
        colors: params.colors,
        color_mode: params.colorMode,
        mana_value: params.manaValue,
        min_mana_value: params.minManaValue,
        max_mana_value: params.maxManaValue,
        type: params.type,
        rarity: params.rarity,
        set: params.set,
      },
      signal,
    ),

  cardDetail: (id: string, signal?: AbortSignal) =>
    get<ForgeCardDetail>(`/cards/${encodeURIComponent(id)}`, {}, signal),

  sets: (q?: string, pageSize = 100, signal?: AbortSignal) =>
    get<ForgeSetPage>('/sets', { q, page: 1, page_size: pageSize }, signal),
}

/** 套牌条目常缺 image_url / 中文名，按名字回查一次补元数据 */
export async function lookupCard(name: string, signal?: AbortSignal): Promise<ForgeCard | null> {
  try {
    // /cards 返回 items 数组（不是 data），早期版本读 data 导致这里恒为 null
    const res = await api.cardSearch({ q: name, pageSize: 5 }, signal)
    const list = res.items ?? []
    if (list.length === 0) return null
    // 同名里可能有「改名异画」（酸液黏菌 → Marauding Mutagen），优先挑本体
    return pickBestCard(list, name)
  } catch {
    return null
  }
}

export function cardImageUrl(card: ForgeCard | null | undefined): string | null {
  if (!card) return null
  return card.image_url ?? card.faces?.[0]?.image_url ?? null
}
