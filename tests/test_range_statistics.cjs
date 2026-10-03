// Run with Node; no browser dependencies. Exercise the actual page functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const data = {
  platforms: { '抖音': { top60_by_date: { '2026-09-02': [{ rank: 1, timeout_36h: 8, timeout_rate_36h: 7.77 }] } } },
  warning_range: { customers: [
    { branch: '甲', customer: '新名', customer_code: 'C1', points: [['2026-09-01', 10, 10, '旧名'], ['2026-09-02', 30, 15]] },
    { branch: '甲', customer: '同名', customer_code: 'C2', points: [['2026-09-01', 50, 10], ['2026-09-01', 5, 10]] },
    { branch: '甲', customer: '同名', customer_code: 'C3', points: [['2026-09-01', 5, 10]] },
    { branch: '甲', customer: '无编码', customer_code: '', points: [['2026-09-01', 6, 3]] },
    { branch: '乙', customer: '真实零', points: [['2026-09-01', 0, 0]] },
    { branch: '丙', customer: '缺量', points: [['2026-09-01', null, 5]] },
    { branch: '丁', customer: '缺率', points: [['2026-09-01', 5, null]] },
    { branch: '戊', customer: '零率', points: [['2026-09-01', 9, 0]] },
  ], branches: { '甲': { current_control: '当前管控', clearout_count: 2 } } },
  branch_score_trends: { '甲': { '物流停滞-揽收端': [{ date: '2026-08-17', score: 9 }, { date: '2026-08-18', score: 2 }, { date: '2026-09-02', score: 1 }] } },
  trends: { '抖音': { '甲': { customers: [
    { customer: '客户A', series: [{ date: '2026-09-02', timeout_36h: 10, timeout_rate_36h: 9 }] },
    { customer: '客户B', series: [{ date: '2026-09-02', timeout_36h: 20, timeout_rate_36h: 3 }] },
  ] } } },
  long_order_meta: { row_limit: 1000 },
  long_order_trends: {
    '甲': [{ date: '2026-09-01', abnormal_count: 10, expected_sign_count: 100, abnormal_rate: 8 },
      { date: '2026-09-02', abnormal_count: 30, expected_sign_count: 200, abnormal_rate: 11, abnormal_level: '高', top10_streak: 2 }],
    '乙': [{ date: '2026-09-01', abnormal_count: 50, expected_sign_count: 250, abnormal_rate: 20 }],
    '丙': [{ date: '2026-09-01', abnormal_count: 0, expected_sign_count: 1, abnormal_rate: 0 }],
    '丁': [{ date: '2026-09-01', abnormal_count: 6, expected_sign_count: null },
      { date: '2026-09-02', abnormal_count: 5, expected_sign_count: 100 }],
    '戊': [{ date: '2026-09-01', abnormal_count: null, expected_sign_count: null }],
    '己': [{ date: '2026-09-01', abnormal_count: 0, expected_sign_count: 0 }],
  },
};
const window = { __JIAOJIAN_DASHBOARD__: data };
const source = fs.readFileSync(path.join(__dirname, '../assets/dashboard.js'), 'utf8');
assert.equal((source.match(/  initialize\(\);/g) || []).length, 1);
vm.runInNewContext(source.replace('  initialize();', `  window.rangeTests = {
  warningRangeRows, longOrderRowsForRange, longOrderRowsForDate, longOrderMetrics,
  sourceCoverage, validateModuleRange, state, resetModuleRanges
};`), { window, document: {}, console, setTimeout, clearTimeout });
const api = window.rangeTests;
const warning = api.warningRangeRows('2026-09-01', '2026-09-02');
const c1 = warning.find(row => row.customer_code === 'C1');
assert.equal(c1.timeout_36h, 40);
assert.ok(Math.abs(c1.timeout_rate_36h - 40 / 300 * 100) < 1e-8);
assert.equal(c1.customer, '新名');
assert.equal(c1.stagnant_score, 3); // 16 days inclusive; Aug17 is excluded.
assert.equal(c1.current_control, '当前管控');
assert.equal(warning[0].customer_code, 'C2'); // End-day absent still ranks first.
assert.equal(warning[0].timeout_36h, 55); // Same-day duplicates are both counted.
assert.equal(warning[0].range_recorded_days, 1);
assert.equal(warning.filter(row => row.customer === '同名').length, 2);
for (const name of ['缺率', '真实零', '缺量', '零率']) {
  assert.equal(warning.find(row => row.customer === name).timeout_rate_36h, null);
}
assert.equal(warning.find(row => row.customer === '真实零').timeout_36h, 0);
assert.equal(warning.find(row => row.customer === '缺量').timeout_36h, null);
assert.equal(warning.at(-1).customer, '缺量');
assert.equal(api.warningRangeRows('2026-09-02', '2026-09-02')[0].timeout_rate_36h, 7.77);
assert.equal(api.warningRangeRows('2026-09-01', '2026-09-02'), warning); // Cached results reused.
assert.equal(api.warningRangeRows('2026-08-31', '2026-09-01').find(row => row.customer_code === 'C1').customer, '旧名');
const long = api.longOrderRowsForRange('2026-09-01', '2026-09-02');
assert.equal(long[0].branch, '乙');
assert.equal(long[0].top10_streak, null);
assert.equal(long[0].abnormal_level, null);
const first = long.find(row => row.branch === '甲');
assert.equal(first.abnormal_count, 40);
assert.equal(first.expected_sign_count, 300);
assert.ok(Math.abs(first.abnormal_rate - 40 / 300 * 100) < 1e-8);
assert.equal(first.top10_streak, 2);
assert.equal(long.find(row => row.branch === '丙').abnormal_rate, 0);
for (const branch of ['丁', '戊', '己']) assert.equal(long.find(row => row.branch === branch).abnormal_rate, null);
assert.equal(api.longOrderRowsForRange('2026-09-02', '2026-09-02')[0].abnormal_rate, 11);
assert.equal(api.longOrderRowsForRange('2026-09-01', '2026-09-02'), long);
const metrics = api.longOrderMetrics('甲', '2026-09-02');
assert.equal(metrics.timeout36h, 20);
assert.equal(metrics.timeoutRate36h, 3);
assert.equal(metrics.recentAverage, 20);
assert.equal(api.longOrderMetrics('乙', '2026-09-02').timeout36h, null);
assert.equal(api.longOrderMetrics('乙', '2026-09-02').recentAverage, 50); // Missing days not zero-filled.
assert.equal(api.sourceCoverage(['2026-09-01', '2026-09-03'], '2026-09-01', '2026-09-03').covered, 2);
assert.equal(api.sourceCoverage(['2026-09-01', '2026-09-03'], '2026-09-01', '2026-09-03').total, 3);
assert.match(api.validateModuleRange('', '2026-09-02', []), /请选择/);
assert.match(api.validateModuleRange('2026-09-02', '2026-09-01', []), /晚于/);
assert.match(api.validateModuleRange('2026-08-31', '2026-09-02', ['2026-09-01', '2026-09-02']), /范围/);
api.resetModuleRanges('2026-09-02');
assert.equal(api.state.warningRangeStart, '2026-09-02');
assert.equal(api.state.longOrderRangeEnd, '2026-09-02');
// Ranges are ranked before filtering and capped independently of end-day ranking.
data.warning_range.customers = Array.from({ length: 65 }, (_, index) => ({ branch: `网点${index}`, customer: `客户${index}`, points: [['2026-09-03', index, 10]] }));
assert.equal(api.warningRangeRows('2026-09-03', '2026-09-04').length, 60);
assert.equal(api.warningRangeRows('2026-09-03', '2026-09-04')[0].timeout_36h, 64);
data.long_order_trends = Object.fromEntries(Array.from({ length: 1005 }, (_, index) => [`机构${index}`, [{ date: '2026-09-03', abnormal_count: index, expected_sign_count: 10000 }]]));
assert.equal(api.longOrderRowsForRange('2026-09-03', '2026-09-04').length, 1000);
assert.equal(api.longOrderRowsForRange('2026-09-03', '2026-09-04')[0].abnormal_count, 1004);
console.log('Range statistics: all assertions passed.');
