const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const rows = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', ''].map((date, index) => ({
  branch: `网点${index}`, province: index === 1 ? '甲省' : '乙省', latest_score_date: date, stagnant_score: 5,
}));
const data = { high_scores_by_date: { '2026-10-21': rows } };
const window = { __JIAOJIAN_DASHBOARD__: data };
const source = fs.readFileSync(path.join(__dirname, '../assets/dashboard.js'), 'utf8')
  .replace('  initialize();', '  window.audit = {state,filteredScores,scoreRecentRange,currentScores};');
vm.runInNewContext(source, { window, document: {}, console, setTimeout, clearTimeout });
const { state, filteredScores, scoreRecentRange, currentScores } = window.audit;
const dates = () => Array.from(filteredScores(), row => row.latest_score_date);
state.date = '2026-10-21';
assert.deepEqual(dates(), ['2026-10-19', '2026-10-20']);
assert.equal(currentScores().length, 5, 'KPI and raw list must not be limited by the card filter');
state.scoreRecentDays = 1;
assert.deepEqual(dates(), ['2026-10-20']);
state.scoreRecentDays = 3;
assert.deepEqual(dates(), ['2026-10-18', '2026-10-19', '2026-10-20']);
state.platformProvince = '甲省';
assert.deepEqual(dates(), ['2026-10-19']);
state.platformQuery = '网点2';
assert.deepEqual(dates(), []);
state.platformProvince = '';
assert.deepEqual(dates(), ['2026-10-20']);
state.platformQuery = '';
state.scoreRecentDays = 0;
assert.equal(filteredScores().length, 5);
assert.deepEqual(Array.from(scoreRecentRange('2026-01-01', 2)), ['2025-12-30', '2025-12-31']);
console.log('Recent deduction range, search/province intersection, all dates and year boundary passed.');
