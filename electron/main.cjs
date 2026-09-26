/**
 * decklist-web 桌面壳主进程
 *
 * 设计要点：
 * 1. 不起 file:// —— 内置一个零依赖静态服务器把 dist 伺服在 127.0.0.1 的随机端口上，
 *    这样 origin 是普通 http，localStorage / Canvas CORS / 下载行为与网页版完全一致。
 * 2. asar 打包后 dist 位于 app.asar/dist，Electron 已 patch 过 fs，可直接读。
 * 3. 单实例锁定，重复启动只激活已有窗口。
 */
const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const APP_NAME = '万智牌套牌库'

// 兼容性开关：部分机器（显卡驱动异常 / 远程桌面 / 无 GPU 会话）上 GPU 子进程
// 会在沙箱内直接 0xC0000005 崩溃，Chromium 随后判定 GPU 不可用并终止整个应用。
// 只关掉 GPU 进程的沙箱，渲染进程沙箱保留，代价最小。
app.commandLine.appendSwitch('disable-gpu-sandbox')

// ---- 静态资源根目录 ----------------------------------------------------
function resolveDist() {
  const candidates = [
    path.join(__dirname, '../dist'), // 源码 / asar 内
    path.join(__dirname, '../../dist'),
    path.join(process.resourcesPath || '', 'app', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'index.html'))) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** 启动静态服务器，返回实际监听端口 */
function serveDist(root) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0])
    if (rel === '/' || rel === '') rel = '/index.html'
    // 防目录穿越
    const filePath = path.normalize(path.join(root, rel))
    if (!filePath.startsWith(path.normalize(root))) {
      res.writeHead(403).end('Forbidden')
      return
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) {
        // HashRouter 下只有资源请求，找不到就回 index.html 交给前端处理
        fs.readFile(path.join(root, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found')
          } else {
            res
              .writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
              .end(html)
          }
        })
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      res
        .writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=86400',
        })
        .end(buf)
    })
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    // 端口 0 = 由系统分配空闲端口
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ---- 窗口 --------------------------------------------------------------
let mainWindow = null

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '刷新', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
        { label: '强制刷新', accelerator: 'CmdOrCtrl+F5', click: () => mainWindow && mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: '退出', accelerator: isMac ? 'Cmd+Q' : 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: `${APP_NAME}`,
              detail: `版本 ${app.getVersion()}\nElectron ${process.versions.electron} / Node ${process.versions.node}\n\n数据来源：Forge Card API（play.mtg-forge-kaorou.vip）`,
              buttons: ['确定'],
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#f5f6f8',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      // 静态服务是本地内容，无需 node 集成；保持上下文隔离更安全
      contextIsolated: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // 分享图用 <img crossOrigin="anonymous"> 画 Canvas，这里不额外放宽，
      // 依赖图床 / Scryfall 的 Access-Control-Allow-Origin 头
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外链交给系统浏览器，避免在当前窗口里跳出应用
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target && /^https?:/i.test(target)) {
      shell.openExternal(target)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target && !target.startsWith('http://127.0.0.1')) {
      event.preventDefault()
      shell.openExternal(target)
    }
  })

  // 分享图导出走 blob 下载，给一个默认落到「下载」目录的行为（Electron 默认已会询问）
  mainWindow.webContents.session.on('will-download', (_e, item) => {
    const name = item.getFilename()
    if (name) item.setSavePath(path.join(app.getPath('downloads'), name))
  })

  mainWindow.loadURL(url)
}

// ---- 生命周期 ----------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const root = resolveDist()
    if (!root) {
      dialog.showErrorBox(
        '资源缺失',
        '未找到前端产物 dist/index.html，请重新构建（npm run build）后重试。',
      )
      app.quit()
      return
    }

    // 不发送多余的网路请求头，减少被中间设备干扰的概率
    session.defaultSession.setUserAgent(
      `decklist-web/${app.getVersion()} Electron/${process.versions.electron}`,
    )

    buildMenu()

    let httpServer = null
    try {
      const { server, port } = await serveDist(root)
      httpServer = server
      createWindow(`http://127.0.0.1:${port}/index.html`)
    } catch (err) {
      dialog.showErrorBox('启动失败', `本地服务启动失败：${err && err.message ? err.message : err}`)
      app.quit()
      return
    }

    app.on('before-quit', () => {
      if (httpServer) httpServer.close()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
        createWindow(`http://127.0.0.1:${httpServer.address().port}/index.html`)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
