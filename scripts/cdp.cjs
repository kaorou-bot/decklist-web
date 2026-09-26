// 复用本机已开启调试端口的 Chrome（9222），对页面做一次运行时冒烟
// 用法: node scripts/cdp.cjs <url> [waitMs]
const url = process.argv[2] || 'http://127.0.0.1:4173/'
const waitMs = Number(process.argv[3] || 9000)
const PORT = 9222

async function newTab(target) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(target)}`, {
    method: 'PUT',
  })
  const json = await res.json()
  return json
}

async function main() {
  const tab = await newTab(url)
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })

  await new Promise((r) => ws.onopen = r)
  await send('Page.enable')
  await send('Runtime.enable')
  await new Promise((r) => setTimeout(r, waitMs))

  const evalText = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return res.result?.result?.value ?? res.result?.exceptionDetails?.text ?? ''
  }

  // 可选：先执行一段动作脚本（例如点某个 tab），再等一会截图文本
  const action = process.argv[4]
  if (action) {
    await evalText(action)
    await new Promise((r) => setTimeout(r, Number(process.argv[5] || 8000)))
  }

  console.log('URL     :', await evalText('location.href'))
  console.log('TITLE   :', await evalText('document.title'))
  const body = String(await evalText('document.body.innerText.replace(/\\n+/g, " | ").slice(0, 1600)'))
  console.log('BODY    :', body)
  console.log('NODES   :', await evalText('document.querySelectorAll("*").length'))
  ws.close()
  // 关掉临时标签页
  await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`)
}

main().catch((e) => {
  console.error('ERR', e)
  process.exitCode = 1
})
