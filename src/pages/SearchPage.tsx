// 查牌（高级筛选）
//
// 移植 Android SearchViewModel —— 但注意：Forge 卡牌服务端不走 Scryfall 语法
// （实测 name:"Solitude" / mv=5 这类写法返回 0 条），而是用结构化 query 参数：
//   GET /cards?q=&colors=W,U&color_mode=contains&min_mana_value=&max_mana_value=
//       &type=creature&rarity=rare,mythic&set=DSK&page=&page_size=
// 所以这里不再拼 Scryfall 查询串，改为直接传结构化参数（ForgeCardApi.searchCards）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import {
  COLOR_MODE_OPTIONS,
  COLOR_OPTIONS,
  RARITY_OPTIONS,
  TYPE_OPTIONS,
  type CardSearchParams,
  type ForgeCard,
  type ForgeCardDetail,
  type ForgeSet,
} from '../api/types'
import ManaCost from '../components/ManaCost'

interface Filters {
  q: string
  colors: string[]
  colorMode: 'contains' | 'exact' | 'any'
  mvMin: string
  mvMax: string
  type: string
  rarities: string[]
  set: string
}

const emptyFilters: Filters = {
  q: '',
  colors: [],
  colorMode: 'contains',
  mvMin: '',
  mvMax: '',
  type: '',
  rarities: [],
  set: '',
}

export default function SearchPage() {
  // 支持 #/search?q=xxx 直接带入关键词（方便分享 / 与外部链接跳转）
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    q: searchParams.get('q') ?? '',
    type: searchParams.get('type') ?? '',
  }))
  const [sets, setSets] = useState<ForgeSet[]>([])
  const [items, setItems] = useState<ForgeCard[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ForgeCardDetail | null>(null)
  const [showFilters, setShowFilters] = useState(true)

  useEffect(() => {
    api
      .sets(undefined, 300)
      .then((res) => {
        const list = [...(res.items ?? [])].sort((a, b) => (a.release_date ?? '') < (b.release_date ?? '') ? 1 : -1)
        setSets(list)
      })
      .catch(() => setSets([]))
  }, [])

  const params = useMemo<CardSearchParams>(() => {
    const p: CardSearchParams = { page, pageSize: 24 }
    if (filters.q.trim()) p.q = filters.q.trim()
    if (filters.colors.length > 0) {
      p.colors = filters.colors.join(',')
      p.colorMode = filters.colorMode
    }
    const min = filters.mvMin.trim()
    const max = filters.mvMax.trim()
    if (min !== '' && min === max) p.manaValue = Number(min)
    else {
      if (min !== '') p.minManaValue = Number(min)
      if (max !== '') p.maxManaValue = Number(max)
    }
    if (filters.type) p.type = filters.type
    if (filters.rarities.length > 0) p.rarity = filters.rarities.join(',')
    if (filters.set) p.set = filters.set
    return p
  }, [filters, page])

  const hasQuery = useMemo(
    () =>
      filters.q.trim() !== '' ||
      filters.colors.length > 0 ||
      filters.type !== '' ||
      filters.rarities.length > 0 ||
      filters.set !== '' ||
      filters.mvMin !== '' ||
      filters.mvMax !== '',
    [filters],
  )

  const search = useCallback(
    async (nextPage: number) => {
      if (!hasQuery) {
        setItems([])
        setTotal(0)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await api.cardSearch({ ...params, page: nextPage })
        setItems(res.items ?? [])
        setTotal(res.total ?? 0)
        setTotalPages(res.total_pages ?? 1)
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setError(String((e as Error).message ?? e))
      } finally {
        setLoading(false)
      }
    },
    [hasQuery, params],
  )

  useEffect(() => {
    search(page)
  }, [search, page])

  const toggleColor = (code: string) =>
    setFilters((f) => ({
      ...f,
      colors: f.colors.includes(code) ? f.colors.filter((c) => c !== code) : [...f.colors, code],
    }))
  const toggleRarity = (v: string) =>
    setFilters((f) => ({
      ...f,
      rarities: f.rarities.includes(v) ? f.rarities.filter((c) => c !== v) : [...f.rarities, v],
    }))

  const summary = useMemo(() => {
    const parts: string[] = []
    if (filters.q.trim()) parts.push(`关键词：${filters.q.trim()}`)
    if (filters.colors.length > 0)
      parts.push(
        `${COLOR_MODE_OPTIONS.find((o) => o.value === filters.colorMode)?.label ?? ''} ${filters.colors.join('')}`,
      )
    if (filters.mvMin !== '' || filters.mvMax !== '') parts.push(`法术力值 ${filters.mvMin || '0'}–${filters.mvMax || '∞'}`)
    if (filters.type) parts.push(`类别：${TYPE_OPTIONS.find((t) => t.value === filters.type)?.label ?? filters.type}`)
    if (filters.rarities.length > 0)
      parts.push(filters.rarities.map((r) => RARITY_OPTIONS.find((o) => o.value === r)?.label ?? r).join('、'))
    if (filters.set) parts.push(`系列：${filters.set}`)
    return parts.join(' · ')
  }, [filters])

  return (
    <div style={{ paddingTop: 16 }}>
      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div className="row" style={{ flex: 1, minWidth: 260 }}>
          <input
            style={{ flex: 1, minWidth: 180 }}
            placeholder="搜索卡名 / 中文名 / 规则关键词…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1)
                search(1)
              }
            }}
          />
          <button
            className="btn-primary"
            onClick={() => {
              setPage(1)
              if (page === 1) search(1)
            }}
            disabled={loading}
          >
            搜索
          </button>
          <button onClick={() => setShowFilters((v) => !v)}>{showFilters ? '收起筛选' : '展开筛选'}</button>
        </div>
        <div className="row small muted">
          {loading && <span className="spinner" />}
          <span>{hasQuery ? `共 ${total} 张` : '输入关键词或选择筛选条件'}</span>
        </div>
      </div>

      {showFilters && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="filter-grid">
            <div className="filter-block">
              <label className="small muted">颜色</label>
              <div className="row wrap">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.code}
                    className={`chip${filters.colors.includes(c.code) ? ' on' : ''}`}
                    onClick={() => toggleColor(c.code)}
                  >
                    <img
                      src={`https://svgs.scryfall.io/card-symbols/${c.symbol}.svg`}
                      alt=""
                      style={{ width: 15, height: 15 }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
              <select
                value={filters.colorMode}
                onChange={(e) => setFilters((f) => ({ ...f, colorMode: e.target.value as Filters['colorMode'] }))}
                disabled={filters.colors.length === 0}
              >
                {COLOR_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-block">
              <label className="small muted">法术力值</label>
              <div className="row">
                <input
                  style={{ width: 68 }}
                  inputMode="numeric"
                  placeholder="最小"
                  value={filters.mvMin}
                  onChange={(e) => setFilters((f) => ({ ...f, mvMin: e.target.value.replace(/[^\d]/g, '') }))}
                />
                <span className="muted">–</span>
                <input
                  style={{ width: 68 }}
                  inputMode="numeric"
                  placeholder="最大"
                  value={filters.mvMax}
                  onChange={(e) => setFilters((f) => ({ ...f, mvMax: e.target.value.replace(/[^\d]/g, '') }))}
                />
              </div>
            </div>

            <div className="filter-block">
              <label className="small muted">类别</label>
              <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-block">
              <label className="small muted">系列</label>
              <select value={filters.set} onChange={(e) => setFilters((f) => ({ ...f, set: e.target.value }))}>
                <option value="">不限</option>
                {sets.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name_zh || s.name}（{s.code}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-block" style={{ gridColumn: '1 / -1' }}>
              <label className="small muted">稀有度（可多选）</label>
              <div className="row wrap">
                {RARITY_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    className={`chip${filters.rarities.includes(r.value) ? ' on' : ''}`}
                    onClick={() => toggleRarity(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setFilters(emptyFilters)
                    setPage(1)
                  }}
                  className="btn-danger"
                >
                  重置全部筛选
                </button>
              </div>
            </div>
          </div>
          {summary && <div className="small muted" style={{ marginTop: 8 }}>当前条件：{summary}</div>}
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {hasQuery && items.length === 0 && !loading && !error && <div className="empty">没有匹配的卡牌，试试放宽条件</div>}
      {!hasQuery && <div className="empty">支持按名称、规则文本、颜色、费用、类别、稀有度、系列筛选</div>}

      <div className="card-grid">
        {items.map((c) => (
          <button key={c.id} className="search-card" onClick={() => api.cardDetail(c.id).then(setDetail).catch(() => {})}>
            {c.image_url ? (
              <img className="search-card-img" src={c.image_url} alt="" loading="lazy" />
            ) : (
              <div className="search-card-img placeholder small muted">暂无卡图</div>
            )}
            <div className="search-card-body">
              <div className="search-card-title">{c.name_zh || c.name}</div>
              {c.name_zh && <div className="small muted ellipsis">{c.name}</div>}
              <div className="row small" style={{ marginTop: 4 }}>
                <ManaCost cost={c.mana_cost} />
              </div>
              <div className="small muted ellipsis">{c.type_line_zh || c.type_line}</div>
              <div className="small muted">
                {c.set_code ? `${c.set_code}` : ''}
                {c.rarity ? ` · ${RARITY_OPTIONS.find((r) => r.value === c.rarity)?.label ?? c.rarity}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pager">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
            上一页
          </button>
          <span className="small muted">
            第 {page} / {totalPages} 页
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
            下一页
          </button>
        </div>
      )}

      {detail && <CardDialog card={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function CardDialog({ card, onClose }: { card: ForgeCardDetail; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          {card.image_url && <img className="modal-art" src={card.image_url} alt="" />}
          <div className="modal-info">
            <h2 className="section-title" style={{ fontSize: 18 }}>{card.name_zh || card.name}</h2>
            <div className="small muted">{card.name}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <ManaCost cost={card.mana_cost} />
              {card.mana_value != null && <span className="small muted">MV {card.mana_value}</span>}
            </div>
            <div className="small muted">{card.type_line_zh || card.type_line}</div>
            {(card.oracle_text_zh || card.oracle_text) && (
              <div className="oracle">{card.oracle_text_zh || card.oracle_text}</div>
            )}
            {(card.power || card.toughness) && (
              <div className="small">
                力量/防御：{card.power ?? '—'}/{card.toughness ?? '—'}
              </div>
            )}
            {card.loyalty && <div className="small">忠诚：{card.loyalty}</div>}
            <div className="small muted" style={{ marginTop: 6 }}>
              {card.set_name_zh || card.set_name}
              {card.set_code ? `（${card.set_code}）` : ''}
              {card.collector_number ? ` · #${card.collector_number}` : ''}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={onClose}>关闭</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
