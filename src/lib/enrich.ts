// 卡牌元数据补齐
//
// 套牌列表接口（/decks/{id}）只返回「英文名 + 数量」，法术力费用、中文名、卡图、
// layout 都要回查 /cards。对齐 App 端「先出牌表，后补全」的策略：
//   1. 列表先渲染（只看得见的英文名）；
//   2. 后台并发回查，逐批 setState 增量刷新。
//
// 注意 list 接口不含 layout；只有当卡牌有 ≥2 个 face 时才额外拉一次详情取 layout，
// 避免「Solitude 这类单面牌被误判成双面牌」这类误判。

import { api, cardImageUrl } from '../api/client'
import type { ForgeCard } from '../api/types'

export interface CardMeta {
  manaCost?: string | null
  manaValue?: number | null
  layout?: string | null
  imageUrl?: string | null
  backImageUrl?: string | null
  colors?: string[] | null
  typeLine?: string | null
  typeLineZh?: string | null
  nameZh?: string | null
  faces?: { name: string; nameZh?: string; manaCost?: string; imageUrl?: string }[]
}

async function one(name: string): Promise<CardMeta | null> {
  const hit = await api.cardSearch({ q: name, pageSize: 5 })
  const items = hit.items ?? []
  if (items.length === 0) return null
  const exact =
    items.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ??
    items.find((c) => (c.name_zh ?? '') === name.trim()) ??
    items[0]
  let layout = exact.layout ?? null
  // 列表不含 layout，多面牌才补一次详情（低成本，且能区分双面 / 多部分）
  if (!layout && (exact.faces?.length ?? 0) > 1) {
    try {
      const detail = await api.cardDetail(exact.id)
      layout = detail.layout ?? null
    } catch {
      /* layout 拿不到就用 back_image_url 兜底判定 */
    }
  }
  return toMeta(exact, layout)
}

export function toMeta(c: ForgeCard, layoutOverride?: string | null): CardMeta {
  const faces = (c.faces ?? []).map((f) => ({
    name: f.name ?? '',
    nameZh: f.name_zh ?? undefined,
    manaCost: f.mana_cost ?? undefined,
    imageUrl: f.image_url ?? undefined,
  }))
  return {
    manaCost: c.mana_cost ?? null,
    manaValue: c.mana_value ?? null,
    layout: layoutOverride ?? c.layout ?? null,
    imageUrl: cardImageUrl(c),
    backImageUrl: c.back_image_url ?? null,
    colors: c.colors ?? null,
    typeLine: c.type_line ?? null,
    typeLineZh: c.type_line_zh ?? null,
    nameZh: c.name_zh ?? null,
    faces: faces.length > 0 ? faces : undefined,
  }
}

/**
 * 批量补齐。已 resolve 的结果会在每批结束后通过 onBatch 回调增量上抛。
 * 同名卡只查一次；网络错误的卡静默跳过（缺图不影响其他功能）。
 */
export async function enrichCards(
  names: string[],
  onBatch?: (partial: Record<string, CardMeta>) => void,
  concurrency = 4,
): Promise<Record<string, CardMeta>> {
  const todo = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const out: Record<string, CardMeta> = {}
  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency)
    const res = await Promise.all(
      batch.map(async (name) => {
        try {
          return [name, await one(name)] as const
        } catch {
          return [name, null] as const
        }
      }),
    )
    for (const [name, meta] of res) if (meta) out[name] = meta
    onBatch?.({ ...out })
  }
  return out
}
