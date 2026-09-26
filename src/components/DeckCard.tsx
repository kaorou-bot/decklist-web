// 套牌卡片：预览图 + 名次 + 玩家 + 色组
//
// 预览图优先用服务端给的代表卡（representative_card），没有就退到主牌第一张；
// 本机套牌没有卡图字段，靠卡名走 CardImage 的回退链（查 Forge → Scryfall）。
import type { ReactNode } from 'react'
import type { ServerDeck } from '../api/types'
import CardImage from './CardImage'

export function deckPreviewSource(d: Pick<ServerDeck, 'representative_card' | 'mainboard'>) {
  const rep = d.representative_card
  const first = d.mainboard?.[0]
  return {
    url: rep?.image_url ?? first?.image_url ?? null,
    cardId: rep?.card_id ?? first?.card_id ?? null,
    name: rep?.name ?? first?.name ?? null,
  }
}

export function rankClass(place: string | null | undefined): string {
  const n = parseInt(place ?? '', 10)
  if (!n) return ''
  if (n === 1) return 'top1'
  if (n === 2) return 'top2'
  if (n === 3) return 'top3'
  if (n <= 8) return 'top8'
  return ''
}

export function ColorDots({ colors }: { colors?: string[] | null }) {
  if (!colors?.length) return null
  return (
    <span className="color-dots" title={colors.join('')}>
      {colors.map((c) => (
        <span key={c} className={`color-dot ${c}`} />
      ))}
    </span>
  )
}

export default function DeckCard({
  deck,
  onClick,
  action,
}: {
  deck: ServerDeck
  onClick: () => void
  /** 卡片底部的操作按钮（会被阻止冒泡） */
  action?: ReactNode
}) {
  const src = deckPreviewSource(deck)
  const main = deck.mainboard_count ?? deck.mainboard?.length ?? 0
  const side = deck.sideboard_count ?? 0
  return (
    <div
      className="deck-card"
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <CardImage
        className="deck-preview"
        source={src}
        placeholder={<span className="small muted">无图</span>}
        alt=""
        lazy={false}
      />
      <div className="deck-card-body">
        <h3>{deck.deck_name || '未命名套牌'}</h3>
        <div className="deck-meta">
          {deck.place && <span className={`rank-badge ${rankClass(deck.place)}`}>{deck.place}</span>}
          <span className="ellipsis" style={{ maxWidth: 140 }}>
            {deck.player || '—'}
          </span>
          <ColorDots colors={deck.colors} />
        </div>
        <div className="deck-meta" style={{ marginTop: 2 }}>
          <span>主牌 {main}</span>
          {side ? <span>备牌 {side}</span> : null}
        </div>
        {action && (
          <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
    </div>
  )
}
