import { useEffect, useRef, useState } from 'react'
import {
  copyImageToClipboard,
  downloadBlob,
  hasDesktopBridge,
  defaultSaveDir,
  revealPath,
  showToast,
} from '../lib/deckImage'

/**
 * 分享图导出结果面板。
 *
 * 之前是"生成完就静默写盘 + 一条 8 秒浮层提示"，用户（尤其是便携版）根本不知道
 * 图存哪了，看起来就像"只有预览、没有输出"。现在把结果明确成一个面板：
 * 预览 + 保存按钮 + 保存路径 + 打开文件夹 + 复制到剪贴板。
 */
export default function ShareImagePanel(props: {
  blob: Blob
  ext: string
  name: string
  /** 生成完成后自动保存一次（桌面端写「下载」目录）。默认 true */
  autoSave?: boolean
  onClose: () => void
}) {
  const { blob, ext, name, onClose, autoSave = true } = props
  const [url, setUrl] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState<{ dir: string; portable: boolean } | null>(null)
  const desktop = hasDesktopBridge()
  const autoDone = useRef(false)

  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  useEffect(() => {
    if (desktop) defaultSaveDir().then(setDir)
  }, [desktop])

  useEffect(() => {
    if (!autoSave || autoDone.current) return
    autoDone.current = true
    doSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveLabel = desktop ? (dir?.portable ? '保存到「分享图」文件夹' : '保存到下载目录') : '下载图片'

  async function doSave() {
    setBusy(true)
    setNote(null)
    try {
      const p = await downloadBlob(blob, name, 'deck', ext)
      if (p) {
        setSavedPath(p)
        showToast(`已保存到：${p}`)
      } else if (!desktop) {
        setNote('已交给浏览器下载，请看浏览器右下角的下载条')
      } else {
        setNote('保存失败，可改用「复制到剪贴板」或右键预览图另存')
      }
    } finally {
      setBusy(false)
    }
  }

  async function doCopy() {
    setBusy(true)
    setNote(null)
    try {
      const res = await copyImageToClipboard(blob)
      setNote(res.ok ? '已复制到剪贴板，可直接粘贴到微信 / QQ' : `复制失败：${res.error ?? '未知原因'}`)
    } finally {
      setBusy(false)
    }
  }

  async function doReveal() {
    if (!savedPath) return
    const ok = await revealPath(savedPath)
    if (!ok) setNote('打不开文件夹，请手动前往：' + savedPath)
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row spread wrap" style={{ marginBottom: 8 }}>
        <strong>分享图已生成</strong>
        <span className="row wrap">
          <button className="btn-primary" onClick={doSave} disabled={busy}>
            {busy ? '处理中…' : saveLabel}
          </button>
          {desktop && (
            <button onClick={doCopy} disabled={busy}>
              复制到剪贴板
            </button>
          )}
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
              ? `保存位置：程序所在文件夹里的「分享图」目录${dir ? `（${dir.dir}）` : ''}`
              : `保存位置：系统「下载」文件夹${dir ? `（${dir.dir}）` : ''}`
            : '网页版：点「下载图片」后会走浏览器下载'}
        </div>
      )}
      {note && (
        <div className="small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
          {note}
        </div>
      )}

      {url && (
        <img
          src={url}
          alt="分享图"
          style={{ width: '100%', borderRadius: 6, display: 'block' }}
        />
      )}
    </div>
  )
}
