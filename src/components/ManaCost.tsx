import { parseManaCost } from '../lib/mana'

export default function ManaCost({ cost }: { cost?: string | null }) {
  const tokens = parseManaCost(cost)
  if (tokens.length === 0) return null
  return (
    <span className="mana" title={cost ?? ''}>
      {tokens.map((t, i) =>
        t.type === 'symbol' ? (
          <img
            key={i}
            src={t.url}
            alt={t.token}
            title={t.token}
            onError={(e) => {
              // 未知符号：回退为纯文本
              const el = e.currentTarget
              el.style.display = 'none'
            }}
          />
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </span>
  )
}
