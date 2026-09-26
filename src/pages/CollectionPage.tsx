import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deckTotals, loadDecks, saveDecks, type CustomDeck } from '../lib/storage'
import { downloadBlob, exportDeckImage } from '../lib/deckImage'
import { resolveArtForImages } from '../lib/cardArt'
import { detailPathOf, editorPathOf } from '../lib/localDeck'

export default function CollectionPage() {
  const [decks, setDecks] = useState<CustomDeck[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const nav = useNavigate()

  useEffect(() => setDecks(loadDecks()), [])

  const remove = (id: string) => {
    if (!confirm('确定删除这套自定义套牌？此操作不可撤销。')) return
    const next = decks.filter((d) => d.id !== id)
    setDecks(next)
    saveDecks(next)
  }

  const share = async (d: CustomDeck) => {
    setBusy(d.id)
    setError(null)
    try {
      // 自定义套牌只有卡名，先回查 Forge 拿 URL，再按回退链 probe 出真正可用的图
      const art = await resolveArtForImages(d.cards.map((c) => ({ name: c.name })))
      const withImages = d.cards.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        sideboard: c.sideboard,
        imageUrl: art.get(c.name) ?? null,
      }))
      const t = deckTotals(d.cards)
      const res = await exportDeckImage({
        deckName: d.name,
        subtitle: [d.format, d.player, `主牌 ${t.main}${t.side ? ` · 备牌 ${t.side}` : ''}`].filter(Boolean).join('  ·  '),
        cards: withImages,
      })
      downloadBlob(res.blob, d.name, 'deck')
      if (res.missing > 0) setError(`${res.missing} 张卡图缺失，已用占位替代`)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="row spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="section-title" style={{ fontSize: 20 }}>套牌集</h1>
          <div className="small muted">保存在本机浏览器，换设备或清缓存会丢失</div>
        </div>
        <div className="row">
          <button className="btn-primary" onClick={() => nav('/custom/new')}>新建套牌</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {decks.length === 0 ? (
        <div className="empty">
          还没有自定义套牌。可以在新建，或从赛事列表 / 套牌详情页点「存入套牌集」。
        </div>
      ) : (
        <div className="grid">
          {decks.map((d) => {
            const t = deckTotals(d.cards)
            // 对齐 App：点整张卡片进详情看牌表，编辑 / 分享 / 删除放在卡片内
            const open = () => nav(detailPathOf(d.id))
            return (
              <div
                key={d.id}
                className="deck-card"
                role="link"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    open()
                  }
                }}
              >
                <h3>{d.name || '未命名套牌'}</h3>
                <div className="small muted">
                  {[d.format, d.player].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="small muted">主牌 {t.main}{t.side ? ` · 备牌 ${t.side}` : ''}</div>
                <div className="row wrap" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => nav(editorPathOf(d.id))}>编辑</button>
                  <button onClick={() => share(d)} disabled={busy === d.id}>
                    {busy === d.id ? '生成中…' : '分享图'}
                  </button>
                  <button className="btn-danger" onClick={() => remove(d.id)}>删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
