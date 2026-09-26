// 主题：light / dark / system（跟随系统）
//
// 深色靠 <html data-theme="dark"> 切换 index.css 里的 CSS 变量，
// 所以不用改任何组件样式；刷新前就用内联脚本先应用，避免白闪。
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const KEY = 'dlw:theme'

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return 'system'
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** 把 mode 落到 <html data-theme>，返回实际生效的主题 */
export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
  const el = document.documentElement
  el.dataset.theme = resolved
  el.style.colorScheme = resolved
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 忽略 */
  }
  return resolved
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode())
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    applyTheme(readThemeMode()),
  )

  useEffect(() => {
    setResolved(applyTheme(mode))
  }, [mode])

  // 选了「跟随系统」时，系统主题变化要实时跟上
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(applyTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return { mode, setMode, resolved }
}

/** index.html 里的防闪脚本用的字符串（保持与上面逻辑一致） */
export const THEME_BOOTSTRAP = `(function(){try{var m=localStorage.getItem('${KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})()`
