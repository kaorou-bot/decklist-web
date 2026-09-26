// 卡图解析与多级回退
//
// 背景：Forge 图床（阿里云 OSS）按 <系列>/<卡名>[<序号>].fullborder.jpg 命名。
// 同一系列内的多个同名印刷会派生 1 / 2 / 3… 序号后缀，但图床并不保证每个序号都
// 真的同步了图片 —— 实测「惨痛胜利 / Bitter Triumph」默认指向
//   /cards/SOA/Bitter%20Triumph3.fullborder.jpg   → 404
// 而同系列 *.1 / *.2 以及 LCI / TDC / SCH 版本都存在。
// 所以不能盲信 API 返回的 image_url，必须有一条回退链：
//   ① 主图 + 图床命名变体（无序号版本、1..N 序号）
//   ② 该卡其它印刷版本的 image_url（GET /cards/{id} 的 printings 字段）
//   ③ Scryfall 按「系列 + 收藏编号」直出图片（英文原画，ACAO:*，可安全入 Canvas）
//   ④ Scryfall 按英文卡名查 JSON 取 image_uris.normal
// （与 Android 端 CardImageFallbackLoader 的策略一致）
//
// 展示层用 <CardImage> 惰性走链（只有真的 404 才发下一个请求）；
// 导出 canvas 前用 resolveWorkingArt() 逐个 probe（crossOrigin=anonymous）挑出可用 URL。

import { api, lookupCard } from '../api/client'
import type { ForgeCard } from '../api/types'

/** 图床文件名：<卡名>[序号][.风格].扩展名 */
const FILE_RX =
  /^(.*?)(?:(\d+))?(?:\.(fullborder|borderless|extended|showcase|retro|etched|promo))?\.(jpe?g|png|webp)$/i

const SCRYFALL_NAMED = 'https://api.scryfall.com/cards/named'

export interface ArtSource {
  /** 英文卡名（兜底回查用） */
  name?: string | null
  /** API 返回的主图 URL（可能失效） */
  url?: string | null
  /** 卡牌 id，用于拉取其它印刷版本 */
  cardId?: string | null
  setCode?: string | null
  collectorNumber?: string | null
  /** 是否取背面（双面牌） */
  isBack?: boolean
}

export interface Printing {
  setCode: string | null
  setName: string | null
  setNameZh: string | null
  collectorNumber: string | null
  rarity: string | null
  imageUrl: string | null
  /** 双面牌背面（切换版本时正反面要同步） */
  backImageUrl?: string | null
}

/* ---------------------------------- 缓存 ---------------------------------- */

const nameLookupCache = new Map<string, ForgeCard | null>()
const printingCache = new Map<string, Printing[]>()
const scryfallNamedCache = new Map<string, string | null>()
const resolvedCache = new Map<string, string | null>()

/* ------------------------------ 图床命名变体 ------------------------------ */

/**
 * 由主图 URL 派生同一图床上的候选文件名。
 * Bitter%20Triumph3.fullborder.jpg → [原样, ...无序号, ...1, ...2, ...4…]
 */
export function imageVariants(url: string | null | undefined): string[] {
  if (!url) return []
  const slash = url.lastIndexOf('/')
  const dir = slash >= 0 ? url.slice(0, slash + 1) : ''
  const file = slash >= 0 ? url.slice(slash + 1) : url
  const m = file.match(FILE_RX)
  if (!m) return [url]

  const [, base, digits, style, ext] = m
  const stylePart = style ? `.${style}` : ''
  const selfNum = digits ? Number(digits) : null
  const out: string[] = [url]
  const seen = new Set<string>([url])
  const push = (n: number | null) => {
    const u = `${dir}${base}${n === null ? '' : n}${stylePart}.${ext}`
    if (!seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  if (selfNum !== null) push(null)
  const maxN = selfNum === null ? 4 : Math.max(4, selfNum + 2)
  for (let n = 1; n <= maxN; n++) push(n)
  return out
}

/* -------------------------------- 印刷版本 -------------------------------- */

export async function fetchPrintings(cardId: string | null | undefined): Promise<Printing[]> {
  if (!cardId) return []
  const hit = printingCache.get(cardId)
  if (hit) return hit
  try {
    const detail = await api.cardDetail(cardId)
    const list = (detail.printings ?? [])
      .map((p) => ({
        setCode: p.set_code ?? null,
        setName: p.set_name ?? null,
        setNameZh: p.set_name_zh ?? null,
        collectorNumber: p.collector_number ?? null,
        rarity: p.rarity ?? null,
        imageUrl: p.image_url ?? null,
      }))
      .filter((p) => p.imageUrl || p.setCode)
    printingCache.set(cardId, list)
    return list
  } catch {
    printingCache.set(cardId, [])
    return []
  }
}

/* -------------------------------- Scryfall -------------------------------- */

export function scryfallPrintUrl(
  setCode: string | null | undefined,
  collectorNumber: string | null | undefined,
  isBack?: boolean,
): string | null {
  if (!setCode || !collectorNumber) return null
  const num = String(collectorNumber).trim()
  if (!num) return null
  return `https://api.scryfall.com/cards/${setCode.trim().toLowerCase()}/${encodeURIComponent(
    num,
  )}?format=image${isBack ? '&face=back' : ''}`
}

async function scryfallNamedUrl(enName: string | null | undefined, isBack?: boolean): Promise<string | null> {
  if (!enName) return null
  const key = `${isBack ? 'back' : 'front'}:${enName.trim().toLowerCase()}`
  if (scryfallNamedCache.has(key)) return scryfallNamedCache.get(key) ?? null
  try {
    const res = await fetch(`${SCRYFALL_NAMED}?exact=${encodeURIComponent(enName.trim())}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      scryfallNamedCache.set(key, null)
      return null
    }
    const data = (await res.json()) as {
      image_uris?: { normal?: string; large?: string }
      card_faces?: { image_uris?: { normal?: string; large?: string } }[]
    }
    const face = data.card_faces?.[isBack && data.card_faces.length > 1 ? 1 : 0] ?? null
    const url =
      face?.image_uris?.normal ??
      face?.image_uris?.large ??
      data.image_uris?.normal ??
      data.image_uris?.large ??
      null
    scryfallNamedCache.set(key, url)
    return url
  } catch {
    scryfallNamedCache.set(key, null)
    return null
  }
}

/* ------------------------------ 候选链的分层 ------------------------------ */

async function cardByName(name: string): Promise<ForgeCard | null> {
  const key = name.trim().toLowerCase()
  if (!key) return null
  if (nameLookupCache.has(key)) return nameLookupCache.get(key) ?? null
  try {
    const card = await lookupCard(name)
    nameLookupCache.set(key, card)
    return card
  } catch {
    nameLookupCache.set(key, null)
    return null
  }
}

/**
 * 候选链按 4 层惰性产出：
 *   0 = 主图 + 命名变体 | 1 = 其它印刷版本 | 2 = Scryfall（系列编号 → 卡名）| 3 = 结束
 */
export async function artCandidates(src: ArtSource, stage: number): Promise<string[]> {
  switch (stage) {
    case 0: {
      let primary = src.url ?? null
      if (!primary && src.name) {
        const card = await cardByName(src.name)
        primary = card?.image_url ?? null
      }
      return imageVariants(primary)
    }
    case 1: {
      let cardId = src.cardId ?? null
      if (!cardId && src.name) cardId = (await cardByName(src.name))?.id ?? null
      const prints = await fetchPrintings(cardId)
      const out: string[] = []
      const seen = new Set<string>()
      for (const p of prints) {
        for (const u of imageVariants(p.imageUrl)) {
          if (!seen.has(u)) {
            seen.add(u)
            out.push(u)
          }
        }
      }
      return out
    }
    case 2: {
      const out: string[] = []
      let cardId = src.cardId ?? null
      let set = src.setCode ?? null
      let num = src.collectorNumber ?? null
      const needLookup = (!cardId && src.name) || (!set && src.name) || (!num && src.name)
      if (needLookup && src.name) {
        const card = await cardByName(src.name)
        cardId ??= card?.id ?? null
        set ??= card?.set_code ?? null
        num ??= card?.collector_number ?? null
      }
      const prints = await fetchPrintings(cardId)
      for (const p of prints) {
        const u = scryfallPrintUrl(p.setCode, p.collectorNumber, src.isBack)
        if (u) out.push(u)
      }
      const self = scryfallPrintUrl(set, num, src.isBack)
      if (self) out.push(self)
      const named = await scryfallNamedUrl(src.name, src.isBack)
      if (named) out.push(named)
      return [...new Set(out)]
    }
    default:
      return []
  }
}

/* --------------------------------- 探测 --------------------------------- */

/**
 * 单张卡的「找图总预算」。
 * 回退链最长是 主图变体 → 所有印刷版本 → Scryfall，候选可能有几十个；
 * 逐个 probe 时一张彻底无图的卡能拖好几分钟，而 Promise.all 一批 6 张会一起等它，
 * 表现为分享图进度条卡在 18/30 不动（用户眼里就是"分享图坏了"）。
 * 给每张卡一个硬预算，超时就用占位图，保证整副牌的导出时间可控。
 */
const CARD_BUDGET_MS = 8_000
/** 每个回退阶段最多试几个候选（图床命名变体可能有十几个） */
const STAGE_LIMIT = [6, 6, 4] as const

export function probeImage(url: string, crossOrigin = false, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    const done = (ok: boolean) => {
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    img.onload = () => done(img.naturalWidth > 0)
    img.onerror = () => done(false)
    img.src = url
  })
}

function cacheKeyOf(src: ArtSource): string {
  return `${src.isBack ? 'b' : 'f'}:${src.cardId ?? ''}:${src.setCode ?? ''}:${src.collectorNumber ?? ''}:${
    src.url ?? ''
  }:${(src.name ?? '').trim().toLowerCase()}`
}

/**
 * 走完整回退链，返回第一个真正能加载的 URL（逐层 probe）。
 * crossOrigin=true 时用于 Canvas 导出：图不对 Return "" 会让 canvas 被污染，
 * 所以必须以 anonymous 模式验证过才能画。
 */
export async function resolveWorkingArt(src: ArtSource, crossOrigin = false): Promise<string | null> {
  const key = `${crossOrigin ? 'C' : 'N'}|${cacheKeyOf(src)}`
  if (resolvedCache.has(key)) return resolvedCache.get(key) ?? null
  const deadline = Date.now() + CARD_BUDGET_MS
  for (let stage = 0; stage < 3; stage++) {
    const urls = await artCandidates(src, stage).catch(() => [] as string[])
    const limit = STAGE_LIMIT[stage] ?? 4
    for (const u of urls.slice(0, limit)) {
      const left = deadline - Date.now()
      // 预算耗尽：返回 null（走占位图）。**不写缓存** —— 这只是本次超时，
      // 下次网络好的时候还能重试成功。
      if (left <= 0) return null
      if (await probeImage(u, crossOrigin, Math.min(6000, left))) {
        resolvedCache.set(key, u)
        return u
      }
    }
  }
  resolvedCache.set(key, null)
  return null
}

/**
 * 只有卡名时（自定义套牌），解析出有序的候选图 URL 供导出惰性回退：
 * 主图 → 图床命名变体 → Scryfall 按系列编号。
 * 不做预先 probe：导出阶段自己按顺序试，绝大多数牌第一个就命中。
 */
export async function artCandidatesByName(name: string): Promise<string[]> {
  const card = await cardByName(name)
  const primary = card?.image_url ?? null
  const list = imageVariants(primary).slice(0, 4)
  const sf = scryfallPrintUrl(card?.set_code ?? null, card?.collector_number ?? null, false)
  if (sf) list.push(sf)
  return list
}

/**
 * 批量解析（导出用）。返回 Map 以卡名为键，与旧 resolveArt 用法一致。
 *
 * 用**固定大小的工人池**而不是分批 Promise.all：分批时一批里只要有一张慢牌，
 * 其余 5 张就得陪着等，进度条会长时间不动。工人池里谁先好谁接下一张。
 */
export async function resolveArtForImages(
  sources: ArtSource[],
  onProgress?: (done: number, total: number) => void,
  crossOrigin = true,
  concurrency = 6,
  signal?: AbortSignal,
  /** 整批的硬时限：到点就停止找图，没找到的用占位图，保证导出一定完成 */
  deadlineMs = 20_000,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const total = sources.length
  const deadline = Date.now() + deadlineMs
  let done = 0
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, async () => {
    for (;;) {
      if (signal?.aborted || Date.now() > deadline) return
      const i = cursor++
      if (i >= total) return
      const s = sources[i]
      let url: string | null = null
      try {
        url = await resolveWorkingArt(s, crossOrigin)
      } catch {
        url = null
      }
      out.set((s.name ?? s.url ?? '').trim(), url)
      done++
      onProgress?.(done, total)
    }
  })
  await Promise.all(workers)
  return out
}

/** 供 UI 直接读取某个印刷的信息（版本切换列表用） */
export function printingsWithCurrent(card: {
  image_url?: string | null
  back_image_url?: string | null
  set_code?: string | null
  set_name?: string | null
  set_name_zh?: string | null
  collector_number?: string | null
  rarity?: string | null
  printings?: ReadonlyArray<{
    set_code?: string | null
    set_name?: string | null
    set_name_zh?: string | null
    collector_number?: string | null
    rarity?: string | null
    image_url?: string | null
    back_image_url?: string | null
  }> | null
}): Printing[] {
  const current: Printing = {
    setCode: card.set_code ?? null,
    setName: card.set_name ?? null,
    setNameZh: card.set_name_zh ?? null,
    collectorNumber: card.collector_number ?? null,
    rarity: card.rarity ?? null,
    imageUrl: card.image_url ?? null,
    backImageUrl: card.back_image_url ?? null,
  }
  const rest = (card.printings ?? [])
    .map((p) => ({
      setCode: p.set_code ?? null,
      setName: p.set_name ?? null,
      setNameZh: p.set_name_zh ?? null,
      collectorNumber: p.collector_number ?? null,
      rarity: p.rarity ?? null,
      imageUrl: p.image_url ?? null,
      backImageUrl: p.back_image_url ?? null,
    }))
    .filter((p) => p.imageUrl !== current.imageUrl)
  return [current, ...rest]
}

export const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  uncommon: '非普通',
  rare: '稀有',
  mythic: '秘稀',
  special: '特殊',
  bonus: '赠卡',
}
