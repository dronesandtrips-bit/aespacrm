"""Browser regression with isolated API fixtures; no login, writes or real reminders.
Run against the existing Vite server: python3 tests/agenda-refresh.browser.py
"""
import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path('/tmp/browser/agenda-refresh')

HTML = r'''<html><head><link rel="stylesheet" href="/src/styles.css"></head>
<body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
window.agendaTimers = [];
const originalInterval = window.setInterval.bind(window);
window.setInterval = (callback, delay, ...args) => {
  if (delay === 60000) window.agendaTimers.push(callback);
  return originalInterval(callback, delay, ...args);
};
const React = (await import('/node_modules/.vite/deps/react.js')).default;
const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const componentSource = await (await fetch('/src/routes/_app.agenda.tsx?tsr-split=component')).text();
const sonnerUrl = componentSource.match(/from "([^"]+\/sonner.js[^"]*)"/)[1];
const { Toaster } = await import(sonnerUrl);
const { component } = await import('/src/routes/_app.agenda.tsx?tsr-split=component');
createRoot(document.getElementById('root')).render(
  React.createElement(React.Fragment, null, React.createElement(component), React.createElement(Toaster))
);
</script></body></html>'''


async def check(browser, width):
    context = await browser.new_context(viewport={"width": width, "height": 1800})
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    state = {'calls': 0, 'failure': False, 'delay': False}
    gate = asyncio.Event()

    async def intercept(route):
        url = route.request.url
        if '/agenda-refresh-fixture' in url:
            await route.fulfill(content_type='text/html', body=HTML)
        elif '/src/routes/_app.agenda.tsx' in url and 'tsr-split=component' in url:
            response = await route.fetch()
            source = await response.text()
            source = re.sub(r'import \{ Route \} from "[^"]+";',
                            'const Route = { useSearch: () => ({}) };', source)
            await route.fulfill(response=response, body=source)
        elif '/src/lib/auth-fetch.ts' in url:
            await route.fulfill(content_type='text/javascript', body='export const authFetch = (...args) => fetch(...args);')
        elif '/src/lib/db.ts' in url:
            await route.fulfill(content_type='text/javascript', body='export const contactsDb = { list: async () => [] };')
        elif '/api/public/calendar/events' in url:
            assert route.request.method == 'GET'
            state['calls'] += 1
            if state['delay']:
                await gate.wait()
            events = [{'id': str(i), 'title': f'Fixture appointment {i}',
                       'start': f'2026-01-{(i % 28) + 1:02d}T09:00:00Z',
                       'end': f'2026-01-{(i % 28) + 1:02d}T10:00:00Z',
                       'allDay': False, 'description': '', 'location': '', 'htmlLink': None}
                      for i in range(40)]
            await route.fulfill(status=503 if state['failure'] else 200,
                                content_type='application/json',
                                body=json.dumps({'ok': not state['failure'], 'events': events, 'error': 'fixture offline'}))
        elif '/api/public/calendar/closure' in url:
            assert route.request.method == 'GET'
            await route.fulfill(content_type='application/json', body='{"ok":true,"events":[],"enabled":false}')
        else:
            await route.continue_()

    await page.route('**/*', intercept)
    await page.goto('http://localhost:8080/agenda-refresh-fixture')
    next_week = page.get_by_role('button', name='Próxima semana')
    try:
        await next_week.wait_for(timeout=15000)
    except Exception:
        print('Browser errors:', errors)
        await page.screenshot(path=str(OUT / 'startup-failure.png'))
        raise
    await next_week.click()
    header = next_week.locator('xpath=../../..')
    selected_week = await header.inner_text()
    # Check the scrollable calendar at the reported viewport height.
    await page.set_viewport_size({"width": width, "height": 831})
    await page.evaluate('''() => {
      window.calendarScroller = document.querySelector('[class*="overflow-y-auto"]');
      window.calendarScroller.scrollTop = 300;
    }''')
    before_scroll = await page.evaluate('window.calendarScroller.scrollTop')
    assert before_scroll > 0
    assert await page.evaluate('window.agendaTimers.length') == 1
    state['delay'] = True
    await page.evaluate('window.agendaTimers[0]()')
    await page.wait_for_timeout(200)
    assert state['calls'] == 2
    assert await next_week.count() == 1, 'Refresh removed calendar'
    assert await header.inner_text() == selected_week, 'Week reset during refresh'
    await page.evaluate('window.agendaTimers[0]()')
    await page.wait_for_timeout(200)
    assert state['calls'] == 2, 'Overlapping refresh request'
    gate.set()
    state['delay'] = False
    await page.wait_for_timeout(400)
    assert await header.inner_text() == selected_week
    assert await page.evaluate('window.calendarScroller.isConnected && window.calendarScroller.scrollTop') == before_scroll
    await page.screenshot(path=str(OUT / f'week-{width}.png'))
    await page.get_by_role('button', name='Atualizar', exact=True).click()
    await page.wait_for_timeout(400)
    assert await header.inner_text() == selected_week, 'Manual refresh reset week'
    state['failure'] = True
    await page.evaluate('window.agendaTimers[0]()')
    await page.wait_for_timeout(400)
    assert await page.get_by_text('Falha ao carregar agenda', exact=False).count() == 0
    assert await header.inner_text() == selected_week
    await page.get_by_role('button', name='lista', exact=True).click()
    await page.get_by_text('Fixture appointment 0', exact=True).wait_for()
    await page.evaluate('window.scrollTo(0, 900)')
    list_scroll = await page.evaluate('window.scrollY')
    assert list_scroll > 0
    state['failure'] = False
    await page.evaluate('window.agendaTimers[0]()')
    await page.wait_for_timeout(400)
    assert await page.evaluate('window.scrollY') == list_scroll, 'List scroll reset'
    await page.screenshot(path=str(OUT / f'list-{width}.png'))
    state['failure'] = True
    await page.get_by_role('button', name='Atualizar', exact=True).click()
    await page.get_by_text('Falha ao carregar agenda: fixture offline', exact=True).wait_for()
    assert not errors, errors
    print(f'PASS {width}px: week and scroll preserved; refreshes serialized; background errors silent; manual errors visible')
    await context.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        await check(browser, 1280)
        await check(browser, 390)
        await browser.close()


asyncio.run(main())