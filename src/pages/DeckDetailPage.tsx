import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ServerDeck, ServerDeckCard } from '../api/types'
import { isMultiPart, isTrueDualFace } from '../lib/layout'
import { estimateManaValue } from '../lib/mana'
import ManaCost from '../components/ManaCost'
import { downloadBlob, exportDeckImage } from '../lib/deckImage'
import { parseDeckText } from '../lib/deckImport'
import { resolveArt } from '../lib/cardArt'
import { enrichCards, type CardMeta } from '../lib/enrich'
import { DeckStatsView, OpeningHandView } from '../components/DeckStats'
import type { StatCard } from '../lib/deckStats'

type Row = ServerDeckCard & { key: string; side: boolean; commander: boolean; meta?: CardMeta }

type Tab = 'list' | 'stats' | 'hand' | 'similar'

const keyOf = (c: ServerDeckCard) => c.name

export default function DeckDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [deck, setDeck] = useState<ServerDeck | null>(null)
  const [meta, setMeta] = useState<Record<string, CardMeta>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<'mv' | 'name' | 'type'>('mv')
  const [enriching, setEnriching] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<Tab>('list')
  const [similar, setSimilar] = useState<ServerDeck[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    setLoading(true)
    api
      .deck(id, ctrl.signal)
      .then(setDeck)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [id])

  // 后台补齐元数据（法术力、类别、layout、卡图）—— 对齐 App 端「先打开、后补全」
  // /decks/{id} 只给英文名与卡图，类别与费用必须回查 /cards
  const enrich = useCallback(async (cards: ServerDeckCard[]) => {
    const todo = cards.map((c) => c.name).filter((n, i, a) => n && a.indexOf(n) === i)
    if (todo.length === 0) return
    setEnriching(true)
    try {
      await enrichCards(todo, (partial) => setMeta(partial))
    } finally {
      setEnriching(false)
    }
  }, [])

  useEffect(() => {
    if (!deck) return
    enrich([...(deck.mainboard ?? []), ...(deck.sideboard ?? []), ...(deck.commanders ?? [])])
  }, [deck, enrich])

  useEffect(() => {
    if (!deck || tab !== 'similar' || similar.length > 0) return
    let alive = true
    setSimilarLoading(true)
    api
      .similar(deck.id, 1, 30)
      .then((res) => alive && setSimilar(res.items ?? []))
      .catch(() => alive && setSimilar([]))
      .finally(() => alive && setSimilarLoading(false))
    return () => {
      alive = false
    }
  }, [deck, tab, similar.length])

  const rows = useMemo<Row[]>(() => {
    if (!deck) return []
    const all: Row[] = [
      ...(deck.mainboard ?? []).map((c) => ({ ...c, key: keyOf(c), side: false, commander: false })),
      ...(deck.commanders ?? []).map((c) => ({ ...c, key: `cmdr:${c.name}`, side: false, commander: true })),
      ...(deck.sideboard ?? []).map((c) => ({ ...c, key: keyOf(c), side: true, commander: false })),
    ]
    return all.map((r) => ({ ...r, meta: meta[r.name] }))
  }, [deck, meta])

  const sorted = useMemo(() => {
    const mv = (r: Row) =>
      r.meta?.manaValue ?? estimateManaValue(r.meta?.manaCost ?? '') ?? Number.MAX_SAFE_INTEGER
    const arr = [...rows]
    if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'type') arr.sort((a, b) => (a.meta?.layout ?? '').localeCompare(b.meta?.layout ?? '') || mv(a) - mv(b))
    else arr.sort((a, b) => mv(a) - mv(b) || a.name.localeCompare(b.name))
    return arr
  }, [rows, sort])

  const main = sorted.filter((r) => !r.side && !r.commander)
  const commanders = sorted.filter((r) => r.commander)
  const side = sorted.filter((r) => r.side)

  const statCards = useMemo<StatCard[]>(
    () =>
      rows.map((r) => ({
        name: r.name,
        quantity: r.quantity,
        sideboard: r.side,
        manaCost: r.meta?.manaCost ?? null,
        manaValue: r.meta?.manaValue ?? null,
        typeLine: r.meta?.typeLine ?? null,
        typeLineZh: r.meta?.typeLineZh ?? null,
        colors: r.meta?.colors ?? null,
      })),
    [rows],
  )

  const handleExport = async () => {
    if (!deck) return
    setExporting(true)
    setProgress(null)
    setError(null)
    try {
      // 分享图：Forge 图床已开放 CORS（2026-09-26），优先直接用 image_url，
      // 没图的卡回退 Scryfall
      const art = await resolveArt(
        sorted.map((r) => ({ name: r.name, forgeUrl: r.image_url })),
        (d, t) => setProgress([d, t]),
      )
      const parts = [
        deck.format,
        deck.player,
        deck.place ? `第 ${deck.place} 名` : '',
        deck.event_date,
      ].filter(Boolean)
      const res = await exportDeckImage({
        deckName: deck.deck_name,
        subtitle: parts.join('  ·  '),
        eventName: deck.event_name,
        cards: sorted.map((r) => ({
          name: r.name_zh || r.name,
          quantity: r.quantity,
          sideboard: r.side,
          imageUrl: art.get(r.name) ?? null,
        })),
        onProgress: (d, t) => setProgress([d, t]),
      })
      setPreview(URL.createObjectURL(res.blob))
      downloadBlob(res.blob, `${deck.deck_name || 'deck'}.png`)
      if (res.missing > 0) setError(`${res.missing} 张卡图缺失，已用占位替代`)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  const handleSaveToCollection = () => {
    if (!deck) return
    const text = [
      `套牌名称：${deck.deck_name}`,
      `玩家：${deck.player}`,
      `赛制：${deck.format}`,
      '',
      ...(deck.commanders ?? []).map((c) => `${c.quantity} ${c.name}`),
      ...(deck.mainboard ?? []).map((c) => `${c.quantity} ${c.name}`),
      '',
      '备牌',
      ...(deck.sideboard ?? []).map((c) => `${c.quantity} ${c.name}`),
    ].join('\n')
    try {
      const parsed = parseDeckText(text)
      sessionStorage.setItem('decklist-web/import-pending', JSON.stringify(parsed))
      window.location.hash = '#/custom/new'
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  if (loading) return <div className="empty"><span className="spinner" /> 加载套牌…</div>
  if (error && !deck) return <div className="error">{error}</div>
  if (!deck) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'list', label: '牌表' },
    { key: 'stats', label: '统计' },
    { key: 'hand', label: '起手模拟' },
    { key: 'similar', label: `相似套牌${deck.similar_deck_count ? `（${deck.similar_deck_count}）` : ''}` },
  ]

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 20 }}>{deck.deck_name}</h1>
          <div className="small muted">
            {[deck.player, deck.place ? `第 ${deck.place} 名` : '', deck.event_date].filter(Boolean).join(' · ')}
          </div>
          <div className="small muted">{deck.event_name}</div>
        </div>
        <div className="row wrap">
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? `生成中${progress ? ` ${progress[0]}/${progress[1]}` : '…'}` : '生成分享图'}
          </button>
          <button onClick={handleSaveToCollection}>存入套牌集</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {preview && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <strong>分享图预览</strong>
            <button onClick={() => setPreview(null)}>关闭</button>
          </div>
          <img src={preview} alt="分享图" style={{ width: '100%', borderRadius: 6, display: 'block' }} />
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="segmented">
          {tabs.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'list' && (
          <>
            <span className="small muted">排序</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="mv">法术力值</option>
              <option value="type">类别</option>
              <option value="name">英文名 A–Z</option>
            </select>
          </>
        )}
        {enriching && <span className="row small muted"><span className="spinner" /> 补齐卡图与费用…</span>}
      </div>

      {tab === 'list' && (
        <>
          {commanders.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <CardSection title={`指挥官 · ${deck.commander_count ?? commanders.length} 张`} rows={commanders} flipped={flipped} setFlipped={setFlipped} />
            </div>
          )}
          <CardSection title={`主牌 · ${deck.mainboard_count} 张`} rows={main} flipped={flipped} setFlipped={setFlipped} />
          {side.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <CardSection title={`备牌 · ${deck.sideboard_count} 张`} rows={side} flipped={flipped} setFlipped={setFlipped} />
            </div>
          )}
        </>
      )}

      {tab === 'stats' && <DeckStatsView cards={statCards} enriching={enriching} />}

      {tab === 'hand' && (
        <section className="card">
          <h2 className="section-title">起手模拟</h2>
          <OpeningHandView
            cards={rows.map((r) => ({ name: r.name, quantity: r.quantity, nameZh: r.name_zh, sideboard: r.side }))}
            meta={meta}
          />
        </section>
      )}

      {tab === 'similar' && (
        <section className="card">
          <h2 className="section-title">相似套牌</h2>
          {similarLoading && <div className="row small muted"><span className="spinner" /> 加载中…</div>}
          {!similarLoading && similar.length === 0 && <div className="small muted">没有找到近似构筑的套牌</div>}
          <div className="grid">
            {similar.map((d) => (
              <Link key={d.id} to={`/deck/${encodeURIComponent(d.id)}`} className="deck-card">
                <h3>{d.deck_name}</h3>
                <div className="small muted">
                  {d.player || '—'}
                  {d.place ? ` · 第 ${d.place} 名` : ''}
                </div>
                <div className="small muted">{d.event_date} · {d.event_name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div style={{ marginTop: 18 }}>
        <Link to="/" className="small muted">← 返回赛事</Link>
      </div>
    </div>
  )
}

function CardSection({
  title,
  rows,
  flipped,
  setFlipped,
}: {
  title: string
  rows: Row[]
  flipped: Record<string, boolean>
  setFlipped: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
}) {
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
        {title}
      </div>
      <div className="card-list">
        {rows.map((r, i) => {
          const layout = r.meta?.layout ?? null
          const dual = isTrueDualFace(layout) || (layout == null && !!r.meta?.backImageUrl)
          const multi = isMultiPart(layout)
          const showBack = dual && flipped[r.name]
          const img = showBack ? r.meta?.backImageUrl : (r.image_url ?? r.meta?.imageUrl)
          const faces = r.meta?.faces
          return (
            <div key={`${r.name}-${i}`} className="card-row">
              {img && <img className="card-thumb" src={img} alt="" loading="lazy" />}
              <span className="qty">{r.quantity}×</span>
              <div className="card-name">
                <div>{r.name_zh || r.name}</div>
                {r.name_zh && r.name_zh !== r.name && <div className="small muted">{r.name}</div>}
                {multi && faces && faces.length > 1 && (
                  <div className="small muted">
                    {faces.map((f, fi) => (
                      <div key={fi}>
                        {f.nameZh || f.name}
                        {f.manaCost ? ' · ' : ''}
                        {f.manaCost && <ManaCost cost={f.manaCost} />}
                      </div>
                    ))}
                  </div>
                )}
                {dual && (
                  <div className="face-toggle" style={{ marginTop: 4 }}>
                    <button className={!showBack ? 'on' : ''} onClick={() => setFlipped((p) => ({ ...p, [r.name]: false }))}>
                      正面
                    </button>
                    <button className={showBack ? 'on' : ''} onClick={() => setFlipped((p) => ({ ...p, [r.name]: true }))}>
                      其他部分
                    </button>
                  </div>
                )}
              </div>
              {!multi && <ManaCost cost={r.meta?.manaCost} />}
              {dual && <span className="badge badge-gold">双面</span>}
              {multi && <span className="badge">多部分</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
