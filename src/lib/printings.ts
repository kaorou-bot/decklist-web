// 印刷版本聚合 + 改名异画识别
//
// 背景：Forge 服务端把「改名异画」当成独立卡记录。比如「酸液黏菌」有两个同名记录：
//   - TMC #48  图 = TMC/Marauding Mutagen.fullborder.jpg（改名异画，printings 只有 1 条）
//   - M3C #218 图 = M3C/Acidic Slime.fullborder.jpg（正常版，printings 有 26 条）
// 于是默认命中异画那条时，版本弹窗里只剩它自己一个印刷，切不回正常版。
//
// 两个对策：
//   1. 挑卡时避开异画（pickBestCard）
//   2. 版本列表按卡名把所有同名记录的印刷合并起来（collectPrintings）
import { api } from '../api/client'
import type { ForgeCard, ForgeCardDetail } from '../api/types'
import type { Printing } from './cardArt'

export type PrintingEx = Printing & {
  /** 图床文件名里的牌面名（改名异画时与卡名不同） */
  faceName?: string | null
  /** 是否为改名异画 */
  variant?: boolean
}

/** 归一化：小写、去重音、去标点、去尾部序号（Acidic Slime1 → acidic slime） */
export function normName(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s\d+$/g, '')
    .trim()
}

/** 图床 URL → 牌面名：.../TMC/Marauding%20Mutagen.fullborder.jpg → Marauding Mutagen */
export function faceNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    const stem = file.replace(/\.(fullborder|borderless)?\.jpe?g$/i, '').replace(/\.png$/i, '')
    const clean = stem.replace(/[_-]+/g, ' ').replace(/\s+\d+$/, '').trim()
    return clean || null
  } catch {
    return null
  }
}

/** 卡名取主段（连体牌 "Fire // Ice" 只比 "Fire"） */
function primaryName(name: string): string {
  return name.split('//')[0]?.trim() || name.trim()
}

/** 这张图是不是改名异画（牌面名与卡名对不上） */
export function isArtVariant(cardName: string | null | undefined, imageUrl: string | null | undefined): boolean {
  const face = faceNameFromUrl(imageUrl)
  if (!face || !cardName) return false
  const a = normName(face)
  const b = normName(primaryName(cardName))
  if (!a || !b) return false
  if (a === b) return false
  // 连体牌的两面：允许图是其中任一面
  const parts = String(cardName).split('//').map((p) => normName(p)).filter(Boolean)
  if (parts.some((p) => p === a)) return false
  return true
}

/** 从搜索结果里挑「最像本体」的那条：精确同名 > 非改名异画 > 第一条 */
export function pickBestCard(items: ForgeCard[], name: string): ForgeCard | null {
  if (items.length === 0) return null
  const target = name.trim().toLowerCase()
  const exact = items.filter((c) => (c.name ?? '').toLowerCase() === target)
  const pool = exact.length > 0 ? exact : items
  const plain = pool.find((c) => !isArtVariant(c.name, c.image_url ?? null))
  return plain ?? pool[0] ?? null
}

const collectCache = new Map<string, PrintingEx[]>()

/**
 * 按卡名把所有同名记录的印刷版本合并去重，异画排在后面并标出真实牌面名。
 * 同名记录最多取 6 条，避免一次打开弹窗发太多请求。
 */
export async function collectPrintings(
  name: string,
  cardId?: string | null,
  signal?: AbortSignal,
): Promise<PrintingEx[]> {
  const key = `${normName(name)}|${cardId ?? ''}`
  const cached = collectCache.get(key)
  if (cached) return cached

  const ids: string[] = []
  if (cardId) ids.push(cardId)
  try {
    const res = await api.cardSearch({ q: name, pageSize: 20 }, signal)
    const target = name.trim().toLowerCase()
    for (const c of res.items ?? []) {
      if ((c.name ?? '').toLowerCase() !== target) continue
      if (!ids.includes(c.id)) ids.push(c.id)
      if (ids.length >= 6) break
    }
  } catch {
    /* 搜索失败就用已有 id 兜底 */
  }

  const details = await Promise.all(
    ids.map((id) => api.cardDetail(id, signal).catch(() => null as ForgeCardDetail | null)),
  )

  const out: PrintingEx[] = []
  const seen = new Set<string>()
  const push = (p: PrintingEx) => {
    const k = p.imageUrl ?? `${p.setCode}-${p.collectorNumber}`
    if (!k || seen.has(k)) return
    seen.add(k)
    const face = faceNameFromUrl(p.imageUrl)
    out.push({ ...p, faceName: face, variant: isArtVariant(name, p.imageUrl) })
  }

  for (const d of details) {
    if (!d) continue
    push({
      setCode: d.set_code ?? null,
      setName: d.set_name ?? null,
      setNameZh: d.set_name_zh ?? null,
      collectorNumber: d.collector_number ?? null,
      rarity: d.rarity ?? null,
      imageUrl: d.image_url ?? null,
    })
    for (const p of d.printings ?? []) {
      push({
        setCode: p.set_code ?? null,
        setName: p.set_name ?? null,
        setNameZh: p.set_name_zh ?? null,
        collectorNumber: p.collector_number ?? null,
        rarity: p.rarity ?? null,
        imageUrl: p.image_url ?? null,
      })
    }
  }

  // 正常版在前，改名异画在后（各自保持服务端顺序）
  const sorted = [...out.filter((p) => !p.variant), ...out.filter((p) => p.variant)]
  collectCache.set(key, sorted)
  return sorted
}
