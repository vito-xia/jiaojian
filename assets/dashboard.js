(() => {
  'use strict';

  const data = window.__JIAOJIAN_DASHBOARD__;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE_SIZE = 10;
  const state = { platform: '抖音', date: '', controlPage: 1, scorePage: 1, branchQuery: '', platformQuery: '' };
  let chartJobs = [];
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function encodeName(value) { return encodeURIComponent(String(value ?? '')); }
  function formatNumber(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function formatRate(value) {
    const amount = Number(value || 0);
    return `${amount.toLocaleString('zh-CN', { minimumFractionDigits: amount && amount < 1 ? 2 : 1, maximumFractionDigits: 2 })}%`;
  }
  function shortDate(value) { return value ? String(value).slice(0, 10) : '—'; }
  function monthLabel(value) {
    const [year, month] = String(value).split('-');
    return year && month ? `${year}年${Number(month)}月` : value;
  }
  function datesForPlatform() { return data.platforms?.[state.platform]?.dates || []; }
  function top10Rows() { return data.platforms?.[state.platform]?.top10_by_date?.[state.date] || []; }
  function currentControls() { return data.controls_by_date?.[state.date] || []; }
  function currentScores() { return data.high_scores_by_date?.[state.date] || []; }
  function filterPlatformRows(rows) {
    const query = String(state.platformQuery || '').trim().toLocaleLowerCase('zh-CN');
    if (!query) return rows;
    return rows.filter(row => [
      row.date,
      row.branch,
      row.parent_name,
      row.control_action,
      row.control_status,
      row.stagnant_score,
      row.clearout_count,
      row.last_clearout_date,
      row.last_clearout_type
    ].map(value => String(value ?? '')).join(' ').toLocaleLowerCase('zh-CN').includes(query));
  }
  function filteredControls() { return filterPlatformRows(currentControls()); }
  function filteredScores() { return filterPlatformRows(currentScores()); }
  function currentDataLabel() { return state.platform === '京东' ? 'T-2' : 'T-1'; }
  function currentWindowLabel() { return state.platform === '京东' ? 'T-8 至 T-2' : 'T-7 至 T-1'; }

  function scoreClass(value) {
    const score = Number(value || 0);
    if (score >= 10) return 'clear';
    if (score >= 6) return 'high';
    if (score >= 3) return 'mid';
    return '';
  }

  function scoreChip(value) {
    if (value === null || value === undefined) return '<span class="score-chip">—</span>';
    return `<span class="score-chip ${scoreClass(value)}">${formatNumber(value)}</span>`;
  }

  function actionPill(action) {
    const labels = {
      '揽收能力预警': ['notice', '揽收预警'],
      '限制面单新签': ['sign', '限制新签'],
      '限制面单取号': ['pickup', '限制取号']
    };
    const [kind, label] = labels[action] || ['none', '暂无管控'];
    return `<span class="action-pill ${kind}">${label}</span>`;
  }

  function rankBadge(rank) {
    const kind = rank === 1 ? 'top' : rank === 2 ? 'second' : rank === 3 ? 'third' : '';
    return `<span class="rank ${kind}">${rank}</span>`;
  }

  function branchButton(branch, parent) {
    return `<button class="branch-button js-branch" type="button" data-branch="${encodeName(branch)}">${escapeHtml(branch)}</button><span class="subline" title="${escapeHtml(parent || branch)}">一级公司 · ${escapeHtml(parent || branch)}</span>`;
  }

  function historyStack(history, maxItems = 6) {
    const months = history?.months || [];
    if (!months.length) return '<span class="history-stack">暂无上榜记录</span>';
    return `<span class="history-stack">${months.slice(-maxItems).map(item => `<span>${monthLabel(item.month)} <b>${item.days}天</b></span>`).join('')}</span>`;
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value;
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
  }


  function initialize() {
    if (!data?.meta || !data?.platforms) {
      setText('#freshness', '数据加载失败');
      $('#top10Body').innerHTML = '<tr class="empty-row"><td>看板数据不存在，请先运行 process_data.py。</td></tr>';
      return;
    }
    const dates = datesForPlatform();
    state.date = dates.includes(data.meta.as_of) ? data.meta.as_of : dates[dates.length - 1] || '';
    bindEvents();
    renderDateSelector();
    renderAll();
  }

  function bindEvents() {
    $('#platformSwitcher').addEventListener('click', event => {
      const button = event.target.closest('[data-platform]');
      if (!button || button.dataset.platform === state.platform) return;
      state.platform = button.dataset.platform;
      state.platformQuery = '';
      $$('.segment', $('#platformSwitcher')).forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      const dates = datesForPlatform();
      state.date = dates.includes(data.meta.as_of) ? data.meta.as_of : dates[dates.length - 1] || '';
      state.controlPage = 1;
      state.scorePage = 1;
      renderDateSelector();
      renderAll();
      showToast(`已切换至${state.platform}平台`);
    });

    $('#dateSelect').addEventListener('change', event => {
      state.date = event.target.value;
      state.controlPage = 1;
      state.scorePage = 1;
      updateDateButtons();
      renderAll();
    });

    $('#platformSearch').addEventListener('input', event => {
      state.platformQuery = event.target.value;
      state.controlPage = 1;
      state.scorePage = 1;
      renderPlatformSearch();
      renderControls();
      renderScores();
    });
    $('#platformSearch').addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.platformQuery) {
        event.stopPropagation();
        state.platformQuery = '';
        event.target.value = '';
        state.controlPage = 1;
        state.scorePage = 1;
        renderPlatformSearch();
        renderControls();
        renderScores();
      }
    });
    $('#clearPlatformSearch').addEventListener('click', () => {
      state.platformQuery = '';
      $('#platformSearch').value = '';
      state.controlPage = 1;
      state.scorePage = 1;
      renderPlatformSearch();
      renderControls();
      renderScores();
      $('#platformSearch').focus();
    });
    $('#branchSearch').addEventListener('input', event => {
      state.branchQuery = event.target.value;
      renderBranchSearch();
    });
    $('#branchSearch').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const firstResult = $('#branchSearchResults .js-branch');
        if (firstResult) {
          event.preventDefault();
          firstResult.click();
        }
      } else if (event.key === 'Escape' && state.branchQuery) {
        event.stopPropagation();
        state.branchQuery = '';
        event.target.value = '';
        renderBranchSearch();
      }
    });
    $('#clearBranchSearch').addEventListener('click', () => {
      state.branchQuery = '';
      $('#branchSearch').value = '';
      renderBranchSearch();
      $('#branchSearch').focus();
    });
    $('#previousDate').addEventListener('click', () => moveDate(-1));
    $('#nextDate').addEventListener('click', () => moveDate(1));
    document.addEventListener('click', event => {
      const branch = event.target.closest('.js-branch');
      if (branch) openDrawer(decodeURIComponent(branch.dataset.branch));
    });

    $('#controlPagination').addEventListener('click', event => changePage(event, 'control'));
    $('#scorePagination').addEventListener('click', event => changePage(event, 'score'));
    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    $('#showQuality').addEventListener('click', openQuality);
    $('#closeQuality').addEventListener('click', closeQuality);
    $('#qualityBackdrop').addEventListener('click', closeQuality);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if ($('#qualityModal').classList.contains('open')) closeQuality();
        else closeDrawer();
      }
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => chartJobs.forEach(job => drawComboChart(job.canvas, job.series)), 120);
    });
  }

  function renderDateSelector() {
    const dates = datesForPlatform();
    setText('#dateWindowLabel', `${currentDataLabel()} 数据日`);
    $('#dateSelect').disabled = !dates.length;
    $('#dateSelect').innerHTML = dates.length
      ? [...dates].reverse().map(day => `<option value="${day}" ${day === state.date ? 'selected' : ''}>${day}</option>`).join('')
      : '<option value="">暂无源数据</option>';
    updateDateButtons();
  }

  function updateDateButtons() {
    const dates = datesForPlatform();
    const index = dates.indexOf(state.date);
    $('#previousDate').disabled = index <= 0;
    $('#nextDate').disabled = index < 0 || index >= dates.length - 1;
  }

  function moveDate(direction) {
    const dates = datesForPlatform();
    const index = dates.indexOf(state.date);
    const next = dates[index + direction];
    if (!next) return;
    state.date = next;
    $('#dateSelect').value = next;
    state.controlPage = 1;
    state.scorePage = 1;
    updateDateButtons();
    renderAll();
  }

  function renderAll() {
    renderMeta();
    renderKpis();
    renderTop10();
    renderBranchSearch();
    renderPlatformModule();
  }

  function renderMeta() {
    const meta = data.meta;
    setText('#freshness', `${currentDataLabel()} 数据日 ${state.date || '—'}`);
    $('#freshness').innerHTML = `<span class="live-dot"></span>${currentDataLabel()} 数据日 ${escapeHtml(state.date || '—')}`;
    const metaItems = [
      `交件数据 ${meta.timeout_start} — ${meta.as_of}`,
      `${currentWindowLabel()} 监控窗口`,
      `${state.platform}平台视图`
    ];
    if (state.platform === '抖音') {
      metaItems.splice(1, 0, `积分更新至 ${meta.score_as_of || '—'}`, `管控更新至 ${meta.control_as_of || '—'}`);
    }
    $('#metaStrip').innerHTML = metaItems.map((item, index) => `<span>${index ? '<i></i>' : ''}${escapeHtml(item)}</span>`).join('');
    setText('#top10Platform', state.platform);
    setText('#top10Date', state.date || '—');
    setText('#warningSubtitle', `${currentDataLabel()} 交件超时 TOP10 客户，点击分部查看全部客户的 ${currentWindowLabel()} 趋势。`);
    setText('#footerMeta', `生成于 ${meta.generated_at} · 本地离线运行`);
  }

  function renderKpis() {
    const rows = top10Rows();
    const total = rows.reduce((sum, row) => sum + Number(row.timeout_36h || 0), 0);
    const branches = new Set(rows.map(row => row.branch)).size;
    setText('#kpiTimeout', formatNumber(total));
    setText('#kpiBranches', `${branches}`);
    setText('#kpiTimeoutNote', `${state.date || '—'} · ${currentDataLabel()} 客户合计`);
    setText('#kpiBranchesNote', `${rows.length} 个客户 / ${branches} 个分部`);

    if (state.platform === '抖音') {
      setText('#kpiRiskLabel', '高积分网点');
      setText('#kpiRisk', `${currentScores().length}`);
      setText('#kpiRiskNote', `${dayRange(state.date, 16)[0]} 至 ${state.date} · ≥ 6分`);
      setText('#kpiControlLabel', '执行中网点管控');
      setText('#kpiControl', `${data.meta.summary.executing_branch_controls}`);
      setText('#kpiControlNote', `当前快照 · 店铺管控 ${data.meta.summary.executing_merchant_controls} 条`);
    } else {
      const withoutFallback = rows.filter(row => row.has_shipping_fallback !== '是').length;
      const parents = new Set(rows.filter(row => row.history_shortage?.months?.length).map(row => row.parent_name)).size;
      setText('#kpiRiskLabel', '未配置发运兜底');
      setText('#kpiRisk', `${withoutFallback}`);
      setText('#kpiRiskNote', 'TOP10 客户内部预警');
      setText('#kpiControlLabel', '历史上榜一级公司');
      setText('#kpiControl', `${parents}`);
      setText('#kpiControlNote', `${state.platform}内部上榜记录`);
    }
  }

  function branchSearchRows(query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return { total: 0, rows: [] };
    const range = new Set(dayRange(state.date));
    const source = data.trends?.[state.platform] || {};
    const rows = Object.entries(source).filter(([branch, branchData]) => {
      const customers = (branchData?.customers || []).map(item => `${item.customer || ''} ${item.customer_code || ''}`).join(' ');
      const haystack = `${branch} ${branchData?.parent_name || ''} ${customers}`.toLocaleLowerCase('zh-CN');
      return haystack.includes(normalized);
    }).map(([branch, branchData]) => {
      const activeCustomers = (branchData.customers || []).map(customer => {
        const points = (customer.series || []).filter(point => range.has(point.date));
        return { customer, points };
      }).filter(item => item.points.length);
      const weekTotal = activeCustomers.reduce((sum, item) => sum + item.points.reduce((subtotal, point) => subtotal + Number(point.timeout_36h || 0), 0), 0);
      const latestTotal = activeCustomers.reduce((sum, item) => sum + Number(item.points.find(point => point.date === state.date)?.timeout_36h || 0), 0);
      const lastActiveDate = activeCustomers.flatMap(item => item.points.map(point => point.date)).sort().at(-1) || '';
      const lowerBranch = branch.toLocaleLowerCase('zh-CN');
      return {
        branch,
        parent: branchData.parent_name || branch,
        customerCount: activeCustomers.length,
        weekTotal,
        latestTotal,
        lastActiveDate,
        exact: lowerBranch === normalized,
        starts: lowerBranch.startsWith(normalized)
      };
    }).sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.starts) - Number(a.starts) || b.weekTotal - a.weekTotal || a.branch.localeCompare(b.branch, 'zh-CN'));
    return { total: rows.length, rows: rows.slice(0, 10) };
  }

  function renderBranchSearch() {
    const input = $('#branchSearch');
    const clear = $('#clearBranchSearch');
    const results = $('#branchSearchResults');
    const query = String(state.branchQuery || '').trim();
    const branchCount = Object.keys(data.trends?.[state.platform] || {}).length;
    if (input.value !== state.branchQuery) input.value = state.branchQuery;
    clear.hidden = !state.branchQuery;
    if (!query) {
      results.hidden = true;
      results.innerHTML = '';
      setText('#branchSearchHint', `覆盖 ${formatNumber(branchCount)} 个网点 · 支持客户、分部与一级公司名称`);
      return;
    }
    const matches = branchSearchRows(query);
    results.hidden = false;
    setText('#branchSearchHint', matches.total ? `找到 ${matches.total} 个匹配网点` : '未找到匹配网点');
    if (!matches.rows.length) {
      results.innerHTML = `<div class="branch-search-empty"><strong>未找到“${escapeHtml(query)}”</strong><span>请尝试缩短关键词，或检查当前平台与数据日期。</span></div>`;
      return;
    }
    results.innerHTML = `<div class="branch-search-results-head"><div><span>SEARCH RESULTS</span><strong>${escapeHtml(query)}</strong></div><p>${matches.total > matches.rows.length ? `共 ${matches.total} 个匹配，优先展示窗口超时量最高的 ${matches.rows.length} 个` : `共 ${matches.total} 个匹配网点`}</p></div>
      <div class="branch-search-results-grid">${matches.rows.map(row => `<button class="branch-search-result js-branch" type="button" data-branch="${encodeName(row.branch)}">
        <span class="branch-search-name"><strong title="${escapeHtml(row.branch)}">${escapeHtml(row.branch)}</strong><small title="${escapeHtml(row.parent)}">一级公司 · ${escapeHtml(row.parent)}</small></span>
        <span class="branch-search-metrics"><span><b>${formatNumber(row.latestTotal)}</b><small>${currentDataLabel()} 36H</small></span><span><b>${formatNumber(row.weekTotal)}</b><small>${currentWindowLabel()} 36H</small></span><span><b>${formatNumber(row.customerCount)}</b><small>窗口客户</small></span></span>
        <span class="branch-search-open">${row.lastActiveDate ? `最近数据 ${shortDate(row.lastActiveDate)}` : '近7天暂无数据'}<i>查看趋势</i></span>
      </button>`).join('')}</div>`;
  }
  function renderTop10() {
    const rows = top10Rows();
    const douyin = state.platform === '抖音';
    const table = $('#top10Table');
    table.style.minWidth = douyin ? '1500px' : '1120px';
    table.classList.toggle('douyin-columns', douyin);
    $('#top10Head').innerHTML = douyin
      ? '<tr><th>排名</th><th>分部 / 一级公司</th><th>客户名称</th><th>36H超时量</th><th>36H超时率</th><th>停滞积分</th><th>当前平台管控</th><th>管控店铺数</th><th>历史清退次数</th><th>最近清退时间</th><th>最近清退类型</th><th>历史缺货情况</th></tr>'
      : '<tr><th>排名</th><th>分部 / 一级公司</th><th>客户名称</th><th>36H超时量</th><th>36H超时率</th><th>24H超时量</th><th>48H超时量</th><th>发运兜底</th><th>历史缺货情况</th></tr>';

    if (!rows.length) {
      const emptyCopy = datesForPlatform().length ? '该日期暂无交件预警数据' : `${state.platform}暂未提供交件源文件`;
      $('#top10Body').innerHTML = `<tr class="empty-row"><td colspan="${douyin ? 12 : 9}">${escapeHtml(emptyCopy)}</td></tr>`;
    } else {
      $('#top10Body').innerHTML = rows.map(row => {
        const customer = `<div class="customer-cell"><span class="customer-name" title="${escapeHtml(row.customer)}">${escapeHtml(row.customer)}</span><span class="inline-tags"><span class="micro-tag ${row.has_shipping_fallback === '是' ? 'yes' : ''}">发运兜底 · ${escapeHtml(row.has_shipping_fallback || '未配置')}</span></span></div>`;
        const common = `<td>${rankBadge(row.rank)}</td><td>${branchButton(row.branch, row.parent_name)}</td><td>${customer}</td><td><span class="metric-number">${formatNumber(row.timeout_36h)}</span></td><td><span class="rate">${formatRate(row.timeout_rate_36h)}</span></td>`;
        if (!douyin) {
          return `<tr>${common}<td>${formatNumber(row.timeout_24h)}</td><td>${formatNumber(row.timeout_48h)}</td><td><span class="micro-tag ${row.has_shipping_fallback === '是' ? 'yes' : ''}">${escapeHtml(row.has_shipping_fallback || '—')}</span></td><td>${historyStack(row.history_shortage)}</td></tr>`;
        }
        return `<tr>${common}<td>${scoreChip(row.stagnant_score)}</td><td>${actionPill(row.current_control)}</td><td>${formatNumber(row.merchant_control_count)}</td><td>${formatNumber(row.clearout_count)}次<span class="subline">本分部 ${formatNumber(row.branch_clearout_count)}次</span></td><td>${shortDate(row.last_clearout_date)}</td><td>${escapeHtml(row.last_clearout_type || '—')}</td><td>${historyStack(row.history_shortage)}</td></tr>`;
      }).join('');
    }

    setText('#warningStatus', douyin ? '聚焦最高风险客户' : '内部交件预警');
    setText('#top10Caption', douyin ? '按 36H 交件超时量降序 · 平台风险字段已联动' : `按 ${currentDataLabel()} 36H 交件超时量降序 · 仅内部预警数据`);
    $('#topLegend').hidden = !douyin;
    $('#top10Footnote').textContent = douyin
      ? '36H 超时率沿用源表数值（源表已省略 %）；历史清退次数按一级公司汇总，分部自身次数在其下方辅助展示。已排除客户名称包含“温宿韵通达”“新疆”“北亩”的记录。'
      : `${state.platform}当前只统计内部交件预警；停滞积分、平台管控与清退字段不参与本平台视图。已排除客户名称包含“温宿韵通达”“新疆”“北亩”的记录。`;
  }

  function renderPlatformModule() {
    const douyin = state.platform === '抖音';
    $('#platform-control').hidden = !douyin;
    $('#platformControlNav').hidden = !douyin;
    if (!douyin) return;
    setText('#controlStatus', '抖音平台数据已接入');
    renderPlatformSearch();
    renderControls();
    renderScores();
  }

  function renderPlatformSearch() {
    const input = $('#platformSearch');
    const clear = $('#clearPlatformSearch');
    const query = String(state.platformQuery || '').trim();
    if (input.value !== state.platformQuery) input.value = state.platformQuery;
    clear.hidden = !state.platformQuery;
    if (!query) {
      setText('#platformSearchHint', `覆盖 ${currentControls().length} 条管控记录 · ${currentScores().length} 个高积分网点`);
      return;
    }
    setText('#platformSearchHint', `找到 ${filteredControls().length} 条管控记录 · ${filteredScores().length} 个高积分网点`);
  }
  function renderControls() {
    const rows = filteredControls();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.controlPage = Math.min(state.controlPage, pages);
    const pageRows = rows.slice((state.controlPage - 1) * PAGE_SIZE, state.controlPage * PAGE_SIZE);
    setText('#controlCount', `${rows.length} 条`);
    $('#controlBody').innerHTML = pageRows.length ? pageRows.map(row => `<tr>
      <td>${shortDate(row.date)}</td>
      <td>${branchButton(row.branch, row.parent_name)}</td>
      <td>${actionPill(row.control_action)}<span class="subline">${escapeHtml(row.control_status || '—')}</span></td>
      <td>${scoreChip(row.stagnant_score)}</td>
      <td>${formatNumber(row.clearout_count)}次</td>
      <td>${shortDate(row.last_clearout_date)}<span class="subline">${escapeHtml(row.last_clearout_type || '—')}</span></td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="6">${state.platformQuery ? '没有匹配当前关键词的管控记录' : '最近 7 天暂无网点维度管控记录'}</td></tr>`;
    renderPagination($('#controlPagination'), state.controlPage, pages, rows.length, 'control');
  }

  function renderScores() {
    const rows = filteredScores();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.scorePage = Math.min(state.scorePage, pages);
    const pageRows = rows.slice((state.scorePage - 1) * PAGE_SIZE, state.scorePage * PAGE_SIZE);
    setText('#scoreCount', `${rows.length} 条`);
    $('#scoreBody').innerHTML = pageRows.length ? pageRows.map(row => {
      const width = Math.min(100, Number(row.stagnant_score || 0) / 12 * 100);
      return `<tr>
        <td>${branchButton(row.branch, row.parent_name)}</td>
        <td><div class="score-track">${scoreChip(row.stagnant_score)}<span class="track"><span class="fill ${row.stagnant_score >= 10 ? 'clear' : ''}" style="width:${width}%"></span></span></div></td>
        <td>${formatNumber(row.clearout_count)}次</td>
        <td>${shortDate(row.last_clearout_date)}<span class="subline">${escapeHtml(row.last_clearout_type || '—')}</span></td>
      </tr>`;
    }).join('') : `<tr class="empty-row"><td colspan="4">${state.platformQuery ? '没有匹配当前关键词的高积分网点' : '滚动 16 天内暂无积分达到 6 分的网点'}</td></tr>`;
    renderPagination($('#scorePagination'), state.scorePage, pages, rows.length, 'score');
  }

  function renderPagination(container, page, pages, total, kind) {
    const visible = [];
    for (let value = 1; value <= pages; value += 1) {
      if (value === 1 || value === pages || Math.abs(value - page) <= 1) visible.push(value);
    }
    let last = 0;
    const numbers = visible.map(value => {
      const gap = value - last > 1 ? '<span class="page-copy">…</span>' : '';
      last = value;
      return `${gap}<button class="page-button ${value === page ? 'active' : ''}" type="button" data-kind="${kind}" data-page="${value}">${value}</button>`;
    }).join('');
    container.innerHTML = `<button class="page-button" type="button" data-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>${numbers}<button class="page-button" type="button" data-kind="${kind}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button><span class="page-copy">共 ${total} 条</span>`;
  }

  function changePage(event, kind) {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (kind === 'control') { state.controlPage = page; renderControls(); }
    else { state.scorePage = page; renderScores(); }
  }

  function dayRange(endDay, count = 7) {
    if (!endDay) return [];
    const end = new Date(`${endDay}T00:00:00`);
    if (Number.isNaN(end.getTime())) return [];
    const dates = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const day = new Date(end);
      day.setDate(end.getDate() - offset);
      dates.push(day.toISOString().slice(0, 10));
    }
    return dates;
  }

  function branchRisk(branch) {
    const candidates = [
      ...top10Rows().filter(row => row.branch === branch),
      ...currentControls().filter(row => row.branch === branch),
      ...currentScores().filter(row => row.branch === branch)
    ];
    return candidates[0] || {};
  }

  function openDrawer(branch) {
    const branchData = data.trends?.[state.platform]?.[branch];
    const parent = branchData?.parent_name || branchRisk(branch).parent_name || branch;
    const range = dayRange(state.date);
    const customers = (branchData?.customers || []).map(customer => {
      const byDate = new Map(customer.series.map(point => [point.date, point]));
      const series = range.map(day => byDate.get(day) || { date: day, timeout_36h: 0, timeout_rate_36h: 0 });
      const hasSourcePoint = series.some(point => byDate.has(point.date));
      const total = series.reduce((sum, point) => sum + Number(point.timeout_36h || 0), 0);
      return { ...customer, series, total, hasSourcePoint };
    }).filter(customer => customer.hasSourcePoint).sort((a, b) => b.total - a.total);
    const risk = branchRisk(branch);
    const history = data.history_all_lookup?.[parent] || { months: [], branches: [], customer_count: 0 };
    const historyRange = new Set(range);
    const historyDetailSupported = state.platform === '抖音' || state.platform === '淘宝';
    const historyRows = historyDetailSupported
      ? (data.history_detail_lookup?.[parent] || []).filter(row => historyRange.has(row.date) && row.platform === state.platform)
      : [];
    const historyCustomerCount = new Set(historyRows.map(row => `${row.platform}|${row.customer}|${row.customer_code}`)).size;
    const latestTotal = customers.reduce((sum, customer) => sum + Number(customer.series.at(-1)?.timeout_36h || 0), 0);
    const weekTotal = customers.reduce((sum, customer) => sum + customer.total, 0);

    setText('#drawerKicker', `${state.platform} · ${currentWindowLabel()}`);
    setText('#drawerTitle', branch);
    setText('#drawerParent', `一级公司 · ${parent}`);
    $('#drawerSummary').innerHTML = [
      ['窗口客户', `${customers.length}个`],
      ['窗口36H超时', formatNumber(weekTotal)],
      [`${currentDataLabel()} 36H超时`, formatNumber(latestTotal)],
      [state.platform === '抖音' ? '当前停滞积分' : '窗口上榜客户', state.platform === '抖音' ? formatNumber(risk.stagnant_score || 0) : `${historyCustomerCount}个`]
    ].map(([label, value]) => `<div class="summary-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

    const historyPanel = $('#drawerHistory');
    historyPanel.hidden = !historyDetailSupported;
    historyPanel.innerHTML = historyDetailSupported ? `<div class="history-head"><div><h3>一级公司历史缺货上榜</h3><p>数据源：②揽收环节上榜管控清单 · ${currentWindowLabel()}</p></div><span>${historyRows.length} 条有效记录</span></div>
      ${historyRows.length ? `<div class="history-detail-list">${historyRows.map(row => `<article class="history-detail-item">
        <div class="history-detail-title"><span>${shortDate(row.date)}</span><i>${escapeHtml(row.platform)}</i><strong title="${escapeHtml(row.customer)}">${escapeHtml(row.customer)}</strong></div>
        <p class="history-detail-branch" title="${escapeHtml(row.branch)}">${escapeHtml(row.branch)}${row.customer_code ? ` · 客户编码 ${escapeHtml(row.customer_code)}` : ''}</p>
        <div class="history-detail-grid"><div><span>超时原因</span><p>${escapeHtml(row.reason)}</p></div><div><span>整改动作</span><p>${escapeHtml(row.action)}</p></div></div>
      </article>`).join('')}</div>` : '<div class="history-detail-empty">该窗口内暂无“超时原因、整改动作”均完整的上榜记录。</div>'}
      <p class="history-source">累计涉及 ${history.branches.length} 个下属分部；原因或整改动作为空的记录已隐藏。</p>` : '';

    chartJobs = [];
    if (!customers.length) {
      $('#drawerCharts').innerHTML = `<div class="drawer-empty">该分部在 ${currentWindowLabel()} 窗口内没有客户数据。</div>`;
    } else {
      $('#drawerCharts').innerHTML = `<div class="charts-heading"><h3>全部客户趋势</h3><span>${currentWindowLabel()} · ${range[0]} — ${range.at(-1)} · 缺失日期按 0 展示</span></div>${customers.map((customer, index) => {
        const latest = customer.series.at(-1);
        return `<article class="chart-card"><div class="chart-card-head"><div><h4 title="${escapeHtml(customer.customer)}">${escapeHtml(customer.customer)}</h4><p>发运兜底 · ${escapeHtml(customer.has_shipping_fallback || '未配置')} · ${currentDataLabel()}超时率 ${formatRate(latest.timeout_rate_36h)}</p></div><div class="chart-stat"><strong>${formatNumber(customer.total)}</strong><span>${currentWindowLabel()} 36H超时量</span></div></div><canvas class="combo-chart" id="chart-${index}"></canvas><div class="chart-legend"><span><i></i>36H超时量</span><span><i class="line"></i>36H超时率</span></div></article>`;
      }).join('')}`;
      requestAnimationFrame(() => {
        customers.forEach((customer, index) => {
          const canvas = $(`#chart-${index}`);
          chartJobs.push({ canvas, series: customer.series });
          drawComboChart(canvas, customer.series);
        });
      });
    }
    const layer = $('#drawerLayer');
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#closeDrawer').focus(), 60);
  }

  function closeDrawer() {
    const layer = $('#drawerLayer');
    if (!layer.classList.contains('open')) return;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    chartJobs = [];
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawComboChart(canvas, series) {
    if (!canvas || !canvas.isConnected) return;
    const cssWidth = Math.max(320, canvas.clientWidth || 740);
    const cssHeight = Math.max(200, canvas.clientHeight || 228);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, cssWidth, cssHeight);
    const pad = { top: 25, right: 43, bottom: 32, left: 45 };
    const width = cssWidth - pad.left - pad.right;
    const height = cssHeight - pad.top - pad.bottom;
    const barMaxRaw = Math.max(1, ...series.map(point => Number(point.timeout_36h || 0)));
    const barMax = Math.ceil(barMaxRaw / 5) * 5 || 5;
    const rateMaxRaw = Math.max(1, ...series.map(point => Number(point.timeout_rate_36h || 0)));
    const rateMax = Math.max(5, Math.ceil(rateMaxRaw / 5) * 5);
    context.font = '9px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    context.textBaseline = 'middle';

    for (let step = 0; step <= 4; step += 1) {
      const y = pad.top + height - height * step / 4;
      context.strokeStyle = 'rgba(0,0,0,.07)';
      context.lineWidth = 1;
      context.setLineDash(step ? [3, 4] : []);
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(pad.left + width, y); context.stroke();
      context.setLineDash([]);
      context.fillStyle = '#86868b';
      context.textAlign = 'right';
      context.fillText(String(Math.round(barMax * step / 4)), pad.left - 7, y);
      context.textAlign = 'left';
      context.fillText(`${Math.round(rateMax * step / 4)}%`, pad.left + width + 7, y);
    }

    const slot = width / series.length;
    const barWidth = Math.min(30, slot * .42);
    const points = [];
    series.forEach((point, index) => {
      const center = pad.left + slot * index + slot / 2;
      const value = Number(point.timeout_36h || 0);
      const barHeight = value / barMax * height;
      if (barHeight > 0) {
        const gradient = context.createLinearGradient(0, pad.top + height - barHeight, 0, pad.top + height);
        gradient.addColorStop(0, '#45a6ff'); gradient.addColorStop(1, '#0071e3');
        context.fillStyle = gradient;
        roundedRect(context, center - barWidth / 2, pad.top + height - barHeight, barWidth, barHeight, 5);
        context.fill();
        context.fillStyle = '#424245';
        context.textAlign = 'center';
        context.fillText(formatNumber(value), center, Math.max(9, pad.top + height - barHeight - 8));
      }
      const rate = Number(point.timeout_rate_36h || 0);
      points.push({ x: center, y: pad.top + height - rate / rateMax * height, rate });
      context.fillStyle = '#86868b';
      context.textAlign = 'center';
      const [, month, day] = point.date.split('-');
      context.fillText(`${Number(month)}/${Number(day)}`, center, pad.top + height + 18);
    });

    if (points.length) {
      context.strokeStyle = '#ff9500';
      context.lineWidth = 2.2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      points.forEach((point, index) => {
        if (!index) context.moveTo(point.x, point.y);
        else {
          const previous = points[index - 1];
          const middle = (previous.x + point.x) / 2;
          context.bezierCurveTo(middle, previous.y, middle, point.y, point.x, point.y);
        }
      });
      context.stroke();
      points.forEach(point => {
        context.fillStyle = '#fff'; context.strokeStyle = '#ff9500'; context.lineWidth = 2;
        context.beginPath(); context.arc(point.x, point.y, 3.6, 0, Math.PI * 2); context.fill(); context.stroke();
      });
    }
  }

  function openQuality() {
    const meta = data.meta;
    const sourceRows = meta.source_rows;
    const quality = meta.quality;
    const example = meta.example_check || { months: [], branches: [] };
    $('#qualityContent').innerHTML = `<div class="quality-grid">
      ${[['交件记录', sourceRows.timeout], ['历史上榜', sourceRows.top5], ['网点映射', sourceRows.mapping], ['积分记录', sourceRows.scores], ['管控记录', sourceRows.controls], ['未匹配网点', quality.unmatched_branch_count]].map(([label, value]) => `<div class="quality-metric"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`).join('')}
    </div>
    <div class="quality-note"><b>时间覆盖</b><br>交件数据：${escapeHtml(meta.timeout_start)} 至 ${escapeHtml(meta.as_of)}；积分更新至 ${escapeHtml(meta.score_as_of || '—')}；平台管控更新至 ${escapeHtml(meta.control_as_of || '—')}。积分晚于源表最大日期的空缺不会被虚构。</div>
    <div class="quality-note"><b>示例匹配核验</b><br>广东佛山南海新河村公司 / 抖音：${example.months.map(item => `${monthLabel(item.month)} ${item.days}天`).join('；') || '暂无'}。<br>下属分部：${escapeHtml(example.branches.join('、') || '暂无')}</div>
    <div class="quality-note"><b>未匹配网点样例</b><div class="quality-list">${quality.unmatched_branch_sample.length ? quality.unmatched_branch_sample.map(item => escapeHtml(item)).join('<br>') : '所有涉及网点均已匹配。'}</div></div>`;
    const modal = $('#qualityModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#closeQuality').focus(), 50);
  }

  function closeQuality() {
    const modal = $('#qualityModal');
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  initialize();
})();