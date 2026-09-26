// 复刻 Android 端 exporter/DeckImageExporter.kt + DeckImageLayout.kt
// 布局常量严格保持一致，保证网页端分享图与 App 端观感相同

export const IMG = {
  WIDTH: 1600,
  COLUMNS: 8,
  MARGIN: 32,
  CELL_WIDTH: 192,
  CELL_HEIGHT: 336,
  HEADER: 190,
  SECTION: 60,
} as const

export const COLORS = {
  bg: '#171c24',
  placeholder: '#313946',
  badge: '#e6ac41',
  text: '#ffffff',
  sub: '#c8c8c8', // Color.LTGRAY
  badgeText: '#000000',
} as const

export interface ImageCard {
  name: string // 展示名（优先中文）
  quantity: number
  sideboard: boolean
  /** 单个 URL，或按优先级排列的候选列表：前一个加载失败就用下一个 */
  imageUrl?: string | (string | null)[] | null
}

export interface ExportResult {
  blob: Blob
  missing: number
  width: number
  height: number
  /** 文件扩展名（不含点） */
  ext: string
}

const rows = (count: number) => Math.ceil(count / IMG.COLUMNS)

/**
 * 导出宽度上限。默认就是 IMG.WIDTH（与 App 端一致）。
 * 少量机器（软件光栅化 / 显卡驱动异常）上大画布会明显吃力，
 * 可用 `?sharew=1100` 之类的地址参数临时降规格排查。
 */
function exportWidthCap(): number {
  try {
    const m = /sharew=(\d{3,4})/.exec(location.hash + location.search)
    if (m) return Math.max(600, Math.min(1600, Number(m[1])))
  } catch {
    /* ignore */
  }
  return IMG.WIDTH
}

function layoutHeight(mainCount: number, sideCount: number): number {
  return (
    IMG.HEADER +
    IMG.SECTION +
    rows(mainCount) * IMG.CELL_HEIGHT +
    (sideCount > 0 ? IMG.SECTION + rows(sideCount) * IMG.CELL_HEIGHT : 0) +
    64
  )
}

/**
 * 加载单张卡图；失败返回 null（不抛错，降级为占位）。
 *
 * 走 `fetch → Blob → objectURL` 而不是 `<img crossOrigin="anonymous">`：
 *   1. 实测在部分机器（Electron / 软件光栅化环境）上，批量 CORS 图片加载会把
 *      渲染进程和主进程一起拖死，导出进度直接不动；
 *   2. objectURL 是同源的，画到 canvas 上同样不会污染画布，导出安全；
 *   3. fetch 可以用 AbortController 精确超时，比 img 的 setTimeout 可靠。
 * 图床已开启 `Access-Control-Allow-Origin: *`，跨域 fetch 能正常拿到数据。
 */
/** 是否跑在桌面壳里（main.cjs 设置了 decklist-web/… 的 UA） */
const inDesktop = () =>
  typeof navigator !== 'undefined' && /decklist-web\//i.test(navigator.userAgent || '')

/**
 * 桌面壳里走本地图片代理 `/img?u=…`：主进程代拉远端卡图后以同源地址返回，
 * 既不用 CORS，也不会污染画布（详见 electron/main.cjs 的 proxyImage 说明）。
 * 网页版没有代理，只能直连——图床已开 ACAO:*，同样安全。
 */
function toLoadableUrl(url: string): { src: string; crossOrigin: boolean } {
  if (!inDesktop()) return { src: url, crossOrigin: true }
  if (!/^https?:/i.test(url)) return { src: url, crossOrigin: true }
  return { src: `/img?u=${encodeURIComponent(url)}`, crossOrigin: false }
}

function loadOne(url: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
  const { src, crossOrigin } = toLoadableUrl(url)
  return new Promise((resolve) => {
    const img = new Image()
    // 直连跨域图时必须带 crossOrigin，否则画到 canvas 上会污染画布、导出时报 SecurityError
    if (crossOrigin) img.crossOrigin = 'anonymous'
    let settled = false
    const done = (v: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(v)
    }
    // 不要用 img.src='' 去"取消"：空 src 会被解析成当前文档 URL，反而多打一次请求
    const timer = setTimeout(() => done(null), timeoutMs)
    img.onload = () => done(img.naturalWidth > 0 ? img : null)
    img.onerror = () => done(null)
    img.src = src
  })
}

/** 按顺序尝试候选 URL，取第一个真正能加载的（图床常有"URL 存在但文件缺失"） */
async function loadImage(
  input: string | (string | null)[] | null | undefined,
): Promise<HTMLImageElement | null> {
  const urls = (Array.isArray(input) ? input : [input]).filter((u): u is string => !!u)
  for (const u of urls) {
    const img = await loadOne(u)
    if (img) return img
  }
  return null
}

/** 按最大宽度换行 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    const test = current + ch
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = ch
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

/** 单行省略 */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

export async function exportDeckImage(opts: {
  deckName: string
  subtitle?: string
  eventName?: string
  cards: ImageCard[]
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}): Promise<ExportResult> {
  const main = opts.cards.filter((c) => !c.sideboard && c.quantity > 0)
  const side = opts.cards.filter((c) => c.sideboard && c.quantity > 0)
  if (main.length === 0 && side.length === 0) throw new Error('套牌为空，请先添加卡牌')

  const height = layoutHeight(main.length, side.length)
  const scale = Math.min(1, Math.sqrt(16_000_000 / (IMG.WIDTH * height)), exportWidthCap() / IMG.WIDTH)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(IMG.WIDTH * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(scale, scale)

  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, IMG.WIDTH, height)
  ctx.textBaseline = 'alphabetic'

  const line = (value: string, x: number, y: number, size: number, maxWidth: number, color: string = COLORS.text) => {
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
    ctx.fillStyle = color
    ctx.fillText(ellipsize(ctx, value.replace(/\n/g, ' '), maxWidth), x, y)
  }

  // 头部
  line(opts.deckName || '未命名套牌', 32, 68, 42, 1536)
  if (opts.subtitle) line(opts.subtitle, 32, 112, 24, 1536, COLORS.sub)
  if (opts.eventName) line(opts.eventName, 32, 150, 22, 1536, COLORS.sub)

  let y = IMG.HEADER
  let missing = 0
  let completed = 0
  const total = main.length + side.length

  // 先把卡图并发取回来再统一绘制。逐张 await 的话最坏是 30 × 6s = 3 分钟，
  // 期间界面除了进度数字没有任何反馈；URL 已提前 probe 过，基本都命中缓存。
  const arts: (HTMLImageElement | null)[] = new Array(total).fill(null)
  {
    let cursor = 0
    const flat = [...main, ...side]
    // 控制并发并留一点间隔：直连跨域卡图时，一次性并发几十张在部分机器上会把
    // 渲染进程和主进程一起拖住，导出进度条直接不动。桌面端走本地代理后压力小很多，
    // 但仍然保持温和的节奏。
    const loaders = Array.from({ length: Math.max(1, Math.min(3, total)) }, async () => {
      for (;;) {
        if (opts.signal?.aborted) return
        const i = cursor++
        if (i >= total) return
        arts[i] = await loadImage(flat[i].imageUrl)
        if (i < total - 1) await new Promise((r) => setTimeout(r, 60))
      }
    })
    await Promise.all(loaders)
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
  }

  let offset = 0
  for (const [title, entries] of [
    ['主牌', main],
    ['备牌', side],
  ] as const) {
    if (entries.length === 0) continue
    const cardCount = entries.reduce((s, c) => s + c.quantity, 0)
    line(`${title} · ${cardCount} 张`, 32, y + 38, 28, 1536)
    y += IMG.SECTION

    for (let index = 0; index < entries.length; index++) {
      if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      const card = entries[index]
      const art = arts[offset + index]

      const x = 32 + (index % IMG.COLUMNS) * IMG.CELL_WIDTH
      const top = y + Math.floor(index / IMG.COLUMNS) * IMG.CELL_HEIGHT

      // 卡图底板
      ctx.fillStyle = COLORS.placeholder
      roundRect(ctx, x, top, 180, 252, 10)
      ctx.fill()

      if (art) {
        ctx.save()
        roundRect(ctx, x, top, 180, 252, 10)
        ctx.clip()
        ctx.drawImage(art, x, top, 180, 252)
        ctx.restore()
      } else {
        missing++
        ctx.font = '18px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
        ctx.fillStyle = COLORS.sub
        ctx.save()
        ctx.translate(x + 16, top + 45)
        ctx.beginPath()
        ctx.rect(0, 0, 148, 140)
        ctx.clip()
        const wrapped = wrapText(ctx, card.name, 148)
        wrapped.slice(0, 6).forEach((ln, i) => ctx.fillText(ln, 0, 20 + i * 24))
        ctx.restore()
        line('卡图暂缺', x + 16, top + 194, 18, 148, COLORS.sub)
      }

      // 数量角标
      ctx.fillStyle = COLORS.badge
      roundRect(ctx, x + 126, top + 210, 52, 40, 6)
      ctx.fill()
      line(`×${card.quantity}`, x + 132, top + 239, 23, 46, COLORS.badgeText)

      // 卡名（自动缩字号，最多 70px 高）
      let size = 20
      ctx.save()
      ctx.translate(x, top + 258)
      ctx.beginPath()
      ctx.rect(0, 0, 180, 70)
      ctx.clip()
      let lines: string[] = []
      for (;;) {
        ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
        lines = wrapText(ctx, card.name, 180)
        if (lines.length * (size + 4) <= 68 || size <= 12) break
        size -= 1
      }
      ctx.fillStyle = COLORS.text
      lines.forEach((ln, i) => ctx.fillText(ln, 0, size + i * (size + 4)))
      ctx.restore()

      opts.onProgress?.(++completed, total)
    }
    offset += entries.length
    y += rows(entries.length) * IMG.CELL_HEIGHT
  }

  line('MTG 套牌  ·  卡牌图像 © Wizards of the Coast', 32, height - 20, 18, 1536, COLORS.sub)

  // 用 JPEG 而不是 PNG 出图：
  // 1600×2054 的 canvas 调 toBlob('image/png') 在部分机器上（软件光栅化 / GPU 回读慢）
  // 会阻塞渲染进程一分多钟，界面完全假死，看起来就像"分享图坏了"。
  // JPEG 编码快一个数量级，文件也从 ~5MB 降到 ~600KB，更适合分享。
  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    throw new Error('图片生成失败（画布可能已被跨域图片污染）')
  }
  const blob = dataUrlToBlob(dataUrl)
  if (!blob || blob.size === 0) throw new Error('图片生成失败')
  return { blob, missing, width: canvas.width, height: canvas.height, ext: 'jpg' }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Windows 文件名非法字符（套牌名常含 "4/5C Control" 这类斜杠） */
function safeFilename(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return cleaned || fallback
}

/** 页面底部浮一条提示（桌面端保存成功后告诉用户文件在哪） */
export function showToast(msg: string) {
  try {
    const old = document.getElementById('dlw-toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.id = 'dlw-toast'
    el.textContent = msg
    el.title = '点击关闭'
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;max-width:80vw;' +
      'background:#1f6feb;color:#fff;padding:10px 16px;border-radius:8px;cursor:pointer;' +
      'font:14px/1.5 "Microsoft YaHei",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)'
    el.onclick = () => el.remove()
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 8000)
  } catch {
    /* 页面跳转中，忽略 */
  }
}

/** 桌面壳注入的保存接口（见 electron/preload.cjs） */
interface DesktopBridge {
  saveImage?: (p: { base64: string; filename: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
  copyImage?: (p: { base64: string }) => Promise<{ ok: boolean; error?: string }>
  showItem?: (p: { path: string }) => Promise<{ ok: boolean; error?: string }>
  downloadsDir?: () => Promise<{ ok: boolean; dir?: string; portable?: boolean; error?: string }>
}

function desktopBridge(): DesktopBridge | null {
  const w = window as unknown as { dlw?: DesktopBridge }
  return w.dlw ?? null
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result || '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.readAsDataURL(blob)
  })
}

/**
 * 保存图片。桌面端走 IPC 让主进程写盘（浏览器的下载通道在 Electron 里会卡死应用），
 * 网页端退回 `<a download>`。返回保存路径（桌面端）或 null。
 */
export async function downloadBlob(
  blob: Blob,
  rawName: string,
  fallback = 'deck',
  ext = 'png',
): Promise<string | null> {
  const filename = `${safeFilename(rawName, fallback)}.${ext}`
  const bridge = desktopBridge()
  if (bridge?.saveImage) {
    try {
      const base64 = await blobToBase64(blob)
      const res = await bridge.saveImage({ base64, filename })
      if (res?.ok && res.path) {
        showToast(`已保存到：${res.path}`)
        return res.path
      }
      showToast(res?.error ? `保存失败：${res.error}` : '保存失败')
      return null
    } catch (e) {
      showToast(`保存失败：${(e as Error).message}`)
      return null
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return null
}

/** 是否跑在桌面壳里并且拿到了写盘通道 */
export function hasDesktopBridge(): boolean {
  return !!desktopBridge()?.saveImage
}

/** 桌面端默认保存目录，用于在界面上告诉用户文件会存到哪 */
export async function defaultSaveDir(): Promise<{ dir: string; portable: boolean } | null> {
  const bridge = desktopBridge()
  if (!bridge?.downloadsDir) return null
  try {
    const res = await bridge.downloadsDir()
    if (!res?.ok || !res.dir) return null
    return { dir: res.dir, portable: !!res.portable }
  } catch {
    return null
  }
}

/** 复制图片到系统剪贴板（可直接粘到微信 / QQ）。仅桌面端可用 */
export async function copyImageToClipboard(blob: Blob): Promise<{ ok: boolean; error?: string }> {
  const bridge = desktopBridge()
  if (!bridge?.copyImage) return { ok: false, error: '当前环境不支持复制（仅桌面端可用）' }
  try {
    const base64 = await blobToBase64(blob)
    const res = await bridge.copyImage({ base64 })
    return res?.ok ? { ok: true } : { ok: false, error: res?.error || '复制失败' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 在文件管理器里选中已保存的图片 */
export async function revealPath(target: string): Promise<boolean> {
  const bridge = desktopBridge()
  if (!bridge?.showItem) return false
  try {
    const res = await bridge.showItem({ path: target })
    return !!res?.ok
  } catch {
    return false
  }
}
