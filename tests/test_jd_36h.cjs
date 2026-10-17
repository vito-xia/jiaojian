// Validate actual dashboard functions without browser dependencies.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const point = (date, count, rate) => ({ date, timeout_36h: count, timeout_rate_36h: rate,
  timeout_48h: count === 20 && rate === 1 ? 0 : 200, timeout_rate_48h: count === 20 && rate === 1 ? 0 : 20 });
const series = [point('2026-10-01', 20, 1), point('2026-10-02', 20, 1), point('2026-10-03', 19, 1), point('2026-10-04', 20, .99),
  point('2026-10-15', 0, 0), point('2026-10-16', 20, 1)];
const data = { platforms: { '京东': { dates: series.map(p => p.date) } }, trends: { '京东': { '网点甲': { customers: [{ customer: '客户甲', customer_code: 'C1', series }] } } } };
const window = { __JIAOJIAN_DASHBOARD__: data, devicePixelRatio: 1 };
let source = fs.readFileSync(path.join(__dirname, '../assets/dashboard.js'), 'utf8');
assert.equal((source.match(/  initialize\(\);/g) || []).length, 1);
source = source.replace('  initialize();', '  window.audit = {state,jdRankingCount,isJdControlHit,jdControlRows,jdTrendMetric,jdTimeoutRate,withJdTimeoutRates,drawComboChart};');
vm.runInNewContext(source, { window, document: {}, console, setTimeout, clearTimeout });
const api = window.audit;
api.state.date = '2026-10-16';
api.state.platform = '京东';
assert.equal(api.jdRankingCount({ branch: '网点甲', customer: '客户甲', customer_code: 'C1' }), 2, '15-day inclusive window or 36H rule failed');
assert.equal(api.isJdControlHit(point('2026-10-16', 20, 1)), true);
assert.equal(api.isJdControlHit(point('2026-10-16', 19, 1)), false);
assert.equal(api.isJdControlHit(point('2026-10-16', 20, .99)), false);
api.state.jdThresholdCount = 0; api.state.jdThresholdRate = 0;
assert.equal(api.isJdControlHit(point('2026-10-16', 0, 0)), true, 'A real zero should qualify at zero thresholds');
assert.equal(api.isJdControlHit(point('2026-10-16', 20, null)), false, 'A missing rate should not qualify');
api.state.jdThresholdCount = 20; api.state.jdThresholdRate = 1;
const shift = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const controlSeries = Array.from({ length: 15 }, (_, i) => point(shift('2026-10-02', i), i % 4 === 1 ? 19 : 20, i % 5 === 2 ? .5 : 1));
data.platforms['京东'].dates = controlSeries.map(p => p.date);
data.trends['京东']['网点甲'].customers[0].series = controlSeries;
const expected = controlSeries.filter(current => current.timeout_36h >= 20 && current.timeout_rate_36h >= 1)
  .map(current => ({ data_date: current.date, listing_count: controlSeries.filter(p => p.date >= shift(current.date, -6) && p.date <= current.date && p.timeout_36h >= 20 && p.timeout_rate_36h >= 1).length,
    control_start: shift(current.date, 1), control_end: shift(current.date, 7) })).filter(row => row.listing_count >= 4).reverse();
const actual = JSON.parse(JSON.stringify(api.jdControlRows())).map(({ data_date, listing_count, control_start, control_end }) => ({ data_date, listing_count, control_start, control_end }));
assert.deepEqual(actual, expected, 'Control dates, 7-day counts or 36H hit logic differs from independent enumeration');
const calls = [];
const context = new Proxy({}, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
  return (...args) => calls.push([key, ...args]);
} });
const canvas = { isConnected: true, clientWidth: 740, clientHeight: 228, getContext: () => context };
api.drawComboChart(canvas, [
  { date: '2026-10-13', timeout_48h: 10, timeout_rate_48h: 2 },
  { date: '2026-10-14', timeout_48h: null, timeout_rate_48h: null },
  { date: '2026-10-15', timeout_48h: 0, timeout_rate_48h: 0 },
  { date: '2026-10-16', timeout_48h: 5, timeout_rate_48h: 3 }
], 'timeout_48h', 'timeout_rate_48h');
assert.equal(calls.filter(call => call[0] === 'arc').length, 3, 'Missing rate was drawn as a real zero');
assert.equal(calls.filter(call => call[0] === 'bezierCurveTo').length, 1, 'Curve bridged across a missing rate');
assert.equal(api.jdTrendMetric(96).hours, 36, 'Removed 96H option should fall back to 36H');
assert.equal(api.withJdTimeoutRates({ timeout_36h: 20, timeout_rate_36h: 10, timeout_rate_96h: .5 }).timeout_rate_96h, .5, 'Existing historical 96H fields must remain intact');
console.log(JSON.stringify({ jdWindow: 'passed', thresholds: 'passed', independentControlDates: expected.length, rateGapsAndRealZero: 'passed' }));
