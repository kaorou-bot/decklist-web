import { useEffect, useState } from 'react'
import { copyText, defaultSaveDir, hasDesktopBridge, revealPath, saveTextFile } from '../lib/deckImage'
import type { DeckTextLang } from '../lib/deckText'

/**
 * 文字牌表导出面板。
 *
 * 与分享图面板同一套思路：结果要看得见、拿得走——
 * 文本框（可手动改 / 全选复制）+ 复制到剪贴板 + 保存成 .txt + 保存路径 + 打开文件夹。
 */
export default function DeckTextPanel(props: {
  text: string
  /** 保存时的文件名（不含扩展名） */
  filename: string
  lang?: DeckTextLang
  onLang?: (lang: DeckTextLang) => void
  onClose: () => void
}) {
  const { text, filename, lang, onLang, onClose } = props
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState<{ dir: string; portable: boolean } | null>(null)
  const desktop = hasDesktopBridge()

  useEffect(() => {
    if (desktop) defaultSaveDir('text').then(setDir)
  }, [desktop])

  async function doSave() {
    setBusy(true)
    setNote(null)
    try {
      const p = await saveTextFile(text, filename)
      if (p) setSavedPath(p)
      else if (!desktop) setNote('已交给浏览器下载，请看浏览器右下角的下载条')
      else setNote('保存失败，可改用「复制到剪贴板」')
    } finally {
      setBusy(false)
    }
  }

  async function doCopy() {
    setBusy(true)
    setNote(null)
    try {
      const res = await copyText(text)
      setNote(res.ok ? '已复制到剪贴板，可直接粘贴到微信 / 牌表网站' : `复制失败：${res.error ?? '未知原因'}`)
    } finally {
      setBusy(false)
    }
  }

  async function doReveal() {
    if (!savedPath) return
    const ok = await revealPath(savedPath)
    if (!ok) setNote('打不开文件夹，请手动前往：' + savedPath)
  }

  const lines = text ? text.split('\n').length : 0

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row spread wrap" style={{ marginBottom: 8 }}>
        <strong>文字牌表（{lines} 行）</strong>
        <span className="row wrap">
          {lang && onLang && (
            <span className="segmented">
              <button className={lang === 'zh' ? 'on' : ''} onClick={() => onLang('zh')}>
                中文牌名
              </button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => onLang('en')}>
                英文牌名
              </button>
            </span>
          )}
          <button className="btn-primary" onClick={doCopy} disabled={busy}>
            复制
          </button>
          <button onClick={doSave} disabled={busy}>
            {busy ? '处理中…' : desktop ? (dir?.portable ? '保存到「牌表」文件夹' : '保存到下载目录') : '下载 txt'}
          </button>
          {savedPath && (
            <button onClick={doReveal} disabled={busy}>
              打开所在文件夹
            </button>
          )}
          <button onClick={onClose}>关闭</button>
        </span>
      </div>

      {savedPath ? (
        <div className="notice" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
          已保存：{savedPath}
        </div>
      ) : (
        <div className="small muted" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
          {desktop
            ? dir?.portable
              ? `保存位置：程序所在文件夹里的「牌表」目录${dir ? `（${dir.dir}）` : ''}`
              : `保存位置：系统「下载」文件夹${dir ? `（${dir.dir}）` : ''}`
            : '网页版：点「下载 txt」后会走浏览器下载'}
        </div>
      )}
      {note && (
        <div className="small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
          {note}
        </div>
      )}

      <textarea
        readOnly
        value={text}
        rows={Math.min(20, Math.max(8, lines))}
        spellCheck={false}
        style={{
          fontFamily: 'Consolas, "Courier New", monospace',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      />
    </div>
  )
}
