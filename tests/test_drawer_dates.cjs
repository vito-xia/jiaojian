// Run with Playwright on NODE_PATH and a local Edge installation; no build or external requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = process.env.DASHBOARD_QA_DIR || path.join(root, '_local_analysis', 'score-drawer-qa');
const server = http.createServer((req, res) => {
  const file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
  if (file === 'favicon.ico') { res.writeHead(204); res.end(); return; }
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': (file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8' });
    res.end(fs.readFileSync(target));
  } catch { res.writeHead(404); res.end(); }
});
const outerSnapshot = page => page.evaluate(() => ({
  date: document.querySelector('#dateSelect').value,
  html: ['#kpis', '#kpiRisk', '#scoreBody', '#scorePagination', '#controlBody', '#extremeBody', '#top10Body', '#top10Pagination', '#longOrderBody', '#deliveryControlBody']
    .map(id => document.querySelector(id)?.innerHTML || ''),
  ranges: ['#warningRangeStart', '#warningRangeEnd', '#longOrderRangeStart', '#longOrderRangeEnd'].map(id => document.querySelector(id)?.value),
}));
const drawerReady = (page, date) => page.waitForFunction(day => document.querySelector('#drawerKicker').textContent.includes(day)
  && document.querySelector('#drawerLayer').classList.contains('open'), date);
const closeDrawer = page => page.locator('#closeDrawer').click();
const actualBranches = page => page.locator('#scoreBody .js-branch').allTextContents();

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 30000, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    for (const protocol of ['file', 'http']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(protocol === 'file' ? pathToFileURL(path.join(root, 'dashboard.html')).href : `http://127.0.0.1:${server.address().port}/dashboard.html`);
      await page.waitForFunction(() => window.__JIAOJIAN_DASHBOARD__.delivery_monitor && window.__JIAOJIAN_DASHBOARD__.long_order_trends);
      const date = await page.locator('#dateSelect').inputValue();
      const expected = await page.evaluate(day => {
        const start = new Date(day + 'T12:00:00'); start.setDate(start.getDate() - 1);
        const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        return window.__JIAOJIAN_DASHBOARD__.high_scores_by_date[day].filter(row => row.latest_score_date >= from && row.latest_score_date <= day).map(row => row.branch);
      }, date);
      assert.equal(await page.locator('#scoreRecentDays').inputValue(), '2');
      assert.deepEqual(await actualBranches(page), expected.slice(0, 10));
      const hint = await page.locator('#scoreRecentHint').innerText();
      assert.ok(hint.includes(`${date}（含所选数据日）`));
      if (expected.length > 10) {
        await page.locator('#scorePagination [data-page="2"]').first().click();
        assert.deepEqual(await actualBranches(page), expected.slice(10, 20));
        await page.locator('#scorePagination [data-page="1"]').first().click();
      }
      const unaffected = await page.locator('#controlBody').innerHTML();
      const kpi = await page.locator('#kpiRisk').innerText();
      await page.locator('#scoreRecentDays').selectOption('0');
      const all = await page.evaluate(day => window.__JIAOJIAN_DASHBOARD__.high_scores_by_date[day].map(row => row.branch), date);
      assert.deepEqual(await actualBranches(page), all.slice(0, 10));
      if (all.length > 10) {
        await page.locator('#scorePagination [data-page="2"]').first().click();
        assert.deepEqual(await actualBranches(page), all.slice(10, 20));
      }
      await page.locator('#scoreRecentDays').selectOption('2');
      assert.deepEqual(await actualBranches(page), expected.slice(0, 10));
      assert.equal(await page.locator('#controlBody').innerHTML(), unaffected);
      assert.equal(await page.locator('#kpiRisk').innerText(), kpi);
      if (expected.length) {
        await page.locator('#platformSearch').fill(expected[0]);
        assert.deepEqual(await actualBranches(page), [expected[0]]);
        await page.locator('#platformSearch').fill('');
      }
      await page.locator('.platform-score-card').screenshot({ path: path.join(output, `${protocol}-${width}-scores.png`) });
      for (const platform of ['抖音', '淘宝', '京东', '快手']) {
        if (platform !== '抖音') await page.locator(`#platformSwitcher [data-platform="${platform}"]`).click();
        await page.waitForFunction(p => {
          const data = window.__JIAOJIAN_DASHBOARD__;
          const day = document.querySelector('#dateSelect').value;
          const rows = data.platforms?.[p]?.top60_by_date?.[day] || data.platforms?.[p]?.top10_by_date?.[day];
          return rows?.length && document.querySelector('#top10Body .js-branch')?.dataset.branch === encodeURIComponent(rows[0].branch);
        }, platform);
        await page.locator('#top10Body .js-branch').first().waitFor();
        const before = await outerSnapshot(page);
        await page.locator('#top10Body .js-branch').first().click();
        await drawerReady(page, before.date);
        const available = await page.locator('#drawerDateSelect option').evaluateAll(nodes => nodes.map(node => node.value));
        const today = await page.evaluate(() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        });
        const regularDates = await page.evaluate(p => window.__JIAOJIAN_DASHBOARD__.platforms[p].dates, platform);
        if (!regularDates.includes(today)) assert.equal(available.includes(today), false, 'No T-day snapshot in historical drawer');
        const targetDate = available[1];
        await page.locator('#customerTrendMetric').selectOption('48');
        await page.locator('#drawerDateSelect').selectOption(targetDate);
        await drawerReady(page, targetDate);
        if (await page.locator('#customerTrendMetric').count()) assert.equal(await page.locator('#customerTrendMetric').inputValue(), '48');
        assert.deepEqual(await outerSnapshot(page), before, 'Drawer date changed the outer dashboard');
        const summary = await page.locator('#drawerSummary .summary-tile strong').allTextContents();
        const expectedMetrics = await page.evaluate(({ platform, date, branch }) => {
          const data = window.__JIAOJIAN_DASHBOARD__;
          const start = new Date(date + 'T12:00:00'); start.setDate(start.getDate() - 14);
          const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
          const customers = (data.trends[platform][branch]?.customers || []).filter(c => c.series.some(p => p.date >= from && p.date <= date));
          return [customers.length, customers.reduce((n, c) => n + c.series.filter(p => p.date >= from && p.date <= date).reduce((s, p) => s + p.timeout_36h, 0), 0), customers.reduce((n, c) => n + (c.series.find(p => p.date === date)?.timeout_36h || 0), 0)];
        }, { platform, date: targetDate, branch: await page.locator('#drawerTitle').innerText() });
        assert.deepEqual(summary.slice(0, 3).map(s => Number(s.replace(/[,个]/g, ''))), expectedMetrics);
        await page.locator('#drawerPreviousDate').click();
        await drawerReady(page, available[2]);
        await page.locator('#drawerNextDate').click();
        await drawerReady(page, targetDate);
        assert.deepEqual(await outerSnapshot(page), before);
        if (platform === '抖音') await page.locator('.drawer').screenshot({ path: path.join(output, `${protocol}-${width}-drawer.png`) });
        // Browser focus may scroll the drawer horizontally after using its date buttons.
        await page.locator('.drawer').evaluate(node => { node.scrollLeft = 0; });
        await page.waitForFunction(() => {
          const box = document.querySelector('#drawerDateControl').getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth;
        });
        await closeDrawer(page);
        await page.locator('#top10Body .js-branch').first().click();
        await drawerReady(page, before.date);
        assert.equal(await page.locator('#drawerDateSelect').inputValue(), before.date);
        assert.equal(await page.locator('#customerTrendMetric').inputValue(), '36');
        await page.keyboard.press('Escape');
      }
      await page.locator('#platformSwitcher [data-platform="抖音"]').click();
      await page.locator('#deliveryControlBody .js-branch').first().waitFor();
      const beforeDelivery = await outerSnapshot(page);
      await page.locator('#deliveryControlBody .js-branch').first().click();
      await drawerReady(page, beforeDelivery.date);
      await page.locator('#drawerPreviousDate').click();
      await page.waitForFunction(day => document.querySelector('#drawerDateSelect').value !== day, beforeDelivery.date);
      assert.deepEqual(await outerSnapshot(page), beforeDelivery);
      await closeDrawer(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      console.log(`${protocol} ${width}px: scores, pagination/search, four platforms, independent drawer dates and delivery passed`);
      await context.close();
    }
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
