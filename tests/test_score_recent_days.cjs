const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const rows = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', ''].map((date, index) => ({
  branch: `网点${index}`, province: index === 1 ? '甲省' : '乙省', latest_score_date: date, stagnant_score: index + 3,
  previous_score: 4, two_days_prior_score: 4,
}));
const data = { high_scores_by_date: { '2026-10-21': rows } };
const window = { __JIAOJIAN_DASHBOARD__: data };
const source = fs.readFileSync(path.join(__dirname, '../assets/dashboard.js'), 'utf8')
  .replace('  initialize();', '  window.audit = {state,filteredScores,scoreRecentRange,currentScores,scoreIsNew};');
vm.runInNewContext(source, { window, document: {}, console, setTimeout, clearTimeout });
const { state, filteredScores, scoreRecentRange, currentScores, scoreIsNew } = window.audit;
const dates = () => Array.from(filteredScores(), row => row.latest_score_date);
state.date = '2026-10-21';
assert.deepEqual(dates(), ['2026-10-20', '2026-10-21']);
assert.equal(currentScores().length, 4, 'Default threshold must be four points');
state.scoreRecentDays = 1;
assert.deepEqual(dates(), ['2026-10-21']);
state.scoreRecentDays = 3;
assert.deepEqual(dates(), ['2026-10-19', '2026-10-20', '2026-10-21']);
state.platformProvince = '甲省';
assert.deepEqual(dates(), ['2026-10-19']);
state.platformQuery = '网点2';
assert.deepEqual(dates(), []);
state.platformProvince = '';
assert.deepEqual(dates(), ['2026-10-20']);
state.platformQuery = '';
state.scoreRecentDays = 0;
assert.equal(filteredScores().length, 4);
state.scoreThreshold = 6;
assert.equal(filteredScores().length, 2, 'Custom threshold must filter the KPI/table source');
assert.equal(scoreIsNew({ previous_score: 4, two_days_prior_score: 4, is_new: false }), true, 'NEW follows the selected threshold');
state.scoreThreshold = 4;
assert.equal(scoreIsNew({ previous_score: 4, two_days_prior_score: 4, is_new: true }), false, 'At-threshold history is not NEW');
assert.deepEqual(Array.from(scoreRecentRange('2026-01-01', 2)), ['2025-12-31', '2026-01-01']);
assert.deepEqual(Array.from(scoreRecentRange('2026-03-01', 2)), ['2026-02-28', '2026-03-01']);
assert.deepEqual(Array.from(scoreRecentRange('2026-10-22', 2)), ['2026-10-21', '2026-10-22']);
assert.deepEqual(Array.from(scoreRecentRange('2026-10-22', 1)), ['2026-10-22']);
assert.deepEqual(Array.from(scoreRecentRange('2026-10-22', 0)), []);
state.date = '2026-10-20';
data.high_scores_by_date[state.date] = rows;
state.scoreRecentDays = 2;
assert.deepEqual(dates(), ['2026-10-19', '2026-10-20'], 'Historical anchor moves with the selected date');
console.log('Custom score threshold, recent deduction range, search/province intersection and year boundary passed.');
