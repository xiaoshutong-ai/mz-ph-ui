#!/usr/bin/env python3
"""CDP edge-case verification for board v2 fixes."""
import json, subprocess, time, sys, base64, urllib.request

CHROME = '/opt/meta-chromium/chrome'
PORT = 19322
BASE = 'file:///tmp/boardtest/'

def main():
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
                             '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu',
                             '--disable-dev-shm-usage', '--user-data-dir=/tmp/cdp-profile-boardtest',
                             'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import websocket
        tabs = None
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/list', timeout=3)); break
            except Exception: time.sleep(0.5)
        ws = websocket.create_connection(tabs[0]['webSocketDebuggerUrl'], timeout=30)
        mid = 0
        errors = []
        def send(method, params=None):
            nonlocal mid; mid += 1
            ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get('id') == mid: return r
                if r.get('method') == 'Runtime.exceptionThrown':
                    errors.append(str(r['params']['exceptionDetails'].get('text',''))[:120])
        def ev(expr):
            r = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True})
            return r['result']['result'].get('value')
        def shot(name):
            m = send('Page.captureScreenshot', {'format':'png','captureBeyondViewport':True,'fromSurface':True})
            open(f'/tmp/boardtest/{name}','wb').write(base64.b64decode(m['result']['data']))
        send('Page.enable'); send('Runtime.enable')
        send('Emulation.setDeviceMetricsOverride', {'width':1440,'height':2400,'deviceScaleFactor':1,'mobile':False})

        # 1. overview with edge data
        send('Page.navigate', {'url': BASE+'board-overview.html'}); time.sleep(2)
        print('cards:', ev("document.querySelectorAll('.card').length"))
        print('empty-card-text:', ev("document.querySelectorAll('.card')[7].innerText.slice(0,80)").replace('\n','|'))
        print('empty-presence:', ev("document.querySelectorAll('.card .presence')[7].innerText"))
        print('js-errors-overview:', errors or 'none'); shot('t-overview.png')

        # 2. personal #zz : xss checks
        send('Page.navigate', {'url': BASE+'board-personal.html#zz'}); time.sleep(2)
        print('js-href-links:', ev("document.querySelectorAll('a[href^=\"javascript:\"]').length"))
        print('intercept-msg:', ev("document.body.innerText.includes('已拦截非 http(s) 协议')"))
        print('lt-escaped:', ev("document.body.innerHTML.includes('&lt;script&gt;')"))
        print('script-executed:', ev("!!window.__xss_pwned"))
        print('missing-field-na:', ev("Array.from(document.querySelectorAll('dd .na')).length"))
        print('js-errors-zz:', errors or 'none'); shot('t-personal-zz.png')

        # 3. personal #empty : all sections 0
        send('Page.navigate', {'url': BASE+'board-personal.html#empty'}); time.sleep(2)
        print('empty-sections:', ev("Array.from(document.querySelectorAll('.section .n')).map(e=>e.innerText).join(',')"))
        print('js-errors-empty:', errors or 'none')

        ws.close(); return 0
    finally:
        proc.terminate()

sys.exit(main())
