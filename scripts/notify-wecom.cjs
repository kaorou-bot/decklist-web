#!/usr/bin/env node
/* 把桌面端产物通过企业微信发给指定联系人（默认刘端阳）。
 *
 * 用法：
 *   node scripts/notify-wecom.cjs [文件...] [选项]
 *
 * 选项：
 *   --latest          自动挑 release 目录里最新生成的「便携版」exe
 *   --nsis            同时带上同目录的 NSIS 安装器
 *   --md=<文本>       随文件先发一段 markdown 说明
 *   --md-file=<路径>  从文件读取 markdown 说明
 *   --to=<会话名>     目标会话名，默认「刘端阳」
 *   --dry-run         只打印将要发送的内容，不真的发
 *
 * 说明：
 * - 直接用子进程传数组参数调用 wecom-cli，绕开 Git Bash 对中文路径的转码问题
 * - 大文件（70MB+）发送会间歇性失败（errcode -202），所以内置重试
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const NODE = process.execPath
const CLI =
  'C:/Users/Administrator/.workbuddy/binaries/node/cli-connector-packages/node_modules/@wecom/cli/bin/wecom.js'

const ROOT = path.resolve(__dirname, '..')

function cli(args, timeout = 600000) {
  // 必须显式给 stdio：Git Bash 下继承 stdin 会让 spawnSync 报 EBUSY
  const r = spawnSync(NODE, [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  })
  return {
    rc: r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  }
}

function jsonOf(text) {
  const i = text.indexOf('{')
  if (i < 0) return null
  try {
    return JSON.parse(text.slice(i))
  } catch {
    return null
  }
}

function pickSession(name) {
  const r = cli(['message', 'aibot', 'sessions', 'list'], 120000)
  const j = jsonOf(r.out)
  const list = (j && j.sessions) || []
  if (!list.length) throw new Error('取不到会话列表：' + r.out.slice(-300))
  const hit = list.find((s) => (s.chat_name || '').includes(name))
  if (!hit) throw new Error(`会话列表里没有「${name}」，可用：${list.map((s) => s.chat_name).join(' / ')}`)
  return hit
}

function upload(file, type) {
  const payload = { file_path: file }
  if (type) payload.type = type
  const r = cli(['media', 'upload', '--json', JSON.stringify(payload)])
  const j = jsonOf(r.out)
  if (j && j.media_id) return j.media_id
  throw new Error(`上传失败 ${file}：${(r.out || r.err).slice(-300)}`)
}

function send(payload, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    const r = cli(['message', 'aibot', 'send', '--json', JSON.stringify(payload)], 300000)
    const j = jsonOf(r.out)
    const ok = j && (j.errcode === 0 || j.errcode === undefined)
    if (ok) return true
    const msg = (j && (j.errmsg || j.message)) || (r.out || r.err).slice(-200)
    console.log(`  第 ${i} 次发送失败：${String(msg).slice(0, 160)}`)
  }
  return false
}

function sendMarkdown(chatId, content) {
  return send({ chat_id: chatId, msg_type: 'markdown', markdown: { content } })
}

/** 找 release 目录里最新修改的便携版 exe */
function latestPortable() {
  const dirs = fs
    .readdirSync(ROOT)
    .filter((d) => /^release\d*$/.test(d) && fs.statSync(path.join(ROOT, d)).isDirectory())
  let best = null
  for (const d of dirs) {
    const full = path.join(ROOT, d)
    for (const f of fs.readdirSync(full)) {
      if (!/便携版.*\.exe$/.test(f)) continue
      const p = path.join(full, f)
      const st = fs.statSync(p)
      if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs, dir: full }
    }
  }
  return best && best.path
}

function nsisSibling(portablePath) {
  const dir = path.dirname(portablePath)
  const f = fs.readdirSync(dir).find((x) => /\.exe$/.test(x) && !/便携版/.test(x) && !/Setup/.test(x))
  return f ? path.join(dir, f) : null
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { to: '刘端阳', latest: false, nsis: false, md: null, mdFile: null, dry: false }
  const files = []
  for (const a of argv) {
    if (a === '--latest') opt.latest = true
    else if (a === '--nsis') opt.nsis = true
    else if (a.startsWith('--md=')) opt.md = a.slice(5)
    else if (a.startsWith('--md-file=')) opt.mdFile = a.slice(10)
    else if (a.startsWith('--to=')) opt.to = a.slice(5)
    else if (a === '--dry-run') opt.dry = true
    else if (a.startsWith('-')) {
      /* 忽略其余开关 */
    } else files.push(path.resolve(a))
  }

  if (opt.latest && !files.length) {
    const p = latestPortable()
    if (!p) throw new Error('没找到便携版 exe')
    files.push(p)
    if (opt.nsis) {
      const n = nsisSibling(p)
      if (n) files.push(n)
    }
  }
  if (!files.length) throw new Error('没有要发送的文件')

  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error('文件不存在：' + f)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version

  let md = opt.md
  if (opt.mdFile) md = fs.readFileSync(path.resolve(opt.mdFile), 'utf8')
  if (md === null && !files.some((f) => /\.md$/.test(f))) {
    md = `## 万智牌套牌库 桌面端 v${version} 便携版\n` +
      files.map((f) => `> ${path.basename(f)}（${(fs.statSync(f).size / 1048576).toFixed(1)}MB）`).join('\n') +
      '\n\n双击即可运行，无需安装。'
  }

  console.log(`目标会话：${opt.to}`)
  console.log('文件：\n' + files.map((f) => '  ' + f).join('\n'))
  if (opt.dry) {
    console.log('\n[dry-run] 说明内容：\n' + (md || '(无)'))
    return
  }
  const session = pickSession(opt.to)
  console.log(`chat_id：${session.chat_id}`)

  if (md) {
    console.log('发送说明…')
    console.log('  ' + (sendMarkdown(session.chat_id, md) ? 'OK' : '失败'))
  }

  for (const f of files) {
    const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(f)
    const mb = (fs.statSync(f).size / 1048576).toFixed(1)
    console.log(`上传 ${path.basename(f)}（${mb}MB）…`)
    const mid = upload(f, isImg ? 'image' : undefined)
    console.log(`  media_id=${mid.slice(0, 24)}…`)
    console.log(`发送${isImg ? '图片' : '文件'}…`)
    const payload = isImg
      ? { chat_id: session.chat_id, msg_type: 'image', image: { media_id: mid } }
      : { chat_id: session.chat_id, msg_type: 'file', file: { media_id: mid } }
    console.log('  ' + (send(payload) ? 'OK' : '失败（已重试 4 次）'))
  }
}

main()
