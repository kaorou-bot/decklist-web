// 卡图组件：按 cardArt 的回退链惰性降级
//
// 只在实际 <img> 触发 error 时才去尝试下一个候选，正常情况零额外请求：
//   主图 → 图床命名变体 → 其它印刷版本 → Scryfall
import { useCallback, useEffect, useRef, useState } from 'react'
import { artCandidates, type ArtSource } from '../lib/cardArt'

interface Props {
  source: ArtSource
  className?: string
  alt?: string
  lazy?: boolean
  /** 候选全部失败时的占位内容 */
  placeholder?: React.ReactNode
  /** 成功显示某张图时回调（父组件可据此同步状态） */
  onResolved?: (url: string | null) => void
  onClick?: () => void
}

export default function CardImage({
  source,
  className = '',
  alt = '',
  lazy = true,
  placeholder,
  onResolved,
  onClick,
}: Props) {
  const [url, setUrl] = useState<string | null>(source.url || null)
  const [failed, setFailed] = useState(false)
  const srcRef = useRef(source)
  srcRef.current = source
  const queueRef = useRef<string[]>([])
  const idxRef = useRef(0)
  const stageRef = useRef(0)
  const attemptedRef = useRef<Set<string>>(new Set())
  const tokenRef = useRef(0)

  const advance = useCallback(async () => {
    const myToken = ++tokenRef.current
    for (;;) {
      const q = queueRef.current
      if (idxRef.current < q.length) {
        const next = q[idxRef.current++]
        if (!next || attemptedRef.current.has(next)) continue
        attemptedRef.current.add(next)
        if (tokenRef.current !== myToken) return
        setUrl(next)
        return
      }
      if (stageRef.current >= 3) {
        if (tokenRef.current === myToken) setFailed(true)
        return
      }
      const stage = stageRef.current
      stageRef.current = stage + 1
      let urls: string[] = []
      try {
        urls = await artCandidates(srcRef.current, stage)
      } catch {
        urls = []
      }
      if (tokenRef.current !== myToken) return
      queueRef.current = urls.filter((u) => !attemptedRef.current.has(u))
      idxRef.current = 0
    }
  }, [])

  const resetKey = `${source.url ?? ''}|${source.cardId ?? ''}|${source.isBack ? 'b' : 'f'}`
  useEffect(() => {
    tokenRef.current++
    attemptedRef.current = new Set(source.url ? [source.url] : [])
    queueRef.current = []
    idxRef.current = 0
    stageRef.current = 0
    setFailed(false)
    setUrl(source.url || null)
    if (!source.url) void advance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  if (failed || !url) {
    return <div className={`img-placeholder ${className}`}>{placeholder ?? <span className="small muted">无卡图</span>}</div>
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt}
      loading={lazy ? 'lazy' : undefined}
      onError={() => void advance()}
      onLoad={() => onResolved?.(url)}
      onClick={onClick}
    />
  )
}
