/**
 * 桌面壳注入脚本。
 * 只暴露一个能力：把图片数据交给主进程直接写盘。
 *
 * 为什么不用浏览器下载：实测 Electron 里走 `<a download>` + blob URL 的下载通道时，
 * 整个应用会被卡住（进度条不动，连 DevTools 都不再应答）。改成 IPC 写盘后正常。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dlw', {
  saveImage: (payload) => ipcRenderer.invoke('dlw:save-image', payload),
})
