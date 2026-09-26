import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ServerDeck, ServerRepresentativeCard } from '../api/types'
import { deckToEvent } from '../api/types'
import { useFormats } from '../lib/formats'
import CardImage from '../components/CardImage'
import DeckCard from '../components/DeckCard'
import { saveServerDeck, savedServerDeckIds } from '../lib/localDeck'

interface EventGroup {
  id: string
  name: string
  date: string
  format: string
  deckCount: number | null
  cover: ServerRepresentativeCard | null
  decks: ServerDeck[]
}

export default function EventsPage() {
  const { formats, defaultFormat } = useFormats()
  const nav = useNavigate()
  const [format, setFormat] = useState<string>('')
  const [decks, setDecks] = useState<ServerDeck[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 已存进套牌集的服务器套牌 id，「存入套牌集」按钮据此变成已存状态
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSavedIds(savedServerDeckIds())
  }, [])

  const save = async (id: string) => {
    setSavingId(id)
    setNotice(null)
    try {
      // 列表接口不含完整牌表，保存前要拉一次详情
      const detail = await api.deck(id)
      const res = saveServerDeck(detail)
      setSavedIds(savedServerDeckIds())
      setNotice(
        res.outcome === 'duplicate'
          ? `「${res.name}」已经在套牌集里了`
          : `已存入套牌集：${res.name}（可在「套牌集」页点开查看）`,
      )
    } catch (e) {
      setNotice(`保存失败：${(e as Error).message ?? e}`)
    } finally {
      setSavingId(null)
    }
  }

  // 赛制列表由 useFormats 统一加载（带模块级缓存），这里只负责挑默认值
  useEffect(() => {
    if (defaultFormat) setFormat((cur) => cur || defaultFormat)
  }, [defaultFormat])

  const load = useCallback(
    async (fmt: string, pg: number, append: boolean) => {
      if (!fmt) return
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      setError(null)
      try {
        const res = await api.decks({ format: fmt, page: pg, pageSize: 100 }, ctrl.signal)
        setTotalPages(res.total_pages ?? 1)
        setDecks((prev) => (append ? [...prev, ...(res.items ?? [])] : (res.items ?? [])))
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setError(String((e as Error).message ?? e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!format) return
    setPage(1)
    load(format, 1, false)
  }, [format, load])

  // 按 event_id 聚合成赛事
  const events = useMemo(() => {
    const map = new Map<string, EventGroup>()
    for (const d of decks) {
      const ev = deckToEvent(d)
      let g = map.get(ev.id)
      if (!g) {
        g = {
          id: ev.id,
          name: ev.name,
          date: ev.date,
          format: ev.format,
          deckCount: ev.deckCount,
          cover: ev.representativeCard ?? null,
          decks: [],
        }
        map.set(ev.id, g)
      }
      g.decks.push(d)
    }
    for (const g of map.values()) {
      g.decks.sort((a, b) => parseInt(a.place, 10) - parseInt(b.place, 10) || 0)
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [decks])

  const fmtName = (code: string) => formats.find((f) => f.code === code)?.name ?? code

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="row spread wrap" style={{ marginBottom: 14 }}>
        <div className="row">
          <label className="small muted">赛制</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={formats.length === 0}>
            {formats.length === 0 && <option value="">加载中…</option>}
            {formats.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}（{f.deck_count}）
              </option>
            ))}
          </select>
        </div>
        <div className="row small muted">
          {loading && <span className="spinner" />}
          <span>共 {events.length} 场赛事 / {decks.length} 副套牌</span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && (
        <div className="notice row spread">
          <span>{notice}</span>
          <button className="small" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      {events.length === 0 && !loading && !error && <div className="empty">暂无赛事数据</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {events.map((ev) => (
          <section key={ev.id} className="card event-card">
            <div className="event-head">
              {ev.cover && (
                <CardImage
                  source={{
                    url: ev.cover.image_url,
                    cardId: ev.cover.card_id,
                    name: ev.cover.name,
                  }}
                  placeholder={<span className="small muted">无图</span>}
                  alt=""
                  lazy={false}
                  className="event-cover-lg"
                />
              )}
              <div className="event-head-text">
                <h2 className="section-title">{ev.name}</h2>
                <div className="event-tags">
                  <span className="tag accent">{fmtName(ev.format)}</span>
                  <span className="tag">{ev.date}</span>
                  <span className="tag">{ev.deckCount ?? ev.decks.length} 副套牌</span>
                  {ev.cover && <span className="tag">代表卡 {ev.cover.name_zh || ev.cover.name}</span>}
                </div>
              </div>
            </div>
            <div className="event-body">
              <div className="grid">
                {ev.decks.map((d) => {
                  const saved = savedIds.has(d.id)
                  return (
                    <DeckCard
                      key={d.id}
                      deck={d}
                      onClick={() => nav(`/deck/${encodeURIComponent(d.id)}`)}
                      action={
                        <button
                          onClick={() => save(d.id)}
                          disabled={saved || savingId === d.id}
                          title={saved ? '这副已在套牌集中' : '把牌表存到本机套牌集'}
                        >
                          {saved ? '已在套牌集' : savingId === d.id ? '保存中…' : '存入套牌集'}
                        </button>
                      }
                    />
                  )
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      {page < totalPages && !loading && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            onClick={() => {
              const next = page + 1
              setPage(next)
              load(format, next, true)
            }}
          >
            加载更多（第 {page + 1} / {totalPages} 页）
          </button>
        </div>
      )}
    </div>
  )
}
