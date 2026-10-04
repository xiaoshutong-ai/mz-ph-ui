#!/usr/bin/env python3
"""CDP verification: [] vs null vs missing tasks + original 17."""
import json, subprocess, time, sys, base64, urllib.request

CHROME = '/opt/meta-chromium/chrome'
PORT = 19323
BASE = 'file:///tmp/boardtest/'
NL = chr(10)

def main():
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
                             '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu',
                             '--disable-dev-shm-usage', '--user-data-dir=/tmp/cdp-profile-boardtest3',
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
            open('/tmp/boardtest/'+name,'wb').write(base64.b64decode(m['result']['data']))
        send('Page.enable'); send('Runtime.enable')
        send('Emulation.setDeviceMetricsOverride', {'width':1440,'height':2400,'deviceScaleFactor':1,'mobile':False})

        send('Page.navigate', {'url': BASE+'board-overview.html'}); time.sleep(2)
        print('cards:', ev("document.querySelectorAll('.card').length"))
        for ci, bi, k in [(6,0,'ez'), (7,1,'en'), (8,2,'em')]:
            pres = ev("document.querySelectorAll('.card .presence')["+str(ci)+"].innerText")
            box = ev("document.querySelectorAll('.card .empty-box')["+str(bi)+"].innerText").replace(NL,' ')
            cnt = ev("document.querySelectorAll('.card .counts')["+str(ci)+"].innerText")
            print(k, '| presence:', pres, '| box:', box[:46], '| counts:', cnt)
        print('first6-no-emptybox:', ev("[...document.querySelectorAll('.card')].slice(0,6).every(c=>!c.querySelector('.empty-box'))"))
        print('js-errors-overview:', errors or 'none'); shot('u-overview.png')

        for k in ['ez','en','em']:
            send('Page.navigate', {'url': BASE+'board-personal.html#'+k}); time.sleep(1.5)
            secs = ev("Array.from(document.querySelectorAll('.section .n')).map(e=>e.innerText).join(',')")
            box0 = ev("document.querySelectorAll('.section .empty-box')[0].innerText").replace(NL,' ')
            sw = ev("Array.from(document.querySelectorAll('.sw')).slice(-3).map(e=>e.innerText).join(' | ')")
            print(k, '| sections:', secs, '| box0:', box0[:40], '| switcher:', sw)
        print('js-errors-personal:', errors or 'none')
        ws.close(); return 0
    finally:
        proc.terminate()

sys.exit(main())
