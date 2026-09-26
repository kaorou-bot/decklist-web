# -*- coding: utf-8 -*-
"""临时脚本：把桌面端产物通过企业微信发给授权人（刘端阳）。

直接用 subprocess 传参，避免 Git Bash 下中文路径被转码。
"""
import json
import subprocess
import sys

NODE = r'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
CLI = r'C:/Users/Administrator/.workbuddy/binaries/node/cli-connector-packages/node_modules/@wecom/cli/bin/wecom.js'

EXE = 'C:/Users/Administrator/WorkBuddy/2026-09-03-16-30-03/projects/decklist-web/release20/万智牌套牌库-0.2.1-x64-便携版.exe'
SAMPLE = 'C:/Users/Administrator/AppData/Local/Temp/dlw-portable-run/分享图/Superior Doomsday.jpg'
CHAT_ID = 'woQiZaDQAA2WxsIs3uXIIocwtzNZt2dQ'


def run(args, timeout=600):
    p = subprocess.run([NODE, CLI] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    return p.returncode, (p.stdout or '').strip(), (p.stderr or '').strip()


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else 'all'

    if step == 'note':
        md = (
            "**上面两个文件的区别**\n"
            "> 1. `万智牌套牌库-0.2.1-x64-便携版.exe`（74.3MB）：单文件，拷到哪都能双击直接跑，不用安装 —— 推荐\n"
            "> 2. `万智牌套牌库-0.2.1-x64.exe`（74.5MB）：NSIS 安装器，中文界面、可选安装路径、建桌面/开始菜单快捷方式\n\n"
            "先发的那张图是实测导出的分享图示例（1600×2054，810KB）。"
        )
        payload = {'chat_id': CHAT_ID, 'msg_type': 'markdown', 'markdown': {'content': md}}
        rc, out, err = run(['message', 'aibot', 'send', '--json', json.dumps(payload, ensure_ascii=False)])
        print('[note] rc=%s ok=%s' % (rc, '"success": true' in out))
        if err:
            print('stderr:', err[:300])
        return

    if step == 'nsis':
        nsis = ('C:/Users/Administrator/WorkBuddy/2026-09-03-16-30-03/projects/'
                'decklist-web/release20/万智牌套牌库-0.2.1-x64.exe')
        rc, out, err = run(['media', 'upload', '--json', json.dumps({'file_path': nsis}, ensure_ascii=False)])
        print('[upload nsis] rc=%s' % rc)
        mid = None
        try:
            mid = json.loads(out).get('media_id')
        except Exception:
            print(out[-400:])
        if not mid:
            print('未取到 media_id:', out[-300:], err[:300])
            return
        for attempt in (1, 2, 3, 4):
            payload = {'chat_id': CHAT_ID, 'msg_type': 'file', 'file': {'media_id': mid}}
            rc2, out2, err2 = run(['message', 'aibot', 'send', '--json', json.dumps(payload, ensure_ascii=False)])
            ok = '"success": true' in out2
            print('[send nsis attempt %d] rc=%s ok=%s' % (attempt, rc2, ok))
            if ok:
                break
            print('  ', out2[-300:].replace('\n', ' '), err2[:200])
        return

    if step == 'retry':
        payload = {'chat_id': CHAT_ID, 'msg_type': 'file',
                   'file': {'media_id': 'mcfbk9Rco2TyuOPnZ8n98nAej9Gd6htSpW--zebqu51r9FZaMS98s1binanFGeS53k'}}
        rc, out, err = run(['message', 'aibot', 'send', '--json', json.dumps(payload, ensure_ascii=False)])
        print('[retry exe] rc=%s' % rc)
        print('  ', out[-400:].replace('\n', ' '))
        if err:
            print('  stderr:', err[:400])
        return

    if step == 'send':
        md = (
            "## 万智牌套牌库 桌面端 v0.2.1 —— 分享图导出已修好\n"
            "**问题**：便携版生成分享图后只有预览，看不到文件输出到哪。\n"
            "**原因**：出图后是静默写盘 + 一条 8 秒就消失的提示；套牌集页 / 编辑器页连预览都没有。\n\n"
            "**修复**\n"
            "> 1. 新增「导出结果面板」：预览 + 保存按钮 + **复制到剪贴板**（可直粘微信/QQ）+ **打开所在文件夹**，并持久显示完整保存路径\n"
            "> 2. 便携版默认存到程序目录下的 **「分享图」文件夹**；写不进去自动退回系统「下载」目录\n"
            "> 3. 修掉面板 `autoSave` 参数缺默认值、导致自动保存根本没执行的 bug\n\n"
            "**实测**：便携版 12 秒出图 1600×2054，落盘 810KB；保存 / 复制 / 打开文件夹三个通道全通。\n"
            "**产物**：下一条是便携版 exe（74.3MB，双击即用），另有 NSIS 安装器 74.5MB。\n"
            "代码已提交并推送 main 与 dev/v5.4.1-web 两个分支。"
        )
        for name, payload in [
            ('markdown', {'chat_id': CHAT_ID, 'msg_type': 'markdown', 'markdown': {'content': md}}),
            ('file(exe)', {'chat_id': CHAT_ID, 'msg_type': 'file',
                           'file': {'media_id': 'mcfbk9Rco2TyuOPnZ8n98nAej9Gd6htSpW--zebqu51r9FZaMS98s1binanFGeS53k'}}),
            ('image(sample)', {'chat_id': CHAT_ID, 'msg_type': 'image',
                               'image': {'media_id': 'mcM-WGP68GQi3xmhlrLJSpFQuY11ZZMEmp3syTE3b847kBPrHLQfJMYok5Z_pqXQle'}}),
        ]:
            rc, out, err = run(['message', 'aibot', 'send', '--json', json.dumps(payload, ensure_ascii=False)])
            ok = '"errcode":0' in out or 'errcode' not in out
            print('[send %s] rc=%s ok=%s' % (name, rc, ok))
            print('  ', out[-300:].replace('\n', ' '))
            if err:
                print('  stderr:', err[:400])
        return

    if step == 'img':
        rc, out, err = run(['media', 'upload', '--json',
                            json.dumps({'file_path': SAMPLE, 'type': 'image'}, ensure_ascii=False)])
        print('[upload as image] rc=%s' % rc)
        print(out[-500:])
        if err:
            print('stderr:', err[:600])
        return

    if step in ('all', 'upload'):
        rc, out, err = run(['media', 'upload', '--json', json.dumps({'file_path': EXE}, ensure_ascii=False)])
        print('[upload exe] rc=%s' % rc)
        print(out[:1200])
        if err:
            print('stderr:', err[:600])
        rc2, out2, err2 = run(['media', 'upload', '--json', json.dumps({'file_path': SAMPLE}, ensure_ascii=False)])
        print('[upload sample jpg] rc=%s' % rc2)
        print(out2[:1200])
        if err2:
            print('stderr:', err2[:600])


if __name__ == '__main__':
    main()
