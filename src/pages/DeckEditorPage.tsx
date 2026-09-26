import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deckToText, parseDeckText, type ImportedCard } from '../lib/deckImport'
import { deckTotals, loadDecks, newDeckId, saveDecks, type CustomDeck } from '../lib/storage'
import { downloadBlob, exportDeckImage } from '../lib/deckImage'
import { resolveArtForImages } from '../lib/cardArt'
import { enrichCards, type CardMeta } from '../lib/enrich'
import { DeckStatsView, OpeningHandView } from '../components/DeckStats'
import type { StatCard } from '../lib/deckStats'

type Tab = 'edit' | 'stats' | 'hand'

export default function DeckEditorPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const isNew = !id || id === 'new'

  const [name, setName] = useState('')
  const [player, setPlayer] = useState('')
  const [format, setFormat] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('edit')
  const [meta, setMeta] = useState<Record<string, CardMeta>>({})
  const [enriching, setEnriching] = useState(false)

  // 新建时接住「存入套牌集」带来的待导入内容
  useEffect(() => {
    if (!isNew) return
    const raw = sessionStorage.getItem('decklist-web/import-pending')
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { name?: string; player?: string; format?: string; cards: ImportedCard[] }
      setName(pending.name ?? '')
      setPlayer(pending.player ?? '')
      setFormat(pending.format ?? '')
      setText(deckToText({ cards: pending.cards ?? [], name: pending.name, player: pending.player, format: pending.format }))
    } catch {
      /* 忽略坏数据 */
    } finally {
      sessionStorage.removeItem('decklist-web/import-pending')
    }
  }, [isNew])

  useEffect(() => {
    if (isNew || !id) return
    const found = loadDecks().find((d) => d.id === decodeURIComponent(id))
    if (!found) {
      setError('套牌不存在')
      return
    }
    setName(found.name)
    setPlayer(found.player ?? '')
    setFormat(found.format ?? '')
    setText(deckToText(found))
  }, [id, isNew])

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, deck: parseDeckText(text) }
    } catch (e) {
      return { ok: false as const, error: String((e as Error).message ?? e) }
    }
  }, [text])

  const totals = parsed.ok ? deckTotals(parsed.deck.cards) : { main: 0, side: 0, total: 0 }

  // 自定义套牌也做同样的元数据补齐：统计需要法术力值与类别，起手模拟需要卡图
  const editorSignature = parsed.ok ? parsed.deck.cards.map((c) => c.name).join('|') : ''
  useEffect(() => {
    if (!parsed.ok) return
    const timer = setTimeout(async () => {
      setEnriching(true)
      try {
        await enrichCards(
          parsed.deck.cards.map((c) => c.name),
          (partial) => setMeta(partial),
        )
      } finally {
        setEnriching(false)
      }
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSignature])

  const statCards = useMemo<StatCard[]>(
    () =>
      parsed.ok
        ? parsed.deck.cards.map((c) => {
            const m = meta[c.name]
            return {
              name: c.name,
              quantity: c.quantity,
              sideboard: c.sideboard,
              manaCost: m?.manaCost ?? null,
              manaValue: m?.manaValue ?? null,
              typeLine: m?.typeLine ?? null,
              typeLineZh: m?.typeLineZh ?? null,
              colors: m?.colors ?? null,
            }
          })
        : [],
    [parsed, meta],
  )

  const save = () => {
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    const decks = loadDecks()
    const deckId = isNew ? newDeckId() : decodeURIComponent(id!)
    const now = Date.now()
    const existing = decks.find((d) => d.id === deckId)
    const record: CustomDeck = {
      id: deckId,
      name: name.trim() || '未命名套牌',
      player: player.trim() || undefined,
      format: format.trim() || undefined,
      cards: parsed.deck.cards,
      representative: existing?.representative,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const next = existing ? decks.map((d) => (d.id === deckId ? record : d)) : [...decks, record]
    saveDecks(next)
    nav('/custom')
  }

  const share = async () => {
    if (!parsed.ok) return setError(parsed.error)
    setBusy(true)
    try {
      const art = await resolveArtForImages(parsed.deck.cards.map((c) => ({ name: c.name })))
      const cards = parsed.deck.cards.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        sideboard: c.sideboard,
        imageUrl: art.get(c.name) ?? null,
      }))
      const res = await exportDeckImage({
        deckName: name.trim() || '未命名套牌',
        subtitle: [format, player].filter(Boolean).join('  ·  '),
        cards,
      })
      downloadBlob(res.blob, `${name.trim() || 'deck'}.png`)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ paddingTop: 16 }}>
      <h1 className="section-title" style={{ fontSize: 20, marginBottom: 12 }}>
        {isNew ? '新建套牌' : '编辑套牌'}
      </h1>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="segmented">
          <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>牌表编辑</button>
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>统计</button>
          <button className={tab === 'hand' ? 'on' : ''} onClick={() => setTab('hand')}>起手模拟</button>
        </div>
        {enriching && <span className="row small muted"><span className="spinner" /> 补齐卡牌数据…</span>}
      </div>

      {error && <div className="error">{error}</div>}

      {tab === 'stats' && <DeckStatsView cards={statCards} enriching={enriching} />}

      {tab === 'hand' && (
        <section className="card">
          <h2 className="section-title">起手模拟</h2>
          {parsed.ok ? (
            <OpeningHandView
              cards={parsed.deck.cards.map((c) => ({
                name: c.name,
                quantity: c.quantity,
                nameZh: meta[c.name]?.nameZh ?? null,
                sideboard: c.sideboard,
              }))}
              meta={meta}
            />
          ) : (
            <div className="small muted">牌表解析通过后可模拟起手</div>
          )}
        </section>
      )}

      {tab === 'edit' && (
        <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="row">
            <span className="small muted">名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="套牌名称" style={{ width: 200 }} />
          </label>
          <label className="row">
            <span className="small muted">使用人</span>
            <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="牌手" style={{ width: 160 }} />
          </label>
          <label className="row">
            <span className="small muted">赛制</span>
            <input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="如 标准" style={{ width: 140 }} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <strong>牌表</strong>
          <span className="small muted">
            每行「数量 牌名」· 支持 4x、SB:、备牌/主牌 标题、套牌名称/玩家/赛制
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'主牌\n4 曳物波尬\n3 幽寂\n\n备牌\n2 损耗 // 穿破'}
          spellCheck={false}
        />
        <div className="row spread wrap" style={{ marginTop: 10 }}>
          <span className="small muted">
            {parsed.ok ? (
              <>主牌 {totals.main} 张{totals.side ? ` · 备牌 ${totals.side} 张` : ''} · 共 {totals.total} 张</>
            ) : (
              <span style={{ color: 'var(--danger)' }}>{parsed.error}</span>
            )}
          </span>
          <span className="row">
            <button onClick={share} disabled={busy || !parsed.ok}>{busy ? '生成中…' : '分享图'}</button>
            <button className="btn-primary" onClick={save} disabled={!parsed.ok}>保存</button>
            <Link to="/custom"><button>取消</button></Link>
          </span>
        </div>
      </div>
        </>
      )}
    </div>
  )
}
