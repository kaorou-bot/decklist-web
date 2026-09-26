/**
 * decklist-web 桌面壳主进程
 *
 * 设计要点：
 * 1. 不起 file:// —— 内置一个零依赖静态服务器把 dist 伺服在 127.0.0.1 的随机端口上，
 *    这样 origin 是普通 http，localStorage / Canvas CORS / 下载行为与网页版完全一致。
 * 2. asar 打包后 dist 位于 app.asar/dist，Electron 已 patch 过 fs，可直接读。
 * 3. 单实例锁定，重复启动只激活已有窗口。
 */
const { app, BrowserWindow, Menu, shell, dialog, session, ipcMain } = require('electron')
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

/** 允许通过 /img 代理下载的图床域名（防 SSRF：只认这几个白名单） */
const IMG_HOSTS = new Set([
  'images.mtg-forge-kaorou.vip',
  'api.scryfall.com',
  'cards.scryfall.io',
])

/**
 * 图片代理：/img?u=<远端图片 URL>
 *
 * 为什么需要它：分享图导出要一次性拉几十张卡图画进 Canvas。浏览器直连跨域图片时
 * 必须带 crossOrigin=anonymous，而实测在部分机器上批量跨域图片加载会把渲染进程
 * 和主进程一起拖住，导出进度条直接卡死。改由主进程代拉、以同源地址返回后，
 * 页面拿到的是同源图片——既不需要 CORS，也不会污染画布，还不依赖图床的 CORS 头。
 */
async function proxyImage(res, rawUrl) {
  let target
  try {
    target = new URL(rawUrl)
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('bad url')
    return
  }
  if (target.protocol !== 'https:' || !IMG_HOSTS.has(target.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('host not allowed')
    return
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const upstream = await fetch(target.href, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
    if (!upstream.ok || !upstream.body) {
      res.writeHead(upstream.status || 502).end()
      return
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(buf)
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err && err.message))
  }
}

/** 在指定端口启动静态服务器 */
function serveDist(root, port) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0])
    if (rel === '/img') {
      const q = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('u')
      if (!q) {
        res.writeHead(400).end('missing u')
        return
      }
      proxyImage(res, q)
      return
    }
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
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/**
 * 选择监听端口。localStorage 按 origin（含端口）隔离，端口必须**跨启动稳定**，
 * 否则套牌集每次重启都会"丢"。优先复用上次用的端口，其次默认 21517，再往后顺延。
 */
async function bindServer(root) {
  const portFile = path.join(app.getPath('userData'), 'serve-port.txt')
  const candidates = []
  try {
    const saved = Number(fs.readFileSync(portFile, 'utf8').trim())
    if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535) candidates.push(saved)
  } catch {
    /* 首次启动没有记录 */
  }
  candidates.push(21517)
  for (let p = 21518; p <= 21650; p++) candidates.push(p)
  for (const port of candidates) {
    // 端口冲突常常是瞬时的（上一个进程刚退出还处于 TIME_WAIT / 正在释放），
    // 快速重试几次比直接跳到下一个端口更好——换端口意味着 localStorage 换 origin。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const server = await serveDist(root, port)
        try {
          fs.mkdirSync(path.dirname(portFile), { recursive: true })
          fs.writeFileSync(portFile, String(port))
        } catch {
          /* 写不进去也无所谓，只是下次换个端口 */
        }
        return { server, port }
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  }
  // 理论上到不了这里；实在不行退回随机端口（localStorage 会随端口失效，但应用可用）
  const server = await serveDist(root, 0)
  return { server, port: server.address().port }
}

// ---- 保存图片（桌面端专用） ---------------------------------------------
//
// 不用浏览器的 `<a download>`：实测 Electron 的下载通道会把整个应用卡住
// （界面不动、DevTools 也不再应答）。改成渲染进程把 base64 发过来、主进程直接写盘。
ipcMain.handle('dlw:save-image', async (_e, payload) => {
  const base64 = payload && payload.base64
  const rawName = (payload && payload.filename) || 'deck.jpg'
  if (typeof base64 !== 'string' || !base64) return { ok: false, error: '没有图片数据' }
  const safe = rawName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'deck.jpg'
  const dir = app.getPath('downloads')
  let target = path.join(dir, safe)
  try {
    let n = 1
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    const ext = dot > 0 ? safe.slice(dot) : ''
    while (fs.existsSync(target) && n < 100) target = path.join(dir, `${stem} (${n++})${ext}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(target, Buffer.from(base64, 'base64'))
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

// ---- 窗口 --------------------------------------------------------------
let mainWindow = null

/**
 * 在页面底部弹一条提示（会被 executeJavaScript 序列化进渲染进程执行）。
 * 独立实现，不依赖前端代码，避免为了一个提示去改页面组件。
 */
function toast(msg) {
  try {
    const old = document.getElementById('dlw-toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.id = 'dlw-toast'
    el.textContent = msg
    el.title = '点击关闭'
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;max-width:80vw;' +
      'background:#1f6feb;color:#fff;padding:10px 16px;border-radius:8px;cursor:pointer;' +
      'font:14px/1.5 "Microsoft YaHei",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)'
    el.onclick = function () {
      el.remove()
    }
    document.body.appendChild(el)
    setTimeout(function () {
      el.remove()
    }, 8000)
  } catch (e) {
    /* 页面正在跳转等情况，忽略 */
  }
}

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
      preload: path.join(__dirname, 'preload.cjs'),
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

  // 分享图等下载：**静默保存到「下载」目录 + 页面内提示**。
  // 这里绝不能用「另存为」对话框：它是模态的，会阻塞主进程的消息循环，
  // 对话框开着时整个应用（包括页面和 DevTools）都会假死，看起来就像导出崩了。
  // 套牌名可能带 / 等非法文件名字符（如 "4/5C Control"），必须净化，否则保存静默失败。
  mainWindow.webContents.session.on('will-download', (_e, item) => {
    const raw = item.getSuggestedFilename() || 'deck.jpg'
    const safe = raw.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'deck.jpg'
    const dir = app.getPath('downloads')
    let target = path.join(dir, safe)
    try {
      let n = 1
      const dot = safe.lastIndexOf('.')
      const stem = dot > 0 ? safe.slice(0, dot) : safe
      const ext = dot > 0 ? safe.slice(dot) : ''
      while (fs.existsSync(target) && n < 100) target = path.join(dir, `${stem} (${n++})${ext}`)
    } catch {
      /* 查不到就直接用原路径 */
    }
    item.setSavePath(target)
    // 注意：这里**不要**在 done 回调里调 executeJavaScript 去弹提示——
    // 实测 Electron 在下载回调里同步往渲染进程注入脚本会把整个应用卡死
    // （进度条不动、连 DevTools 都不再应答）。保存结果改由前端自己提示。
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
    let port = null
    try {
      const bound = await bindServer(root)
      httpServer = bound.server
      port = bound.port
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
        createWindow(`http://127.0.0.1:${port}/index.html`)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
