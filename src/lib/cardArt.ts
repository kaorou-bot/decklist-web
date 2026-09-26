// 卡图源解析
//
// 关键约束：Canvas 导出分享图时，跨域图片必须带 CORS 头，否则画布被污染、
// toBlob() 抛 SecurityError。
//
// 2026-09-26 起 Forge 图床（images.mtg-forge-kaorou.vip，阿里云 OSS）
// 已在 OSS 控制台配置跨域规则：
//   Access-Control-Allow-Origin: * / Methods: GET, HEAD / Max-Age: 3600
// 因此分享图优先直接用 API 返回的 image_url（快、中文版本全、无请求配额），
// 仅当该卡没有 Forge 图时回退 Scryfall（需限速 ~10 req/s）。

const SCRYFALL = 'https://api.scryfall.com/cards/named'

export interface ArtEntry {
  name: string
  url: string | null
}

const cache = new Map<string, string | null>()

/** Scryfall 要求客户端限速（约 10 req/s），串行 + 最小间隔 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchArt(enName: string): Promise<string | null> {
  const key = enName.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null
  try {
    const url = `${SCRYFALL}?exact=${encodeURIComponent(enName.trim())}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      cache.set(key, null)
      return null
    }
    const data = (await res.json()) as {
      image_uris?: { normal?: string; large?: string }
      card_faces?: { image_uris?: { normal?: string } }[]
    }
    // 双面/连体牌取正面
    const url2 =
      data.image_uris?.normal ??
      data.image_uris?.large ??
      data.card_faces?.[0]?.image_uris?.normal ??
      null
    cache.set(key, url2)
    return url2
  } catch {
    cache.set(key, null)
    return null
  }
}

/** 批量解析卡图。带 forgeUrl 的直接采用（已确认 CORS 开放），其余查 Scryfall */
export async function resolveArt(
  cards: (string | { name: string; forgeUrl?: string | null })[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const norm = cards.map((c) =>
    typeof c === 'string' ? { name: c, forgeUrl: null as string | null } : { name: c.name, forgeUrl: c.forgeUrl ?? null },
  )
  const uniq = new Map<string, string | null>()
  for (const c of norm) {
    const k = c.name.trim()
    if (k && !uniq.has(k)) uniq.set(k, c.forgeUrl)
  }
  const list = [...uniq.entries()]
  // 先把有 Forge 图的全部收录（零网络开销）
  const needScryfall: string[] = []
  for (const [name, forgeUrl] of list) {
    if (forgeUrl) out.set(name, forgeUrl)
    else needScryfall.push(name)
  }
  // 没图的才走 Scryfall，串行限速
  for (let i = 0; i < needScryfall.length; i++) {
    const url = await fetchArt(needScryfall[i])
    out.set(needScryfall[i], url)
    onProgress?.(list.length - needScryfall.length + i + 1, list.length)
    if (i < needScryfall.length - 1) await sleep(110) // Scryfall 礼貌间隔
  }
  return out
}
