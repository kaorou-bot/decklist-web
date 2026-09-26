// 牌表里的「选择印刷版本」弹窗
//
// 对齐 Android 端 CardDetailActivity：点开一张牌能看到它的所有印刷版本
// （系列名 + 收藏编号 + 稀有度），选中后卡图与信息栏一起切换。
// 网页端用 chip 列表而不是对话框列表，与查牌页的详情弹窗保持一致。
import { useEffect, useMemo, useState } from 'react'
import { api, lookupCard } from '../api/client'
import type { ForgeCardDetail } from '../api/types'
import CardImage from './CardImage'
import ManaCost from './ManaCost'
import { printingsWithCurrent, RARITY_LABEL, type Printing } from '../lib/cardArt'

/** 一次版本选择的结果 */
export interface VersionPick {
  imageUrl: string | null
  setCode: string | null
  setNameZh: string | null
  collectorNumber: string | null
  rarity: string | null
}

export default function CardVersionDialog(props: {
  /** 英文卡名（查不到 id 时按名字兜底回查） */
  name: string
  nameZh?: string | null
  cardId?: string | null
  /** 牌表当前正在显示的版本（用于高亮 chip、正反面） */
  current?: VersionPick | null
  /** API 给的原始版本，用于「恢复默认」 */
  original?: VersionPick | null
  backImageUrl?: string | null
  isDualFace?: boolean
  onPick: (p: VersionPick | null) => void
  onClose: () => void
}) {
  const { name, nameZh, cardId, current, original, backImageUrl, isDualFace, onPick, onClose } = props
  const [detail, setDetail] = useState<ForgeCardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBack, setShowBack] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      let id = cardId ?? null
      if (!id) {
        try {
          id = (await lookupCard(name))?.id ?? null
        } catch {
          id = null
        }
      }
      if (!id) {
        if (alive) setLoading(false)
        return
      }
      try {
        const d = await api.cardDetail(id)
        if (alive) setDetail(d)
      } catch {
        /* 详情拿不到就只显示当前版本 */
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [cardId, name])

  // 版本列表：当前显示的版本排第一，其余按服务端顺序
  const printings = useMemo<Printing[]>(() => {
    if (detail) {
      const list = printingsWithCurrent({
        image_url: current?.imageUrl ?? detail.image_url,
        set_code: current?.setCode ?? detail.set_code,
        set_name: detail.set_name,
        set_name_zh: current?.setNameZh ?? detail.set_name_zh,
        collector_number: current?.collectorNumber ?? detail.collector_number,
        rarity: current?.rarity ?? detail.rarity,
        printings: detail.printings,
      })
      if (list.length > 0) return list
    }
    const base = current ?? original
    return base ? [base as Printing] : []
  }, [detail, current, original])

  // 高亮到与当前显示一致的那一项（按图 URL 比对，比得上就比编号）
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const cur = current?.imageUrl ?? original?.imageUrl ?? null
    if (!cur) {
      setIndex(0)
      return
    }
    const i = printings.findIndex((p) => p.imageUrl === cur)
    setIndex(i >= 0 ? i : 0)
  }, [printings, current, original])

  const active = printings[Math.min(index, printings.length - 1)] ?? null
  const shown = showBack && backImageUrl ? backImageUrl : active?.imageUrl ?? current?.imageUrl ?? null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <CardImage
            className="modal-art"
            source={{
              url: shown,
              cardId: cardId ?? detail?.id ?? null,
              name,
              setCode: active?.setCode ?? null,
              collectorNumber: active?.collectorNumber ?? null,
              isBack: showBack,
            }}
            placeholder={<span className="small muted">无卡图</span>}
          />
          <div className="modal-info">
            <h2 className="section-title" style={{ fontSize: 18 }}>{nameZh || name}</h2>
            <div className="small muted">{name}</div>

            {detail ? (
              <>
                <div className="row" style={{ marginTop: 6 }}>
                  <ManaCost cost={detail.mana_cost} />
                  {detail.mana_value != null && <span className="small muted">MV {detail.mana_value}</span>}
                </div>
                <div className="small muted">{detail.type_line_zh || detail.type_line}</div>
                {(detail.oracle_text_zh || detail.oracle_text) && (
                  <div className="oracle">{detail.oracle_text_zh || detail.oracle_text}</div>
                )}
                {(detail.power || detail.toughness) && (
                  <div className="small">
                    力量/防御：{detail.power ?? '—'}/{detail.toughness ?? '—'}
                  </div>
                )}
              </>
            ) : (
              <div className="small muted" style={{ marginTop: 6 }}>
                {loading ? '正在读取卡牌信息…' : '未取到卡牌详情，仍可切换版本'}
              </div>
            )}

            <div className="small muted" style={{ marginTop: 6 }}>
              {active?.setNameZh || active?.setName || detail?.set_name_zh || detail?.set_name || '—'}
              {active?.setCode ? `（${active.setCode}）` : ''}
              {active?.collectorNumber ? ` · #${active.collectorNumber}` : ''}
              {active?.rarity ? ` · ${RARITY_LABEL[active.rarity] ?? active.rarity}` : ''}
            </div>

            {isDualFace && backImageUrl && (
              <div className="face-toggle" style={{ marginTop: 6 }}>
                <button className={!showBack ? 'on' : ''} onClick={() => setShowBack(false)}>正面</button>
                <button className={showBack ? 'on' : ''} onClick={() => setShowBack(true)}>背面</button>
              </div>
            )}

            {printings.length > 1 ? (
              <div className="printings">
                <div className="small muted" style={{ width: '100%' }}>
                  共 {printings.length} 个印刷版本，点击切换
                </div>
                {printings.map((p, i) => (
                  <button
                    key={`${p.setCode}-${p.collectorNumber}-${i}`}
                    className={`printing-chip${i === Math.min(index, printings.length - 1) ? ' on' : ''}`}
                    onClick={() => setIndex(i)}
                    title={`${p.setNameZh || p.setName || ''} #${p.collectorNumber ?? ''}`}
                  >
                    <strong>{p.setCode || '—'}</strong>
                    <span className="small">#{p.collectorNumber ?? '—'}</span>
                    <span className="small muted">{RARITY_LABEL[p.rarity ?? ''] ?? p.rarity ?? ''}</span>
                  </button>
                ))}
              </div>
            ) : (
              !loading && <div className="small muted" style={{ marginTop: 6 }}>这张牌只有一个印刷版本</div>
            )}

            <div className="row wrap" style={{ marginTop: 10 }}>
              <button
                className="btn-primary"
                disabled={!active}
                onClick={() => {
                  if (!active) return
                  onPick({
                    imageUrl: active.imageUrl,
                    setCode: active.setCode,
                    setNameZh: active.setNameZh,
                    collectorNumber: active.collectorNumber,
                    rarity: active.rarity,
                  })
                  onClose()
                }}
              >
                使用这个版本
              </button>
              <button onClick={() => { onPick(null); onClose() }}>恢复默认</button>
              <button onClick={onClose}>关闭</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
