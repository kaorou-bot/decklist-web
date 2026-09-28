/**
 * 桌面壳注入脚本。
 * 只暴露一个能力：把图片数据交给主进程直接写盘。
 *
 * 为什么不用浏览器下载：实测 Electron 里走 `<a download>` + blob URL 的下载通道时，
 * 整个应用会被卡住（进度条不动，连 DevTools 都不再应答）。改成 IPC 写盘后正常。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dlw', {
  // 保存到系统「下载」目录，返回真实路径
  saveImage: (payload) => ipcRenderer.invoke('dlw:save-image', payload),
  // 保存文字牌表（.txt），返回真实路径
  saveText: (payload) => ipcRenderer.invoke('dlw:save-text', payload),
  // 复制图片到系统剪贴板（可直接粘到微信 / QQ 里分享）
  copyImage: (payload) => ipcRenderer.invoke('dlw:copy-image', payload),
  // 在文件管理器里选中刚保存的文件
  showItem: (payload) => ipcRenderer.invoke('dlw:show-item', payload),
  // 「下载」目录在哪，界面上要告诉用户（kind: image | text）
  downloadsDir: (payload) => ipcRenderer.invoke('dlw:downloads-dir', payload),
})
