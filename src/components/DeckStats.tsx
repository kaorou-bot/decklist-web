// 套牌统计面板 + 起手模拟
import { useMemo, useState } from 'react'
import {
  computeStats,
  type StatCard,
} from '../lib/deckStats'
import { drawOpeningHand } from '../lib/simulate'
import type { CardMeta } from '../lib/enrich'

const COLOR_FILL: Record<string, string> = {
  W: '#f4ecd2',
  U: '#bfe0f5',
  B: '#cfc8cc',
  R: '#f2c3b8',
  G: '#c4dfba',
}
const COLOR_TEXT: Record<string, string> = {
  W: '#8a6d1f',
  U: '#1b5c85',
  B: '#4a4046',
  R: '#96351f',
  G: '#3c6b28',
}

export function DeckStatsView({
  cards,
  enriching,
}: {
  cards: StatCard[]
  enriching?: boolean
}) {
  const [withSideboard, setWithSideboard] = useState(false)
  const stats = useMemo(() => computeStats(cards, withSideboard), [cards, withSideboard])

  return (
    <div className="stats-wrap">
      <div className="row spread wrap" style={{ marginBottom: 10 }}>
        <div className="row">
          <span className="small muted">口径</span>
          <select value={withSideboard ? 'all' : 'main'} onChange={(e) => setWithSideboard(e.target.value === 'all')}>
            <option value="main">仅主牌</option>
            <option value="all">含备牌</option>
          </select>
          {enriching && (
            <span className="row small muted">
              <span className="spinner" /> 元数据补齐中，统计会持续更新
            </span>
          )}
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="总张数" value={String(stats.totalCards)} />
        <Kpi label="单卡种类" value={String(stats.uniqueCards)} />
        <Kpi label="平均法术力值" value={stats.avgManaValue != null ? stats.avgManaValue.toFixed(2) : '—'} />
        <Kpi label="地" value={String(stats.landCount)} />
        <Kpi label="生物" value={String(stats.creatureCount)} />
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h3 className="section-title">法术力曲线</h3>
        <div className="curve">
          {stats.curve.map((b) => (
            <div key={b.bucket} className="curve-col">
              <div className="curve-bar-box">
                <div
                  className="curve-bar"
                  style={{ height: `${Math.round((b.count / stats.curveMax) * 100)}%` }}
                  title={`${b.count} 张`}
                />
              </div>
              <div className="curve-count small">{b.count}</div>
              <div className="curve-label small muted">{b.label}</div>
            </div>
          ))}
        </div>
        {stats.unknownCount > 0 && (
          <div className="small muted">另有 {stats.unknownCount} 张暂无费用数据（元数据补齐后会更新）</div>
        )}
      </section>

      <div className="stats-two">
        <section className="card">
          <h3 className="section-title">颜色分布</h3>
          {stats.colorCount.map((c) => (
            <BarStat
              key={c.code}
              label={c.label}
              count={c.count}
              max={Math.max(1, ...stats.colorCount.map((x) => x.count))}
              fill={COLOR_FILL[c.code]}
              text={COLOR_TEXT[c.code]}
            />
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>按牌张数量统计（混色牌每种颜色各计 1 张）</div>
        </section>

        <section className="card">
          <h3 className="section-title">类别分布</h3>
          {stats.typeCount.length === 0 && <div className="small muted">暂无类别数据</div>}
          {stats.typeCount.map((t) => (
            <BarStat
              key={t.key}
              label={t.label}
              count={t.count}
              max={Math.max(1, ...stats.typeCount.map((x) => x.count))}
            />
          ))}
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label small muted">{label}</div>
    </div>
  )
}

function BarStat({
  label,
  count,
  max,
  fill,
  text,
}: {
  label: string
  count: number
  max: number
  fill?: string
  text?: string
}) {
  return (
    <div className="barstat">
      <div className="barstat-label small">{label}</div>
      <div className="barstat-track">
        <div
          className="barstat-fill"
          style={{
            width: `${Math.round((count / max) * 100)}%`,
            ...(fill ? { background: fill } : {}),
          }}
        />
      </div>
      <div className="barstat-count small" style={text ? { color: text } : undefined}>
        {count}
      </div>
    </div>
  )
}

export function OpeningHandView({
  cards,
  meta,
}: {
  cards: { name: string; quantity: number; nameZh?: string | null; sideboard?: boolean }[]
  meta?: Record<string, CardMeta>
}) {
  const main = useMemo(() => cards.filter((c) => !c.sideboard && c.quantity > 0), [cards])
  const total = main.reduce((s, c) => s + c.quantity, 0)
  const [hand, setHand] = useState<{ name: string; quantity: number; nameZh?: string | null }[]>([])
  const [error, setError] = useState<string | null>(null)

  const redraw = () => {
    try {
      const drawn = drawOpeningHand(main, 7)
      setHand(drawn)
      setError(null)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  if (total < 7) {
    return <div className="empty">主牌仅 {total} 张，至少需要 7 张才能模拟起手</div>
  }

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn-primary" onClick={redraw}>
          {hand.length > 0 ? '重抽一手' : '抽起手 7 张'}
        </button>
        <span className="small muted">主牌共 {total} 张 · 按份数无放回随机抽取</span>
      </div>
      {error && <div className="error">{error}</div>}
      {hand.length > 0 && (
        <div className="hand-grid">
          {hand.map((c, i) => {
            const m = meta?.[c.name]
            const img = m?.imageUrl ?? null
            return (
              <div key={`${c.name}-${i}`} className="hand-card">
                <div className="hand-img">
                  {img ? <img src={img} alt="" loading="lazy" /> : <span className="small muted">无卡图</span>}
                </div>
                <div className="hand-name small">{c.nameZh || m?.nameZh || c.name}</div>
              </div>
            )
          })}
        </div>
      )}
      {hand.length === 0 && <div className="empty">点击上方按钮抽取一手牌</div>}
    </div>
  )
}
