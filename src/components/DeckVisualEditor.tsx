// 图形化牌表编辑：点 +/− 增减单卡，搜索框直接加卡
//
// 数据仍然以 ImportedCard[] 为准，改完回调给父组件，由父组件重新序列化成文本，
// 这样「图形」与「文本」两种模式共用同一份数据，来回切换不会丢改动。
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { ForgeCard } from '../api/types'
import type { ImportedCard } from '../lib/deckImport'
import { matchingKey } from '../lib/deckImport'
import { isArtVariant } from '../lib/printings'
import type { CardMeta } from '../lib/enrich'
import CardImage from './CardImage'

export default function DeckVisualEditor(props: {
  cards: ImportedCard[]
  meta: Record<string, CardMeta>
  onChange: (cards: ImportedCard[]) => void
  enriching?: boolean
}) {
  const { cards, meta, onChange } = props

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ForgeCard[]>([])
  const [searching, setSearching] = useState(false)
  const [addSide, setAddSide] = useState(false)
  const reqId = useRef(0)

  // 搜索：停手 300ms 再发请求，丢弃过期响应
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const id = ++reqId.current
    const timer = setTimeout(async () => {
      try {
        const res = await api.cardSearch({ q, pageSize: 12 })
        if (id !== reqId.current) return
        setResults(res.items ?? [])
      } catch {
        if (id === reqId.current) setResults([])
      } finally {
        if (id === reqId.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const groups = useMemo(() => {
    const main = cards.filter((c) => !c.sideboard)
    const side = cards.filter((c) => c.sideboard)
    const byMv = (a: ImportedCard, b: ImportedCard) => {
      const ma = meta[a.name]?.manaValue ?? 99
      const mb = meta[b.name]?.manaValue ?? 99
      if (ma !== mb) return ma - mb
      return a.name.localeCompare(b.name)
    }
    return { main: [...main].sort(byMv), side: [...side].sort(byMv) }
  }, [cards, meta])

  // 同名记录去重：改名异画在服务端是独立记录（如 TMC 的「酸液黏菌」），
  // 列表里只留一条，且优先保留正常版本那条的图
  const shown = useMemo(() => {
    const map = new Map<string, ForgeCard>()
    for (const c of results) {
      const k = (c.name ?? '').trim().toLowerCase()
      const prev = map.get(k)
      if (!prev) {
        map.set(k, c)
      } else if (isArtVariant(prev.name, prev.image_url ?? null) && !isArtVariant(c.name, c.image_url ?? null)) {
        map.set(k, c)
      }
    }
    return [...map.values()]
  }, [results])

  const qtyOf = (name: string, sideboard: boolean) =>
    cards.find((c) => matchingKey(c.name) === matchingKey(name) && c.sideboard === sideboard)?.quantity ?? 0

  /** 改数量：减到 0 就移除；不存在则新增 */
  function bump(name: string, sideboard: boolean, delta: number) {
    const key = matchingKey(name)
    const next: ImportedCard[] = []
    let touched = false
    for (const c of cards) {
      if (matchingKey(c.name) === key && c.sideboard === sideboard) {
        touched = true
        const q = c.quantity + delta
        if (q > 0) next.push({ ...c, quantity: Math.min(q, 99) })
      } else {
        next.push(c)
      }
    }
    if (!touched && delta > 0) next.push({ name, quantity: Math.min(delta, 99), sideboard })
    onChange(next)
  }

  function remove(name: string, sideboard: boolean) {
    const key = matchingKey(name)
    onChange(cards.filter((c) => !(matchingKey(c.name) === key && c.sideboard === sideboard)))
  }

  /** 主牌 ⇄ 备牌：目标区已有同名则合并数量 */
  function move(name: string, sideboard: boolean) {
    const key = matchingKey(name)
    const from = cards.find((c) => matchingKey(c.name) === key && c.sideboard === sideboard)
    if (!from) return
    const rest = cards.filter((c) => c !== from)
    const target = rest.find((c) => matchingKey(c.name) === key && c.sideboard !== sideboard)
    if (target) {
      onChange(
        rest.map((c) =>
          c === target ? { ...c, quantity: Math.min(c.quantity + from.quantity, 99) } : c,
        ),
      )
    } else {
      onChange([...rest, { ...from, sideboard: !sideboard }])
    }
  }

  function add(card: ForgeCard) {
    bump(card.name, addSide, 1)
    setQuery('')
    setResults([])
  }

  return (
    <div>
      {/* 加卡 */}
      <div className="card ve-add">
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="ve-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索卡名加入牌表，如 Lightning Bolt / 闪电击"
            spellCheck={false}
          />
          <div className="segmented">
            <button className={!addSide ? 'on' : ''} onClick={() => setAddSide(false)}>加到主牌</button>
            <button className={addSide ? 'on' : ''} onClick={() => setAddSide(true)}>加到备牌</button>
          </div>
          {query.trim() && (
            <button className="small" onClick={() => { setQuery(''); setResults([]) }}>清空</button>
          )}
        </div>

        {query.trim() && (
          <div className="ve-results">
            {searching && <div className="small muted">搜索中…</div>}
            {!searching && shown.length === 0 && <div className="small muted">没有匹配的卡</div>}
            {shown.map((c) => (
              <button
                key={c.id}
                className="ve-result"
                onClick={() => add(c)}
                title={`${c.name_zh ?? c.name}${c.set_code ? ` · ${c.set_code}` : ''}`}
              >
                <CardImage
                  className="ve-result-thumb"
                  source={{ url: c.image_url ?? null, cardId: c.id, name: c.name }}
                  placeholder={null}
                  lazy={false}
                />
                <span className="ve-result-text">
                  <strong>{c.name_zh || c.name}</strong>
                  <span className="small muted">{c.name}</span>
                </span>
                <span className="ve-result-side small muted">
                  {qtyOf(c.name, false) > 0 && `主 ${qtyOf(c.name, false)}`}
                  {qtyOf(c.name, true) > 0 && ` · 备 ${qtyOf(c.name, true)}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 主牌 */}
      <CardGroup
        title="主牌"
        count={groups.main.reduce((s, c) => s + c.quantity, 0)}
        rows={groups.main}
        meta={meta}
        sideboard={false}
        onBump={bump}
        onRemove={remove}
        onMove={move}
      />

      {/* 备牌 */}
      <CardGroup
        title="备牌"
        count={groups.side.reduce((s, c) => s + c.quantity, 0)}
        rows={groups.side}
        meta={meta}
        sideboard
        onBump={bump}
        onRemove={remove}
        onMove={move}
        emptyHint="还没有备牌，可在上方搜索后点「加到备牌」"
      />
    </div>
  )
}

function CardGroup(props: {
  title: string
  count: number
  rows: ImportedCard[]
  meta: Record<string, CardMeta>
  sideboard: boolean
  onBump: (name: string, sideboard: boolean, delta: number) => void
  onRemove: (name: string, sideboard: boolean) => void
  onMove: (name: string, sideboard: boolean) => void
  emptyHint?: string
}) {
  const { title, count, rows, meta, sideboard, onBump, onRemove, onMove, emptyHint } = props
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="row spread" style={{ marginBottom: 10 }}>
        <strong>
          {title} · {count} 张
          <span className="small muted" style={{ marginLeft: 6 }}>{rows.length} 种</span>
        </strong>
      </div>
      {rows.length === 0 ? (
        <div className="small muted">{emptyHint ?? '还没有卡，可在上方搜索添加'}</div>
      ) : (
        <div className="ve-grid">
          {rows.map((c) => {
            const m = meta[c.name]
            return (
              <div key={`${c.sideboard ? 's' : 'm'}-${matchingKey(c.name)}`} className="ve-card">
                <CardImage
                  className="ve-thumb"
                  source={{
                    url: m?.imageUrl ?? null,
                    cardId: m?.cardId ?? null,
                    setCode: m?.setCode ?? null,
                    collectorNumber: m?.collectorNumber ?? null,
                    name: c.name,
                  }}
                  placeholder={<span className="small muted">无图</span>}
                />
                <div className="ve-body">
                  <div className="ve-name" title={c.name}>{m?.nameZh || c.name}</div>
                  {m?.nameZh && <div className="ve-sub small muted">{c.name}</div>}
                  <div className="ve-row">
                    <button
                      className="ve-step"
                      onClick={() => onBump(c.name, sideboard, -1)}
                      title="减一张"
                    >
                      −
                    </button>
                    <span className="ve-qty">{c.quantity}</span>
                    <button
                      className="ve-step"
                      onClick={() => onBump(c.name, sideboard, 1)}
                      disabled={c.quantity >= 99}
                      title="加一张"
                    >
                      +
                    </button>
                  </div>
                  <div className="ve-row ve-row-actions">
                    <button className="ve-mini" onClick={() => onMove(c.name, sideboard)}>
                      {sideboard ? '移入主牌' : '移入备牌'}
                    </button>
                    <button className="ve-mini danger" onClick={() => onRemove(c.name, sideboard)}>删除</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
