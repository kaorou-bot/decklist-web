import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ServerDeck, ServerDeckCard } from '../api/types'
import { isMultiPart, isTrueDualFace } from '../lib/layout'
import { estimateManaValue } from '../lib/mana'
import ManaCost from '../components/ManaCost'
import { exportDeckImage } from '../lib/deckImage'
import ShareImagePanel from '../components/ShareImagePanel'
import { imageVariants, scryfallPrintUrl } from '../lib/cardArt'
import { customDeckToServerDeck, editorPathOf, findLocalDeck, isLocalDeckId, localDeckId, saveServerDeck } from '../lib/localDeck'
import { enrichCards, type CardMeta } from '../lib/enrich'
import CardImage from '../components/CardImage'
import CardVersionDialog from '../components/CardVersionDialog'
import { versionKey, type VersionMap } from '../lib/deckVersion'
import { loadDecks, saveDecks } from '../lib/storage'
import { DeckStatsView, OpeningHandView } from '../components/DeckStats'
import PageHeader from '../components/PageHeader'
import DeckCard, { deckPreviewSource } from '../components/DeckCard'
import type { StatCard } from '../lib/deckStats'

type Row = ServerDeckCard & { key: string; side: boolean; commander: boolean; meta?: CardMeta }

type Tab = 'list' | 'stats' | 'hand' | 'similar'

const keyOf = (c: ServerDeckCard) => c.name

export default function DeckDetailPage() {
  // /deck/:id 是服务器套牌，/deck/local/:uuid 是本机套牌集里的套牌
  const { id: serverId, uuid } = useParams<{ id?: string; uuid?: string }>()
  const nav = useNavigate()
  const id = uuid ? localDeckId(uuid) : serverId
  const isLocal = isLocalDeckId(id)
  const [deck, setDeck] = useState<ServerDeck | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [meta, setMeta] = useState<Record<string, CardMeta>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<'mv' | 'name' | 'type'>('mv')
  const [enriching, setEnriching] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  // 分享图分两阶段：先找图（网络 probe），再绘制。分开显示进度，用户才知道卡在哪一步
  const [phase, setPhase] = useState<'art' | 'draw' | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 生成结果：交给 ShareImagePanel 展示预览 + 保存入口（不再只是静默写盘）
  const [shot, setShot] = useState<{ blob: Blob; ext: string; name: string } | null>(null)
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})
  // 牌表里每张卡选中的印刷版本，选中后牌表与分享图都用它；本地套牌会存回套牌集
  const [picks, setPicks] = useState<VersionMap>({})
  const [versionDirty, setVersionDirty] = useState(false)
  const [versionRow, setVersionRow] = useState<Row | null>(null)
  const [tab, setTab] = useState<Tab>('list')
  const [similar, setSimilar] = useState<ServerDeck[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    if (isLocal) {
      // 本机套牌：直接读 localStorage，转换为详情页所需的形状
      setLoading(true)
      const record = findLocalDeck(id)
      if (record) {
        setDeck(customDeckToServerDeck(record))
        setPicks(record.versions ?? {})
        setVersionDirty(false)
        setError(null)
      } else {
        setDeck(null)
        setError('这套本地套牌不存在，可能已被删除')
      }
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    api
      .deck(id, ctrl.signal)
      .then(setDeck)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [id, isLocal])

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
    if (!deck || isLocal || tab !== 'similar' || similar.length > 0) return
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
  }, [deck, isLocal, tab, similar.length])

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
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setExporting(true)
    setProgress(null)
    setPhase('draw')
    setError(null)
    try {
      // 不再单独做一轮 probe：直接把「主图 → 图床命名变体 → Scryfall」的候选列表
      // 交给绘制阶段，只有真的加载失败才发下一个请求。正常一副牌就是 30 个请求，
      // 预先逐个 probe 的话最坏要发一百多个，慢且容易卡住。
      const artOf = (r: Row): (string | null)[] => {
        // 牌表里选过版本就用选的那张，其余候选照旧排在后面兜底
        const picked = picks[versionKey(r.name, r.side)]?.imageUrl ?? null
        const primary = picked ?? r.image_url ?? r.meta?.imageUrl ?? null
        const list: (string | null)[] = imageVariants(primary).slice(0, 4)
        const sf = scryfallPrintUrl(r.meta?.setCode ?? null, r.meta?.collectorNumber ?? null, false)
        if (sf) list.push(sf)
        return list
      }
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
          imageUrl: artOf(r),
        })),
        onProgress: (d, t) => setProgress([d, t]),
        signal: ctrl.signal,
      })
      setShot({ blob: res.blob, ext: res.ext, name: deck.deck_name })
      if (res.missing > 0) setError(`${res.missing} 张卡图缺失，已用占位替代`)
    } catch (e) {
      const err = e as Error
      setError(err.name === 'AbortError' ? '已取消生成' : String(err.message ?? err))
    } finally {
      abortRef.current = null
      setExporting(false)
      setProgress(null)
      setPhase(null)
    }
  }

  const handleCancelExport = () => abortRef.current?.abort()

  // 本机套牌：把牌表里选好的印刷版本写回套牌集
  const handleSaveVersions = () => {
    if (!id) return
    const decks = loadDecks()
    const i = decks.findIndex((d) => d.id === id)
    if (i < 0) return
    const next = [...decks]
    next[i] = { ...next[i], versions: picks, updatedAt: Date.now() }
    saveDecks(next)
    setVersionDirty(false)
    setNotice('已保存选中的印刷版本')
  }

  // 对齐 App：点一下就把整副牌表存进套牌集（App 是「收藏」，网页端对应套牌集）
  const handleSaveToCollection = () => {
    if (!deck) return
    setError(null)
    // 连同「中文牌名 + 选好的印刷版本」一起存，之后再打开还是这套配置
    const res = saveServerDeck(deck, { meta, versions: picks })
    setNotice(
      res.outcome === 'duplicate'
        ? `「${res.name}」已经在套牌集里了`
        : `已存入套牌集：${res.name}`,
    )
  }

  if (loading) return <div className="empty"><span className="spinner" /> 加载套牌…</div>
  if (error && !deck) return <div className="error">{error}</div>
  if (!deck) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'list', label: '牌表' },
    { key: 'stats', label: '统计' },
    { key: 'hand', label: '起手模拟' },
    // 本机套牌没有服务器侧的相似度数据
    ...(isLocal
      ? []
      : [{ key: 'similar' as Tab, label: `相似套牌${deck.similar_deck_count ? `（${deck.similar_deck_count}）` : ''}` }]),
  ]

  return (
    <div style={{ paddingTop: 16 }}>
      <PageHeader
        fallback="/"
        title={deck.deck_name}
        lead={
          <CardImage
            className="deck-cover"
            source={deckPreviewSource(deck)}
            placeholder={<span className="small muted">无图</span>}
            alt=""
            lazy={false}
          />
        }
        subtitle={
          isLocal
            ? `本机套牌集 · ${[deck.format, deck.player].filter(Boolean).join(' · ') || '自定义套牌'}`
            : [deck.event_name, deck.player, deck.place ? `第 ${deck.place} 名` : '', deck.event_date]
                .filter(Boolean)
                .join(' · ')
        }
        actions={
          <>
            <button onClick={handleExport} disabled={exporting}>
              {exporting
                ? `${phase === 'draw' ? '绘制中' : '找图中'}${progress ? ` ${progress[0]}/${progress[1]}` : '…'}`
                : '生成分享图'}
            </button>
            {exporting && <button className="small" onClick={handleCancelExport}>取消</button>}
            {isLocal ? (
              <>
                <Link to={editorPathOf(id ?? '')}><button>编辑套牌</button></Link>
                {versionDirty && (
                  <button className="btn-primary" onClick={handleSaveVersions}>保存版本</button>
                )}
              </>
            ) : (
              <button onClick={handleSaveToCollection}>存入套牌集</button>
            )}
          </>
        }
      />

      {error && <div className="error">{error}</div>}
      {notice && (
        <div className="notice row spread">
          <span>{notice}</span>
          <button className="small" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      {shot && (
        <ShareImagePanel
          blob={shot.blob}
          ext={shot.ext}
          name={shot.name}
          onClose={() => setShot(null)}
        />
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
              <CardSection title={`指挥官 · ${deck.commander_count ?? commanders.length} 张`} rows={commanders} flipped={flipped} setFlipped={setFlipped} picks={picks} onPickVersion={setVersionRow} />
            </div>
          )}
          <CardSection title={`主牌 · ${deck.mainboard_count} 张`} rows={main} flipped={flipped} setFlipped={setFlipped} picks={picks} onPickVersion={setVersionRow} />
          {side.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <CardSection title={`备牌 · ${deck.sideboard_count} 张`} rows={side} flipped={flipped} setFlipped={setFlipped} picks={picks} onPickVersion={setVersionRow} />
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
              <DeckCard
                key={d.id}
                deck={d}
                onClick={() => nav(`/deck/${encodeURIComponent(d.id)}`)}
              />
            ))}
          </div>
        </section>
      )}

      {versionRow && (
        <CardVersionDialog
          name={versionRow.name}
          nameZh={versionRow.name_zh}
          cardId={versionRow.meta?.cardId ?? versionRow.card_id ?? null}
          current={picks[versionKey(versionRow.name, versionRow.side)] ?? null}
          original={{
            imageUrl: versionRow.image_url ?? versionRow.meta?.imageUrl ?? null,
            setCode: versionRow.meta?.setCode ?? null,
            setNameZh: null,
            collectorNumber: versionRow.meta?.collectorNumber ?? null,
            rarity: null,
          }}
          backImageUrl={versionRow.meta?.backImageUrl ?? null}
          isDualFace={
            isTrueDualFace(versionRow.meta?.layout ?? null) ||
            (versionRow.meta?.layout == null && !!versionRow.meta?.backImageUrl)
          }
          onPick={(p) => {
            setPicks((prev) => {
              const next = { ...prev }
              const k = versionKey(versionRow.name, versionRow.side)
              if (p) next[k] = p
              else delete next[k]
              return next
            })
            setVersionDirty(true)
          }}
          onClose={() => setVersionRow(null)}
        />
      )}

      <div style={{ marginTop: 18 }}>
        {isLocal ? (
          <Link to="/custom" className="small muted">← 返回套牌集</Link>
        ) : (
          <Link to="/" className="small muted">← 返回赛事</Link>
        )}
      </div>
    </div>
  )
}

function CardSection({
  title,
  rows,
  flipped,
  setFlipped,
  picks,
  onPickVersion,
}: {
  title: string
  rows: Row[]
  flipped: Record<string, boolean>
  setFlipped: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  /** 每张卡选中的印刷版本（键为 versionKey） */
  picks: VersionMap
  onPickVersion: (row: Row) => void
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
          const pick = picks[versionKey(r.name, r.side)]
          // 翻到背面时用「选中版本的背面」，保证正反面是同一个印刷
          const img = showBack
            ? pick?.backImageUrl ?? r.meta?.backImageUrl
            : pick?.imageUrl ?? (r.image_url ?? r.meta?.imageUrl)
          const faces = r.meta?.faces
          return (
            <div key={`${r.name}-${i}`} className="card-row">
              <CardImage
                className="card-thumb"
                source={{
                  url: img,
                  cardId: r.meta?.cardId ?? r.card_id ?? null,
                  setCode: pick?.setCode ?? r.meta?.setCode ?? null,
                  collectorNumber: pick?.collectorNumber ?? r.meta?.collectorNumber ?? null,
                  name: r.name,
                  isBack: showBack,
                }}
                placeholder={<span className="small muted">无图</span>}
                onClick={() => onPickVersion(r)}
              />
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
              {/* 版本入口：选过就显示系列#编号，没选过显示「版本」 */}
              {pick ? (
                <button
                  className="printing-chip on"
                  title="点击更换印刷版本"
                  onClick={() => onPickVersion(r)}
                >
                  <strong>{pick.setCode || '—'}</strong>
                  <span className="small">#{pick.collectorNumber ?? '—'}</span>
                </button>
              ) : (
                <button className="small" title="选择印刷版本" onClick={() => onPickVersion(r)}>
                  版本
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
