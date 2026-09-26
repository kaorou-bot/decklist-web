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
  imageUrl?: string | null
}

export interface ExportResult {
  blob: Blob
  missing: number
  width: number
  height: number
}

const rows = (count: number) => Math.ceil(count / IMG.COLUMNS)

function layoutHeight(mainCount: number, sideCount: number): number {
  return (
    IMG.HEADER +
    IMG.SECTION +
    rows(mainCount) * IMG.CELL_HEIGHT +
    (sideCount > 0 ? IMG.SECTION + rows(sideCount) * IMG.CELL_HEIGHT : 0) +
    64
  )
}

/** 加载单张卡图；失败返回 null（不抛错，降级为占位） */
function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => {
      img.src = ''
      resolve(null)
    }, 6000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
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
  const scale = Math.min(1, Math.sqrt(16_000_000 / (IMG.WIDTH * height)))
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
      const art = await loadImage(card.imageUrl)

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
    y += rows(entries.length) * IMG.CELL_HEIGHT
  }

  line('MTG 套牌  ·  卡牌图像 © Wizards of the Coast', 32, height - 20, 18, 1536, COLORS.sub)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('图片生成失败')
  return { blob, missing, width: canvas.width, height: canvas.height }
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

export function downloadBlob(blob: Blob, rawName: string, fallback = 'deck') {
  const filename = `${safeFilename(rawName, fallback)}.png`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
