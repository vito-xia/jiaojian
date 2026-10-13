// Run with Playwright + Edge available; local file and HTTP only, no business downloads.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
let payload;
vm.runInNewContext(fs.readFileSync(path.join(root, 'data/dashboard_long_order.js'), 'utf8'), {
  window: { __JIAOJIAN_REGISTER_CHUNK__: (name, value) => { payload = value; } }
});
const dates = payload.long_order_meta.source_dates.slice(-7);
const rowsForDate = day => Object.entries(payload.long_order_trends).flatMap(([branch, points]) =>
  points.filter(point => point.date === day).map(point => ({ ...point, branch })))
  .sort((a, b) => (b.abnormal_count ?? -Infinity) - (a.abnormal_count ?? -Infinity)
    || (b.abnormal_rate ?? -Infinity) - (a.abnormal_rate ?? -Infinity)
    || a.source_rank - b.source_rank || a.branch.localeCompare(b.branch, 'zh-CN'));
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const content = fs.readFileSync(file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    const checks = [];
    for (const url of [pathToFileURL(path.join(root, 'dashboard.html')).href,
      `http://127.0.0.1:${server.address().port}/dashboard.html`]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#longOrderBody')?.rows.length === 10);
      for (const day of dates) {
        await page.selectOption('#dateSelect', day);
        await page.waitForFunction(day => document.querySelector('#longOrderDate').textContent.trim() === day, day);
        const displayed = await page.locator('#longOrderBody tr').evaluateAll(rows => rows.map(row => ({
          branch: row.cells[2].querySelector('button').textContent.trim(),
          count: Number(row.cells[4].textContent.replaceAll(',', '').trim()),
          streak: Number(row.cells[3].textContent.trim()),
        })));
        const expected = rowsForDate(day).slice(0, 10).map(row => ({ branch: row.branch, count: row.abnormal_count, streak: row.top10_streak }));
        assert.equal(JSON.stringify(displayed), JSON.stringify(expected), `Date ${day} did not render its current data`);
        assert.equal(await page.locator('#longOrderCount').textContent(), '1000 条');
      }
      await page.locator('#longOrderPagination').getByRole('button', { name: '2', exact: true }).click();
      assert.equal(await page.locator('#longOrderBody tr').first().locator('td').nth(0).textContent(), '11');
      assert.equal(await page.locator('#longOrderBody tr').first().locator('td').nth(3).textContent(), '0');
      const branch = rowsForDate(dates.at(-1))[10].branch;
      await page.fill('#longOrderSearch', branch);
      const found = await page.locator('#longOrderBody tr').evaluateAll((rows, branch) => {
        const row = rows.find(row => row.cells[2].querySelector('button')?.textContent.trim() === branch);
        return row ? { rank: row.cells[0].textContent.trim(), streak: row.cells[3].textContent.trim() } : null;
      }, branch);
      assert.deepEqual(found, { rank: '11', streak: '0' });
      await page.locator('#clearLongOrderSearch').click();
      await page.locator('#longOrderBody .js-branch').first().click();
      await page.waitForFunction(() => document.querySelector('#drawerLayer').getAttribute('aria-hidden') === 'false');
      await page.locator('#closeDrawer').click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.locator('.long-order-table').evaluate(table => ({
          headers: table.tHead.rows[0].cells.length,
          scroll: table.parentElement.scrollWidth > table.parentElement.clientWidth,
        }));
        assert.deepEqual(geometry, { headers: 11, scroll: true });
      }
      assert.deepEqual(errors, []);
      checks.push({ mode: url.startsWith('file:') ? 'file' : 'http', dates, search: true, pagination: true, drawer: true, widths: [1440, 390] });
      await context.close();
    }
    console.log(JSON.stringify({ latest: dates.at(-1), checks }, null, 2));
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
