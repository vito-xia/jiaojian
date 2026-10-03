// Requires Playwright and an installed Edge. No build, network data or source writes.
// Baseline uses HEAD HTML/CSS/JS and identical current data, HTTP Cache-Control: no-store.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const baselineRef = process.env.RANGE_BASELINE_REF || 'HEAD';
const baseline = new Map(['dashboard.html', 'assets/dashboard.css', 'assets/dashboard.js', 'assets/dashboard-loader.js']
  .map(file => [file, execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: root, maxBuffer: 8e6 })]));
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const old = pathname.startsWith('/baseline/');
  const file = pathname.replace(/^\/(baseline|current)\//, '');
  if (file === 'favicon.ico') { res.writeHead(204); res.end(); return; }
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const body = old && baseline.has(file) ? baseline.get(file) : fs.readFileSync(target);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
const median = values => [...values].sort((a, b) => a - b).slice(4, 6).reduce((a, b) => a + b) / 2;
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const ready = page => page.waitForFunction(() => document.querySelector('#pageLoadProgress')?.classList.contains('is-complete'));
const range = async (page, prefix, start, end) => page.evaluate(async ({ prefix, start, end }) => {
  for (const [field, value] of [['Start', start], ['End', end]]) {
    const input = document.querySelector(`#${prefix}Range${field}`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const before = performance.now();
  const title = prefix === 'warning' ? '#top10Date' : '#longOrderDate';
  document.querySelector(`#apply${prefix[0].toUpperCase() + prefix.slice(1)}Range`).click();
  await new Promise(resolve => {
    const complete = () => document.querySelector(title).textContent === `${start} 至 ${end}`
      && !document.querySelector('#applyWarningRange').disabled;
    if (complete()) { resolve(); return; }
    const observer = new MutationObserver(() => { if (complete()) { observer.disconnect(); resolve(); } });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { start: before, end: performance.now(), elapsed: performance.now() - before };
}, { prefix, start, end });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const opens = { baseline: [], current: [] };
    for (let i = 0; i < 10; i++) for (const mode of i % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.addInitScript(() => {
        window.openMetrics = {};
        const observer = new MutationObserver(() => {
          if (!window.openMetrics.first && document.querySelector('#top10Body tr:not(.empty-row)')) window.openMetrics.first = performance.now();
          if (document.querySelector('#pageLoadProgress')?.classList.contains('is-complete')) {
            window.openMetrics.complete = performance.now(); observer.disconnect();
          }
        });
        observer.observe(document, { childList: true, subtree: true, attributes: true });
      });
      await page.goto(`${base}/${mode}/dashboard.html`);
      await ready(page);
      const sample = await page.evaluate(() => ({ ...window.openMetrics,
        warning: document.querySelector('#top10Body').textContent,
        longOrder: document.querySelector('#longOrderBody').textContent,
        kpis: document.querySelector('.kpi-grid').textContent,
        analysis: document.querySelector('#analysisContent').textContent,
        requests: performance.getEntriesByType('resource').filter(entry => /dashboard_.*\.js/.test(entry.name)).map(entry => new URL(entry.name).pathname.split('/').at(-1)),
        warningLoaded: window.__JIAOJIAN_DATA_LOADER__.has('warning-range') }));
      assert.equal(sample.warningLoaded, false);
      assert.deepEqual(failures, []);
      opens[mode].push(sample);
      await context.close();
    }
    const deltas = {};
    for (const field of ['warning', 'longOrder', 'kpis', 'analysis']) assert.equal(opens.current[0][field], opens.baseline[0][field], `Single-day ${field} differs from HEAD`);
    for (const field of ['first', 'complete']) deltas[field] = median(opens.current.map(row => row[field])) - median(opens.baseline.map(row => row[field]));
    assert.deepEqual([...new Set(opens.current.flatMap(row => row.requests))].sort(), [...new Set(opens.baseline.flatMap(row => row.requests))].sort());
    console.log(JSON.stringify({ defaultOpen: { samples: 10, baseline: { first: median(opens.baseline.map(row => row.first)), complete: median(opens.baseline.map(row => row.complete)) }, current: { first: median(opens.current.map(row => row.first)), complete: median(opens.current.map(row => row.complete)) }, medianDeltas: deltas, addedDataRequests: 0 } }));

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/current/dashboard.html`);
    await ready(page);
    const initial = await page.evaluate(() => ({ warning: document.querySelector('#top10Body').textContent, long: document.querySelector('#longOrderBody').textContent, kpis: document.querySelector('.kpi-grid').textContent, date: document.querySelector('#dateSelect').value }));
    await page.evaluate(() => {
      const loader = window.__JIAOJIAN_DATA_LOADER__;
      const load = loader.load;
      loader.load = name => load(name).then(value => { if (name === 'warning-range') window.warningChunkReadyAt = performance.now(); return value; });
    });
    const warningBounds = await page.locator('#warningRangeStart').evaluate(input => ({ start: input.min, end: input.max }));
    const longBounds = await page.locator('#longOrderRangeStart').evaluate(input => ({ start: input.min, end: input.max }));
    const firstApply = await range(page, 'warning', warningBounds.start, warningBounds.end);
    const firstTiming = await page.evaluate(({ start, end }) => {
      const resource = performance.getEntriesByType('resource').find(entry => entry.name.includes('dashboard_warning_range.js'));
      return { total: end - start, download: resource.responseEnd - resource.startTime,
        parseRegisterMerge: window.warningChunkReadyAt - resource.responseEnd, computeRender: end - window.warningChunkReadyAt };
    }, firstApply);
    assert.equal(await page.locator('#longOrderBody').textContent(), initial.long);
    assert.equal(await page.locator('.kpi-grid').textContent(), initial.kpis);
    await range(page, 'longOrder', longBounds.start, longBounds.end);
    const elapsed = { warning: [], longOrder: [] };
    for (let i = 0; i < 10; i++) {
      // Fresh page has empty result caches; load all source data before the timed apply.
      const benchmarkContext = await browser.newContext();
      const benchmarkPage = await benchmarkContext.newPage();
      await benchmarkPage.goto(`${base}/current/dashboard.html`);
      await ready(benchmarkPage);
      await benchmarkPage.evaluate(() => window.__JIAOJIAN_DATA_LOADER__.load('warning-range'));
      for (const [prefix, bounds] of [['warning', warningBounds], ['longOrder', longBounds]]) {
        elapsed[prefix].push((await range(benchmarkPage, prefix, bounds.start, bounds.end)).elapsed);
      }
      await benchmarkContext.close();
    }
    console.log(JSON.stringify({ firstWarningApply: firstTiming, readyApply: { warning: { median: median(elapsed.warning), p95: p95(elapsed.warning) }, longOrder: { median: median(elapsed.longOrder), p95: p95(elapsed.longOrder) } } }));
    assert.ok(deltas.first <= 100 && deltas.complete <= 100, 'Default load exceeds performance budget');
    assert.ok(p95(elapsed.warning) <= 200 && p95(elapsed.longOrder) <= 200, 'Ready range exceeds performance budget');

    // Invalid drafts preserve results. Each range operates independently of the top date.
    const saved = await page.locator('#top10Body').textContent();
    for (const dates of [['', warningBounds.end], [warningBounds.end, warningBounds.start], ['2020-01-01', warningBounds.end]]) {
      await page.evaluate(([start, end]) => { document.querySelector('#warningRangeStart').value = start; document.querySelector('#warningRangeEnd').value = end; document.querySelector('#applyWarningRange').click(); }, dates);
      assert.equal(await page.locator('#top10Body').textContent(), saved);
    }
    await range(page, 'warning', '2026-09-01', '2026-09-20');
    const warningText = await page.locator('#top10Body').textContent();
    const warningRanks = await page.locator('#top10Body tr td:first-child').allTextContents();
    const province = await page.locator('#branchProvinceFilter option').evaluateAll(options => options.find(option => option.value)?.value);
    await page.selectOption('#branchProvinceFilter', province);
    assert.ok((await page.locator('#top10Body tr td:first-child').allTextContents()).every(rank => Number(rank) > 0));
    await page.selectOption('#branchProvinceFilter', '');
    assert.equal(await page.locator('#top10Body').textContent(), warningText);
    assert.deepEqual(await page.locator('#top10Body tr td:first-child').allTextContents(), warningRanks);
    await page.locator('#top10Pagination [data-page="2"]').first().click();
    assert.equal((await page.locator('#top10Body tr td:first-child').allTextContents())[0], '11');
    await page.selectOption('#topPageSize', '20');
    assert.equal(await page.locator('#top10Body tr').count(), 20);
    assert.equal((await page.locator('#top10Body tr td:first-child').allTextContents())[0], '1');
    await page.locator('#top10Body .js-branch').first().click();
    assert.match(await page.locator('#drawerKicker').textContent(), /2026-09-20/);
    assert.equal(await page.locator('#dateSelect').inputValue(), initial.date);
    await page.locator('#closeDrawer').click();
    await range(page, 'longOrder', '2026-09-01', '2026-09-25');
    const warningAfterLongApply = await page.locator('#top10Body').textContent();
    const queryBranch = await page.locator('#longOrderBody .js-branch').first().getAttribute('data-branch');
    await page.fill('#longOrderSearch', decodeURIComponent(queryBranch));
    assert.equal((await page.locator('#longOrderBody tr td:first-child').allTextContents())[0], '1');
    assert.equal(await page.locator('#top10Body').textContent(), warningAfterLongApply);
    await page.fill('#longOrderSearch', '不存在的机构123');
    assert.match(await page.locator('#longOrderBody').textContent(), /暂无匹配/);
    await page.locator('#clearLongOrderSearch').click();
    const longProvince = await page.locator('#longOrderProvinceFilter option').evaluateAll(options => options.find(option => option.value)?.value);
    await page.selectOption('#longOrderProvinceFilter', longProvince);
    assert.ok((await page.locator('#longOrderBody tr td:first-child').allTextContents()).every(rank => Number(rank) > 0));
    await page.selectOption('#longOrderProvinceFilter', '');
    await page.locator('#longOrderPagination [data-page="2"]').first().click();
    assert.equal((await page.locator('#longOrderBody tr td:first-child').allTextContents())[0], '11');
    await page.selectOption('#longOrderPageSize', '20');
    assert.equal(await page.locator('#longOrderBody tr').count(), 20);
    assert.equal((await page.locator('#longOrderBody tr td:first-child').allTextContents())[0], '1');
    await page.locator('#longOrderBody .js-branch').first().click();
    assert.match(await page.locator('#drawerKicker').textContent(), /2026-09-25/);
    await page.locator('#closeDrawer').click();
    await page.selectOption('#dateSelect', '2026-09-30');
    for (const id of ['warningRangeStart', 'warningRangeEnd', 'longOrderRangeStart', 'longOrderRangeEnd']) assert.equal(await page.locator(`#${id}`).inputValue(), '2026-09-30');
    for (const platform of ['淘宝', '京东', '快手', '抖音']) {
      await page.locator(`[data-platform="${platform}"]`).click();
      await page.waitForFunction(platform => window.__JIAOJIAN_DATA_LOADER__.has({ '淘宝': 'platform-taobao', '京东': 'platform-jd', '快手': 'platform-kuaishou', '抖音': 'platform-douyin' }[platform]) && document.querySelector('#dateSelect').value, platform);
      assert.equal(await page.locator('#warningRangeFilter').isVisible(), platform === '抖音');
      assert.equal(await page.locator('#long-order-monitor').isVisible(), platform === '抖音');
    }
    const tday = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    assert.ok(tday);
    await page.selectOption('#dateSelect', tday);
    await page.waitForFunction(() => document.querySelector('#top10Table').classList.contains('tday-columns'));
    assert.equal(await page.locator('#warningRangeFilter').isVisible(), false);
    assert.equal(await page.locator('#long-order-monitor').isVisible(), false);
    await page.selectOption('#dateSelect', initial.date);
    await page.waitForFunction(() => document.querySelector('#top10Table').classList.contains('douyin-columns'));
    if (process.env.RANGE_SCREENSHOT_DIR) {
      await range(page, 'warning', '2026-09-01', '2026-09-20');
      await page.locator('#warningRangeFilter').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.RANGE_SCREENSHOT_DIR, 'range-desktop.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.locator('#warningRangeFilter').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (process.env.RANGE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.RANGE_SCREENSHOT_DIR, 'range-mobile.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    await context.close();

    // Lazy load failure and delayed old requests must leave the displayed result intact.
    for (const failure of [true, false]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let release;
      await page.route('**/dashboard_warning_range.js*', async route => {
        if (failure) { await route.abort(); return; }
        await new Promise(resolve => { release = resolve; });
        await route.continue();
      });
      await page.goto(`${base}/current/dashboard.html`);
      await ready(page);
      const original = await page.locator('#top10Body').textContent();
      await page.evaluate(() => { document.querySelector('#warningRangeStart').value = '2026-09-01'; document.querySelector('#applyWarningRange').click(); });
      if (failure) {
        await page.waitForFunction(() => document.querySelector('#warningStatus').textContent.includes('加载失败'));
        assert.equal(await page.locator('#top10Body').textContent(), original);
        await page.unroute('**/dashboard_warning_range.js*');
        await range(page, 'warning', '2026-09-01', '2026-10-01'); // Retry succeeds.
      } else {
        await page.waitForFunction(() => document.querySelector('#applyWarningRange').disabled);
        await page.selectOption('#dateSelect', '2026-09-30');
        await new Promise(resolve => setTimeout(resolve, 20));
        release();
        await page.waitForFunction(() => window.__JIAOJIAN_DATA_LOADER__.has('warning-range'));
        assert.equal(await page.locator('#warningRangeStart').inputValue(), '2026-09-30');
        assert.equal(await page.locator('#top10Date').textContent(), '2026-09-30');
      }
      await context.close();
    }
    const offline = await browser.newContext();
    const filePage = await offline.newPage();
    const fileErrors = [];
    filePage.on('pageerror', error => fileErrors.push(error.message));
    await filePage.goto(pathToFileURL(path.join(root, 'dashboard.html')).href);
    await ready(filePage);
    assert.equal(await filePage.evaluate(() => window.__JIAOJIAN_DATA_LOADER__.has('warning-range')), false);
    await range(filePage, 'warning', '2026-09-01', '2026-10-01');
    await range(filePage, 'longOrder', '2026-09-01', '2026-10-01');
    assert.deepEqual(fileErrors, []);
    await offline.close();
    console.log('Browser range filters: passed (HTTP, file://, desktop, narrow viewport, failure, retry, stale requests).');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
