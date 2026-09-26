// 单卡使用率（Meta 榜）
//
// 对齐 Android MainActivity 的「单卡使用率」tab：
//   赛制 / 近 N 天（7→Top10、30→Top30）/ 主牌|备牌
// 数据来自 GET /decks/card-usage，已排除基本地，使用率为「包含该卡的套牌占比」。
// 涨跌配色沿用 App：涨 = 红 #BA1A1A，跌 = 绿 #237A3B（与国内习惯一致）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { UsageCard, UsageSnapshot } from '../api/types'

const WINDOWS = [
  { value: 7, label: '近 7 天 · Top 10' },
  { value: 30, label: '近 30 天 · Top 30' },
  { value: 90, label: '近 90 天' },
]

const INCREASE = '#ba1a1a'
const DECREASE = '#237a3b'

export default function MetaPage({
  formats,
  defaultFormat,
}: {
  formats: { code: string; name: string }[]
  defaultFormat: string
}) {
  const [format, setFormat] = useState(defaultFormat)
  const [days, setDays] = useState(30)
  const [board, setBoard] = useState<'mainboard' | 'sideboard'>('mainboard')
  const [data, setData] = useState<UsageSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 赛制列表是异步来的，等到有默认赛制再定一次（对齐 EventsPage 行为）
  useEffect(() => {
    if (defaultFormat) setFormat((cur) => cur || defaultFormat)
  }, [defaultFormat])

  const load = useCallback(async () => {
    if (!format) return
    setLoading(true)
    setError(null)
    try {
      const snapshot = await api.usage(format, days, board)
      setData(snapshot)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [format, days, board])

  useEffect(() => {
    load()
  }, [load])

  const group = useMemo(
    () => data?.groups?.find((g) => g.format_code === format && g.window_days === days && g.board === board) ?? null,
    [data, format, days, board],
  )

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div className="row wrap">
          <label className="small muted">赛制</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          <div className="segmented">
            <button className={board === 'mainboard' ? 'on' : ''} onClick={() => setBoard('mainboard')}>
              主牌
            </button>
            <button className={board === 'sideboard' ? 'on' : ''} onClick={() => setBoard('sideboard')}>
              备牌
            </button>
          </div>
        </div>
        <div className="row small muted">
          {loading && <span className="spinner" />}
          <button onClick={load} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="notice small">
        {data ? (
          <>
            <div>
              统计日期：{data.calculation_date} · 样本 {group?.total_decks ?? 0} 副
              {group ? ` · 区间 ${group.window_start} 至 ${group.window_end}` : ''}
            </div>
            <div>使用率为「包含该卡的套牌占比」，榜单已排除基本地；仅代表 MTGTop8 收录样本。</div>
            {!data.sync_complete && <div>服务器同步未完成，当前显示上次快照。</div>}
          </>
        ) : (
          <div>服务器统计 · 已排除基本地 · 主牌与备牌分别计算</div>
        )}
      </div>

      {!loading && !error && group && group.items.length === 0 && (
        <div className="empty">{(group.total_decks ?? 0) === 0 ? '此期间暂无套牌样本。' : '暂无使用率数据。'}</div>
      )}

      {group && group.items.length > 0 && (
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="usage-list">
            {group.items.map((c) => (
              <UsageRow key={c.name} card={c} max={group.items[0]?.usage_rate ?? 1} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function UsageRow({ card, max }: { card: UsageCard; max: number }) {
  const change = card.usage_rate_change_pp
  return (
    <div className="usage-row">
      <span className="usage-rank">{card.rank}</span>
      {card.image_url ? (
        <img className="card-thumb" src={card.image_url} alt="" loading="lazy" />
      ) : (
        <div className="card-thumb" style={{ background: '#dfe3e8' }} />
      )}
      <div className="usage-main">
        <div className="usage-name">
          {card.name_zh || card.name}
          {card.name_zh && <span className="small muted"> · {card.name}</span>}
        </div>
        <div className="small muted">
          {card.deck_count} 副套牌包含 · 共 {card.copy_count} 张
        </div>
        <div className="usage-track">
          <div className="usage-fill" style={{ width: `${Math.min(100, (card.usage_rate / max) * 100)}%` }} />
        </div>
      </div>
      <div className="usage-rate">
        <div className="usage-pct">{card.usage_rate.toFixed(2)}%</div>
        <div
          className="small"
          style={{ color: change == null ? 'var(--text-sub)' : change > 0 ? INCREASE : change < 0 ? DECREASE : 'var(--text-sub)' }}
        >
          {change == null ? '暂无对比' : change === 0 ? '0.00%' : `${change > 0 ? '+' : ''}${change.toFixed(2)}pp`}
        </div>
      </div>
    </div>
  )
}
