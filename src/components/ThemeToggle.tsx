import { useTheme, type ThemeMode } from '../lib/theme'

const OPTIONS: { value: ThemeMode; label: string; title: string }[] = [
  { value: 'system', label: '自动', title: '跟随系统主题' },
  { value: 'light', label: '浅色', title: '始终浅色' },
  { value: 'dark', label: '深色', title: '始终深色' },
]

export default function ThemeToggle() {
  const { mode, setMode } = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="主题">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={mode === o.value ? 'on' : ''}
          title={o.title}
          aria-pressed={mode === o.value}
          onClick={() => setMode(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
