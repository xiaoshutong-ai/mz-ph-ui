#!/usr/bin/env python3
"""Visual evidence for board v2 (commit 9ff85ab):
1. long task_id no overflow on desktop (1440) and narrow (390)
2. six-person switcher works (name + hash update per member)
3. back navigation works (personal -> overview breadcrumb, overview -> personal#key)
Screenshots -> evidence/. Prints PASS/FAIL per check.
"""
import json, subprocess, time, sys, base64, urllib.request, os

CHROME = '/opt/meta-chromium/chrome'
PORT = 19325
BASE = 'file:///home/hatch/workspace/board-design/'
EV = '/tmp/vevidence/'
os.makedirs(EV, exist_ok=True)
LONG_ID = 'mz-ph-ui/team-board/design-first/current-multitask-20261004'

def main():
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--user-data-dir=/tmp/cdp-prof5', 'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import websocket
        tabs = None
        for _ in range(40):
            try: tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/list', timeout=3)); break
            except Exception: time.sleep(0.5)
        ws = websocket.create_connection(tabs[0]['webSocketDebuggerUrl'], timeout=30)
        mid = 0; errs = []
        def send(m, p=None):
            nonlocal mid; mid += 1
            ws.send(json.dumps({'id': mid, 'method': m, 'params': p or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get('id') == mid: return r
                if r.get('method') == 'Runtime.exceptionThrown': errs.append('E')
        def ev(e):
            r = send('Runtime.evaluate', {'expression': e, 'returnByValue': True})
            return r['result']['result'].get('value')
        def shot(name):
            m = send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True, 'fromSurface': True})
            open(EV+name, 'wb').write(base64.b64decode(m['result']['data']))
        def viewport(w, h):
            send('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': w < 700})
        def overflow_report():
            return ev("""(()=>{const bad=[];document.querySelectorAll('.p-id').forEach(e=>{if(e.scrollWidth>e.clientWidth+1)bad.push(e.innerText.slice(0,20))});
              const page=document.documentElement.scrollWidth>window.innerWidth+1;
              return {pillOverflow:bad,pageOverflow:page}})()""")
        send('Page.enable'); send('Runtime.enable')
        ok = True

        # 1a. desktop overview
        viewport(1440, 2200)
        send('Page.navigate', {'url': BASE+'board-overview.html'}); time.sleep(2)
        r = overflow_report(); print('desktop-overview overflow:', r); ok &= (r['pillOverflow']==[] and not r['pageOverflow'])
        shot('ev-desktop-overview.png')

        # 1b. narrow overview
        viewport(390, 1800)
        send('Page.navigate', {'url': BASE+'board-overview.html'}); time.sleep(2)
        r = overflow_report(); print('narrow-overview overflow:', r); ok &= (r['pillOverflow']==[] and not r['pageOverflow'])
        shot('ev-narrow-overview.png')

        # 1c. narrow personal (long task_id in fields)
        send('Page.navigate', {'url': BASE+'board-personal.html#bi'}); time.sleep(2)
        r = overflow_report(); print('narrow-personal overflow:', r); ok &= (not r['pageOverflow'])
        longid_ok = ev(f"Array.from(document.querySelectorAll('dd')).some(e=>e.innerText.includes('{LONG_ID}'))")
        print('long task_id rendered:', longid_ok); ok &= bool(longid_ok)
        shot('ev-narrow-personal.png')

        # 2. six-person switcher
        viewport(1440, 1200)
        send('Page.navigate', {'url': BASE+'board-personal.html'}); time.sleep(2)
        names = []
        for i in range(6):
            ev(f"document.querySelectorAll('.sw')[{i}].click()"); time.sleep(0.4)
            names.append(ev("document.getElementById('mName').innerText.split(' ')[0]") + ':' + ev("location.hash"))
        print('switcher:', ' | '.join(names))
        ok &= (len(set(n.split(':')[0] for n in names)) == 6 and all(n.split(':')[1].startswith('#') for n in names))
        ev("document.querySelectorAll('.sw')[1].click()"); time.sleep(0.5)
        shot('ev-switcher-mo.png')

        # 3a. back nav: personal -> overview via breadcrumb
        ev("document.querySelector('.crumbs a').click()"); time.sleep(1.5)
        back1 = ev("location.href"); print('breadcrumb-back:', back1.split('/')[-1]); ok &= back1.endswith('board-overview.html')
        shot('ev-back-overview.png')

        # 3b. overview -> personal#key via member link
        ev("document.querySelectorAll('.goto')[2].click()"); time.sleep(1.5)
        fwd = ev("location.href"); print('member-link:', fwd.split('/')[-1]); ok &= fwd.endswith('board-personal.html#zhi')
        print('js-errors:', errs or 'none'); ok &= (errs == [])
        print('RESULT:', 'PASS' if ok else 'FAIL')
        ws.close(); return 0 if ok else 1
    finally:
        proc.terminate()

sys.exit(main())
