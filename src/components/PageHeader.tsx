// 页面标题栏：统一带「返回」按钮
//
// 桌面端（Electron）没有浏览器后退键，详情页 / 编辑器页只能靠这个按钮回去。
// 没有应用内历史（比如直接粘链接打开）时退到 fallback，不会没反应。
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface Props {
  title: ReactNode
  subtitle?: ReactNode
  /** 标题左侧的装饰（比如套牌封面卡图） */
  lead?: ReactNode
  /** 右侧操作区 */
  actions?: ReactNode
  /** 关掉返回按钮（顶层页面用） */
  noBack?: boolean
  /** 无历史可退时去哪，默认首页 */
  fallback?: string
  /** 返回按钮文案 */
  backLabel?: string
}

export function useBack(fallback = '/') {
  const nav = useNavigate()
  const loc = useLocation()
  return () => {
    // location.key 为 'default' 说明这条记录是应用内第一条，没有上一页
    if (loc.key && loc.key !== 'default') nav(-1)
    else nav(fallback, { replace: true })
  }
}

export default function PageHeader({
  title,
  subtitle,
  lead,
  actions,
  noBack,
  fallback = '/',
  backLabel = '返回',
}: Props) {
  const back = useBack(fallback)
  return (
    <div className="page-head">
      <div className="row wrap" style={{ gap: 12 }}>
        {!noBack && (
          <button className="back-btn" onClick={back} title="返回上一页">
            <span className="back-arrow">←</span>
            {backLabel}
          </button>
        )}
        {lead}
        <div className="page-head-text">
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="small muted">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  )
}
