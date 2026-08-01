(() => {
  'use strict';

  const data = window.__JIAOJIAN_DASHBOARD__;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE_SIZE = 10;
  const state = { platform: '抖音', date: '', controlPage: 1, scorePage: 1, branchQuery: '', platformQuery: '', scoreScene: '物流停滞-揽收端', deliveryQuery: '', deliveryControlPage: 1, deliveryHighScorePage: 1 };
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
  function currentControlDate() { return data.meta?.control_as_of || state.date; }
  function currentControls() { return data.controls_by_date?.[currentControlDate()] || []; }
  function currentScores() { return data.high_scores_by_date?.[state.date] || []; }
  function deliveryMonitor() { return data.delivery_monitor || {}; }
  function currentDeliveryControls() { return deliveryMonitor().controls_by_date?.[state.date] || []; }
  function currentDeliveryHighScores() { return deliveryMonitor().high_scores_by_date?.[state.date] || []; }
  function filterDeliveryRows(rows) {
    const query = String(state.deliveryQuery || '').trim().toLocaleLowerCase('zh-CN');
    if (!query) return rows;
    return rows.filter(row => Object.values(row).map(value => String(value ?? '')).join(' ').toLocaleLowerCase('zh-CN').includes(query));
  }
  function filteredDeliveryControls() { return filterDeliveryRows(currentDeliveryControls()); }
  function filteredDeliveryHighScores() { return filterDeliveryRows(currentDeliveryHighScores()); }
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
  function trendWindowLabel() { return '最近 15 天'; }

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

  function branchButton(branch, parent, mode = "pickup") {
    const drawerMode = mode === "delivery" ? ` data-drawer-mode="delivery"` : "";
    return `<button class="branch-button js-branch" type="button" data-branch="${encodeName(branch)}"${drawerMode}>${escapeHtml(branch)}</button><span class="subline" title="${escapeHtml(parent || branch)}">一级公司 · ${escapeHtml(parent || branch)}</span>`;
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
      state.deliveryQuery = '';
      $$('.segment', $('#platformSwitcher')).forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      const dates = datesForPlatform();
      state.date = dates.includes(data.meta.as_of) ? data.meta.as_of : dates[dates.length - 1] || '';
      state.controlPage = 1;
      state.scorePage = 1;
      state.deliveryControlPage = 1;
      state.deliveryHighScorePage = 1;
      renderDateSelector();
      renderAll();
      showToast(`已切换至${state.platform}平台`);
    });

    $('#dateSelect').addEventListener('change', event => {
      state.date = event.target.value;
      state.controlPage = 1;
      state.scorePage = 1;
      state.deliveryControlPage = 1;
      state.deliveryHighScorePage = 1;
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
    $('#deliverySearch').addEventListener('input', event => {
      state.deliveryQuery = event.target.value;
      state.deliveryControlPage = 1;
      state.deliveryHighScorePage = 1;
      renderDeliverySearch();
      renderDeliveryControls();
      renderDeliveryHighScores();
    });
    $('#deliverySearch').addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.deliveryQuery) {
        event.stopPropagation();
        state.deliveryQuery = '';
        event.target.value = '';
        state.deliveryControlPage = 1;
        state.deliveryHighScorePage = 1;
        renderDeliverySearch();
        renderDeliveryControls();
        renderDeliveryHighScores();
      }
    });
    $('#clearDeliverySearch').addEventListener('click', () => {
      state.deliveryQuery = '';
      $('#deliverySearch').value = '';
      state.deliveryControlPage = 1;
      state.deliveryHighScorePage = 1;
      renderDeliverySearch();
      renderDeliveryControls();
      renderDeliveryHighScores();
      $('#deliverySearch').focus();
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
      if (branch) openDrawer(decodeURIComponent(branch.dataset.branch), branch.dataset.drawerMode || 'pickup');
    });

    $('#controlPagination').addEventListener('click', event => changePage(event, 'control'));
    $('#scorePagination').addEventListener('click', event => changePage(event, 'score'));
    $('#deliveryControlPagination').addEventListener('click', event => changePage(event, 'delivery-control'));
    $('#deliveryHighScorePagination').addEventListener('click', event => changePage(event, 'delivery-high-score'));
    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeDrawer();
      }
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => chartJobs.forEach(job => job.draw()), 120);
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
    renderDeliveryModule();
    renderDailyAnalysis();
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
    setText('#warningSubtitle', `${currentDataLabel()} 交件超时 TOP10 客户，点击分部查看全部客户${trendWindowLabel()}的趋势。`);
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
    const range = new Set(dayRange(state.date, 15));
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
        <span class="branch-search-metrics"><span><b>${formatNumber(row.latestTotal)}</b><small>${currentDataLabel()} 36H</small></span><span><b>${formatNumber(row.weekTotal)}</b><small>${trendWindowLabel()} 36H</small></span><span><b>${formatNumber(row.customerCount)}</b><small>窗口客户</small></span></span>
        <span class="branch-search-open">${row.lastActiveDate ? `最近数据 ${shortDate(row.lastActiveDate)}` : '最近15天暂无数据'}<i>查看趋势</i></span>
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
    setText('#controlStatus', `抖音平台数据已接入 · 更新至 ${shortDate(currentControlDate())}`);
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
      setText('#platformSearchHint', `管控更新至 ${shortDate(currentControlDate())} · ${currentControls().length} 条管控记录 · ${currentScores().length} 个高积分网点`);
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

  function deliveryActionPill(action) {
    const labels = {
      '派送能力预警': ['notice', '派送预警'],
      '限制面单新签': ['sign', '限制新签'],
      '限制面单到达': ['pickup', '限制到达']
    };
    const [kind, label] = labels[action] || ['none', '暂无管控'];
    return `<span class="action-pill ${kind}">${label}</span>`;
  }

  function renderDeliveryModule() {
    const active = state.platform === '抖音' && Boolean(deliveryMonitor().score_dates?.length || deliveryMonitor().control_dates?.length);
    const section = $('#delivery-score-monitor');
    const nav = $('#deliveryScoreNav');
    if (section) section.hidden = !active;
    if (nav) nav.hidden = !active;
    if (!active) return;
    setText('#deliveryScoreStatus', `派送数据已接入 · 更新至 ${shortDate(deliveryMonitor().as_of || state.date)}`);
    renderDeliverySearch();
    renderDeliveryControls();
    renderDeliveryHighScores();
  }

  function renderDeliverySearch() {
    const input = $('#deliverySearch');
    const clear = $('#clearDeliverySearch');
    if (!input) return;
    const query = String(state.deliveryQuery || '').trim();
    if (input.value !== state.deliveryQuery) input.value = state.deliveryQuery;
    clear.hidden = !state.deliveryQuery;
    if (!query) {
      setText('#deliverySearchHint', `积分更新至 ${shortDate(deliveryMonitor().as_of)} · ${currentDeliveryControls().length} 条管控 · ${currentDeliveryHighScores().length} 个高积分网点`);
      return;
    }
    setText('#deliverySearchHint', `找到 ${filteredDeliveryControls().length} 条管控 · ${filteredDeliveryHighScores().length} 个高积分网点`);
  }

  function renderDeliveryControls() {
    const rows = filteredDeliveryControls();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.deliveryControlPage = Math.min(state.deliveryControlPage, pages);
    const pageRows = rows.slice((state.deliveryControlPage - 1) * PAGE_SIZE, state.deliveryControlPage * PAGE_SIZE);
    setText('#deliveryControlCount', `${rows.length} 条`);
    $('#deliveryControlBody').innerHTML = pageRows.length ? pageRows.map(row => `<tr>
      <td>${shortDate(row.date)}</td>
      <td>${branchButton(row.branch, row.parent_name, 'delivery')}<span class="subline">${escapeHtml(row.region || row.branch_code || '—')}</span></td>
      <td>${deliveryActionPill(row.control_action)}</td>
      <td>${scoreChip(row.rolling_score)}</td>
      <td>${escapeHtml(row.control_category || row.control_mechanism || '—')}</td>
      <td>${shortDate(row.end_date)}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="6">${state.deliveryQuery ? '没有匹配当前关键词的派送管控记录' : '最近 7 天暂无派送管控记录'}</td></tr>`;
    renderPagination($('#deliveryControlPagination'), state.deliveryControlPage, pages, rows.length, 'delivery-control');
  }

  function renderDeliveryHighScores() {
    const rows = filteredDeliveryHighScores();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.deliveryHighScorePage = Math.min(state.deliveryHighScorePage, pages);
    const pageRows = rows.slice((state.deliveryHighScorePage - 1) * PAGE_SIZE, state.deliveryHighScorePage * PAGE_SIZE);
    setText('#deliveryHighScoreCount', `${rows.length} 条`);
    $('#deliveryHighScoreBody').innerHTML = pageRows.length ? pageRows.map(row => {
      const width = Math.min(100, Number(row.stagnant_score || 0) / 32 * 100);
      return `<tr>
        <td>${branchButton(row.branch, row.parent_name, 'delivery')}<span class="subline">${escapeHtml(row.branch_code || '—')}</span></td>
        <td><div class="score-track">${scoreChip(row.stagnant_score)}<span class="track"><span class="fill clear" style="width:${width}%"></span></span></div></td>
        <td>${formatNumber(row.latest_daily_score)}分</td>
        <td>${shortDate(row.latest_score_date)}</td>
        <td>${escapeHtml(row.latest_abnormal_level || '—')}</td>
      </tr>`;
    }).join('') : `<tr class="empty-row"><td colspan="5">${state.deliveryQuery ? '没有匹配当前关键词的高积分停滞网点' : '最近 15 天暂无积分达到 12 分的网点'}</td></tr>`;
    renderPagination($('#deliveryHighScorePagination'), state.deliveryHighScorePage, pages, rows.length, 'delivery-high-score');
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
    else if (kind === 'score') { state.scorePage = page; renderScores(); }
    else if (kind === 'delivery-control') { state.deliveryControlPage = page; renderDeliveryControls(); }
    else if (kind === 'delivery-high-score') { state.deliveryHighScorePage = page; renderDeliveryHighScores(); }
  }

  function dayRange(endDay, count = 7) {
    if (!endDay) return [];
    const end = new Date(`${endDay}T00:00:00`);
    if (Number.isNaN(end.getTime())) return [];
    const dates = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const day = new Date(end);
      day.setDate(end.getDate() - offset);
      const year = day.getFullYear();
      const month = String(day.getMonth() + 1).padStart(2, "0");
      const date = String(day.getDate()).padStart(2, "0");
      dates.push(year + "-" + month + "-" + date);
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

  function branchTop5RecordHtml(row) {
    const feedback = row.feedback_merged
      ? `<div class="history-detail-grid single"><div><span>超时原因与整改动作</span><p>${escapeHtml(row.reason || row.action || '未反馈')}</p></div></div>`
      : `<div class="history-detail-grid"><div><span>超时原因</span><p>${escapeHtml(row.reason || '未反馈')}</p></div><div><span>整改动作</span><p>${escapeHtml(row.action || '未反馈')}</p></div></div>`;
    return `<article class="history-detail-item">
      <div class="history-detail-title"><span>${shortDate(row.date)}</span><i>${escapeHtml(row.platform)}</i><strong title="${escapeHtml(row.customer)}">${escapeHtml(row.customer)}</strong></div>
      <p class="history-detail-branch" title="${escapeHtml(row.branch)}">${escapeHtml(row.branch)}${row.customer_code ? ` · 客户编码 ${escapeHtml(row.customer_code)}` : ''} · 36H超时 ${formatNumber(row.timeout_36h)} · 超时率 ${formatRate(row.timeout_rate_36h)}</p>
      ${feedback}
    </article>`;
  }

  function renderBranchScoreTrend(branch, range) {
    const panel = $('#drawerScoreTrend');
    if (!panel) return;
    const scenes = ['物流停滞-揽收端', '物流停滞-全链路'];
    const branchScenes = data.branch_score_trends?.[branch] || {};
    const availableScenes = scenes.filter(scene => (branchScenes[scene] || []).length);
    if (!availableScenes.includes(state.scoreScene)) state.scoreScene = availableScenes[0] || scenes[0];
    const scene = state.scoreScene;
    const isPickup = scene === '物流停滞-揽收端';
    const source = branchScenes[scene] || [];
    const byDate = new Map(source.map(point => [point.date, point]));
    const series = range.map(date => {
      const sourcePoint = byDate.get(date);
      if (sourcePoint) return {
        ...sourcePoint,
        shipment_timeout_rate: isPickup ? Number(sourcePoint.shipment_timeout_rate || 0) : sourcePoint.shipment_timeout_rate,
        shipment_timeout_abnormal_count: isPickup ? Number(sourcePoint.shipment_timeout_abnormal_count || 0) : sourcePoint.shipment_timeout_abnormal_count
      };
      return {
        date,
        score: isPickup ? null : 0,
        shipment_timeout_rate: isPickup ? 0 : null,
        shipment_timeout_abnormal_count: isPickup ? 0 : null
      };
    });
    const hasData = series.some(point => point.score !== null || point.shipment_timeout_rate !== null || point.shipment_timeout_abnormal_count !== null);
    const options = scenes.map(item => '<option value="' + escapeHtml(item) + '"' + (item === scene ? ' selected' : '') + '>' + escapeHtml(item) + '</option>').join('');
    panel.hidden = false;
    panel.innerHTML = '<div class="score-trend-head"><div><h3>近期扣分趋势</h3><p>' + escapeHtml(branch) + ' · ' + escapeHtml(range[0] || '—') + ' — ' + escapeHtml(range.at(-1) || '—') + '</p></div><label><span>违规场景</span><select id="scoreSceneSelect">' + options + '</select></label></div>';
    if (hasData) {
      panel.innerHTML += '<canvas class="score-trend-chart" id="scoreTrendChart"></canvas><div class="chart-legend score-trend-legend">' +
        (isPickup ? '<span><i></i>异常单量</span><span><i class="line"></i>超时率</span><span><i class="score"></i>扣分</span>' : '<span><i class="score-line"></i>扣分</span>') +
        '</div>' + (isPickup ? '' : '<p class="score-trend-note">因平台未直接提供数据，超长单只展示扣分趋势</p>');
    } else {
      panel.innerHTML += '<div class="score-trend-empty">当前网点在 ' + escapeHtml(range[0] || '—') + ' 至 ' + escapeHtml(range.at(-1) || '—') + ' 暂无该违规场景数据。</div>';
    }
    const select = $('#scoreSceneSelect');
    if (select) {
      select.addEventListener('change', event => {
        state.scoreScene = event.target.value;
        renderBranchScoreTrend(branch, range);
      });
    }
    chartJobs = chartJobs.filter(job => job.kind !== 'score');
    const canvas = $('#scoreTrendChart');
    if (canvas) {
      const draw = () => drawScoreTrendChart(canvas, series, isPickup ? 'pickup' : 'full');
      chartJobs.push({ kind: 'score', canvas, draw });
      requestAnimationFrame(draw);
    }
  }
  function renderDeliveryScoreTrend(branch, range) {
    const panel = $('#drawerScoreTrend');
    if (!panel) return;
    const source = deliveryMonitor().trends?.[branch]?.series || [];
    const byDate = new Map(source.map(point => [point.date, point]));
    const series = range.map(date => byDate.get(date) || { date, daily_score: 0, rolling_score: 0 });
    const hasData = source.some(point => range.includes(point.date));
    panel.hidden = false;
    panel.innerHTML = `<div class="score-trend-head"><div><h3>最近 15 天扣分趋势</h3><p>${escapeHtml(branch)} · ${escapeHtml(range[0] || '—')} — ${escapeHtml(range.at(-1) || '—')}</p></div></div>`;
    if (hasData) {
      panel.innerHTML += '<canvas class="score-trend-chart" id="scoreTrendChart"></canvas><div class="chart-legend score-trend-legend"><span><i></i>当日扣分</span><span><i class="line"></i>15日累计积分</span></div>';
    } else {
      panel.innerHTML += `<div class="score-trend-empty">当前网点在 ${escapeHtml(range[0] || '—')} 至 ${escapeHtml(range.at(-1) || '—')} 暂无派送积分数据。</div>`;
    }
    chartJobs = chartJobs.filter(job => job.kind !== 'score');
    const canvas = $('#scoreTrendChart');
    if (canvas) {
      const draw = () => drawScoreTrendChart(canvas, series, 'delivery');
      chartJobs.push({ kind: 'score', canvas, draw });
      requestAnimationFrame(draw);
    }
  }

  function openDeliveryDrawer(branch) {
    const branchData = deliveryMonitor().trends?.[branch] || {};
    const range = dayRange(state.date, 15);
    const source = branchData.series || [];
    const byDate = new Map(source.map(point => [point.date, point]));
    const series = range.map(day => byDate.get(day) || { date: day, daily_score: 0, rolling_score: 0 });
    const latest = series.at(-1) || { daily_score: 0, rolling_score: 0 };
    const recentControlCount = currentDeliveryControls().filter(row => row.branch === branch && String(row.control_status || '').includes('执行中')).length;
    const lastScoreDate = [...source].filter(point => range.includes(point.date)).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date || '—';
    setText('#drawerKicker', `派送积分监控 · 最近 15 天`);
    setText('#drawerTitle', branch);
    setText('#drawerParent', `一级公司 · ${branchData.parent_name || branch}`);
    $('#drawerSummary').innerHTML = [
      ['滚动累计积分', formatNumber(latest.rolling_score)],
      ['最近单日扣分', formatNumber(latest.daily_score)],
      ['最近违规日期', shortDate(lastScoreDate)],
      ['执行中管控', `${recentControlCount}条`]
    ].map(([label, value]) => `<div class="summary-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    $('#drawerHistory').hidden = true;
    $('#drawerHistory').innerHTML = '';
    $('#drawerCharts').hidden = true;
    $('#drawerCharts').innerHTML = '';
    chartJobs = [];
    renderDeliveryScoreTrend(branch, range);
    const layer = $('#drawerLayer');
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#closeDrawer').focus(), 60);
  }
  function openDrawer(branch, mode = "pickup") {
    if (mode === 'delivery') {
      openDeliveryDrawer(branch);
      return;
    }
    const branchData = data.trends?.[state.platform]?.[branch];
    const parent = branchData?.parent_name || branchRisk(branch).parent_name || branch;
    const range = dayRange(state.date, 15);
    const customers = (branchData?.customers || []).map(customer => {
      const byDate = new Map(customer.series.map(point => [point.date, point]));
      const series = range.map(day => byDate.get(day) || { date: day, timeout_36h: 0, timeout_rate_36h: 0 });
      const hasSourcePoint = series.some(point => byDate.has(point.date));
      const total = series.reduce((sum, point) => sum + Number(point.timeout_36h || 0), 0);
      return { ...customer, series, total, hasSourcePoint };
    }).filter(customer => customer.hasSourcePoint).sort((a, b) => b.total - a.total);
    const risk = branchRisk(branch);
    const branchTop5Supported = state.platform === '抖音' || state.platform === '淘宝';
    const branchTop5Rows = branchTop5Supported ? (data.branch_top5_data?.[state.platform]?.[branch] || []) : [];
    const latestTotal = customers.reduce((sum, customer) => sum + Number(customer.series.at(-1)?.timeout_36h || 0), 0);
    const weekTotal = customers.reduce((sum, customer) => sum + customer.total, 0);

    setText('#drawerKicker', `${state.platform} · ${trendWindowLabel()}`);
    setText('#drawerTitle', branch);
    setText('#drawerParent', `一级公司 · ${parent}`);
    $('#drawerSummary').innerHTML = [
      ['窗口客户', `${customers.length}个`],
      ['15天36H超时', formatNumber(weekTotal)],
      [`${currentDataLabel()} 36H超时`, formatNumber(latestTotal)],
      [state.platform === '抖音' ? '当前停滞积分' : '分部上榜记录', state.platform === '抖音' ? formatNumber(risk.stagnant_score || 0) : `${branchTop5Rows.length}条`]
    ].map(([label, value]) => `<div class="summary-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

    const historyPanel = $('#drawerHistory');
    historyPanel.hidden = !branchTop5Supported;
    historyPanel.innerHTML = branchTop5Supported
      ? `<div class="history-head"><div><h3>分部TOP5上榜数据</h3><p>${escapeHtml(branch)} · ${escapeHtml(state.platform)}</p></div><span>${branchTop5Rows.length} 条记录</span></div>
        ${branchTop5Rows.length ? `<label class="history-record-picker" for="branchTop5Select"><span>选择上榜记录</span><select id="branchTop5Select">${branchTop5Rows.map((row, index) => `<option value="${index}">${escapeHtml(`${shortDate(row.date)} · ${row.customer}`)}</option>`).join('')}</select></label><div class="history-record-view" id="branchTop5Record"></div>` : `<div class="history-detail-empty">该分部暂无${escapeHtml(state.platform)}平台TOP5上榜数据。</div>`}`
      : '';
    if (branchTop5Rows.length) {
      const recordSelect = $('#branchTop5Select');
      const recordView = $('#branchTop5Record');
      const renderSelectedRecord = () => {
        const selected = branchTop5Rows[Number(recordSelect.value) || 0];
        recordView.innerHTML = selected ? branchTop5RecordHtml(selected) : '';
      };
      recordSelect.addEventListener('change', renderSelectedRecord);
      renderSelectedRecord();
    }
    $('#drawerCharts').hidden = false;
    chartJobs = [];
    renderBranchScoreTrend(branch, range);
    if (!customers.length) {
      $('#drawerCharts').innerHTML = `<div class="drawer-empty">该分部在${trendWindowLabel()}内没有客户数据。</div>`;
    } else {
      $('#drawerCharts').innerHTML = `<div class="charts-heading"><h3>全部客户趋势</h3><span>${trendWindowLabel()} · ${range[0]} — ${range.at(-1)} · 缺失日期按 0 展示</span></div>${customers.map((customer, index) => {
        const latest = customer.series.at(-1);
        return `<article class="chart-card"><div class="chart-card-head"><div><h4 title="${escapeHtml(customer.customer)}">${escapeHtml(customer.customer)}</h4><p>发运兜底 · ${escapeHtml(customer.has_shipping_fallback || '未配置')} · ${currentDataLabel()}超时率 ${formatRate(latest.timeout_rate_36h)}</p></div><div class="chart-stat"><strong>${formatNumber(customer.total)}</strong><span>${trendWindowLabel()} 36H超时量</span></div></div><canvas class="combo-chart" id="chart-${index}"></canvas><div class="chart-legend"><span><i></i>36H超时量</span><span><i class="line"></i>36H超时率</span></div></article>`;
      }).join('')}`;
      requestAnimationFrame(() => {
        customers.forEach((customer, index) => {
          const canvas = $(`#chart-${index}`);
          const draw = () => drawComboChart(canvas, customer.series);
          chartJobs.push({ kind: 'customer', canvas, draw });
          draw();
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


  function drawScoreTrendChart(canvas, series, mode) {
    if (!canvas || !canvas.isConnected) return;
    const pickup = mode === 'pickup';
    const cssWidth = Math.max(320, canvas.clientWidth || 740);
    const cssHeight = Math.max(pickup ? 250 : 220, canvas.clientHeight || (pickup ? 260 : 228));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    const pad = { top: 25, right: 50, bottom: pickup ? 58 : 42, left: 45 };
    const width = cssWidth - pad.left - pad.right;
    const height = cssHeight - pad.top - pad.bottom;
    const slot = width / Math.max(series.length, 1);
    const scoreColors = { 0: '#8e8e93', 1: '#ff9f0a', 2: '#ff3b30' };
    context.font = '9px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    context.textBaseline = 'middle';
    if (mode === 'delivery') {
      const scoreMaxRaw = Math.max(16, ...series.map(point => Number(point.daily_score || 0)), ...series.map(point => Number(point.rolling_score || 0)));
      const scoreMax = Math.max(20, Math.ceil(scoreMaxRaw / 5) * 5);
      for (let step = 0; step <= 4; step += 1) {
        const y = pad.top + height - height * step / 4;
        context.strokeStyle = 'rgba(0,0,0,.07)';
        context.lineWidth = 1;
        context.setLineDash(step ? [3, 4] : []);
        context.beginPath(); context.moveTo(pad.left, y); context.lineTo(pad.left + width, y); context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#86868b';
        context.textAlign = 'right';
        context.fillText(String(Math.round(scoreMax * step / 4)), pad.left - 7, y);
      }
      const rollingPoints = [];
      series.forEach((point, index) => {
        const center = pad.left + slot * index + slot / 2;
        const daily = Number(point.daily_score || 0);
        const barWidth = Math.min(30, slot * .42);
        const barHeight = daily / scoreMax * height;
        if (barHeight > 0) {
          const gradient = context.createLinearGradient(0, pad.top + height - barHeight, 0, pad.top + height);
          gradient.addColorStop(0, '#ffb340'); gradient.addColorStop(1, '#ff7a00');
          context.fillStyle = gradient;
          roundedRect(context, center - barWidth / 2, pad.top + height - barHeight, barWidth, barHeight, 5);
          context.fill();
          context.fillStyle = '#424245';
          context.textAlign = 'center';
          context.fillText(formatNumber(daily), center, Math.max(9, pad.top + height - barHeight - 8));
        }
        const rolling = Number(point.rolling_score || 0);
        rollingPoints.push({ x: center, y: pad.top + height - rolling / scoreMax * height });
        context.fillStyle = '#86868b';
        context.textAlign = 'center';
        const dateParts = point.date.split('-');
        context.fillText(Number(dateParts[1]) + '/' + Number(dateParts[2]), center, pad.top + height + 17);
      });
      if (rollingPoints.length) {
        context.strokeStyle = '#ff3b30';
        context.lineWidth = 2.2;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.beginPath();
        rollingPoints.forEach((point, index) => {
          if (!index) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
        rollingPoints.forEach(point => {
          context.fillStyle = '#fff'; context.strokeStyle = '#ff3b30'; context.lineWidth = 2;
          context.beginPath(); context.arc(point.x, point.y, 3.6, 0, Math.PI * 2); context.fill(); context.stroke();
        });
      }
      context.fillStyle = '#86868b';
      context.textAlign = 'right';
      context.fillText('积分', pad.left - 7, pad.top + height + 35);
      return;
    }

    if (pickup) {
      const countMaxRaw = Math.max(1, ...series.map(point => point.shipment_timeout_abnormal_count === null ? 0 : Number(point.shipment_timeout_abnormal_count || 0)));
      const countMax = Math.ceil(countMaxRaw / 5) * 5 || 5;
      const rateMaxRaw = Math.max(1, ...series.map(point => point.shipment_timeout_rate === null ? 0 : Number(point.shipment_timeout_rate || 0)));
      const rateMax = Math.max(5, Math.ceil(rateMaxRaw / 5) * 5);
      for (let step = 0; step <= 4; step += 1) {
        const y = pad.top + height - height * step / 4;
        context.strokeStyle = 'rgba(0,0,0,.07)';
        context.lineWidth = 1;
        context.setLineDash(step ? [3, 4] : []);
        context.beginPath(); context.moveTo(pad.left, y); context.lineTo(pad.left + width, y); context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#86868b';
        context.textAlign = 'right';
        context.fillText(String(Math.round(countMax * step / 4)), pad.left - 7, y);
        context.textAlign = 'left';
        context.fillText(String(Math.round(rateMax * step / 4)) + '%', pad.left + width + 7, y);
      }
      const ratePoints = [];
      series.forEach((point, index) => {
        const center = pad.left + slot * index + slot / 2;
        const count = point.shipment_timeout_abnormal_count === null ? null : Number(point.shipment_timeout_abnormal_count || 0);
        if (count !== null && count > 0) {
          const barWidth = Math.min(30, slot * .42);
          const barHeight = count / countMax * height;
          const gradient = context.createLinearGradient(0, pad.top + height - barHeight, 0, pad.top + height);
          gradient.addColorStop(0, '#45a6ff'); gradient.addColorStop(1, '#0071e3');
          context.fillStyle = gradient;
          roundedRect(context, center - barWidth / 2, pad.top + height - barHeight, barWidth, barHeight, 5);
          context.fill();
          context.fillStyle = '#424245';
          context.textAlign = 'center';
          context.fillText(formatNumber(count), center, Math.max(9, pad.top + height - barHeight - 8));
        }
        const rate = point.shipment_timeout_rate === null ? null : Number(point.shipment_timeout_rate || 0);
        if (rate !== null) {
          const current = { x: center, y: pad.top + height - rate / rateMax * height };
          ratePoints.push(current);
        }
        context.fillStyle = '#86868b';
        context.textAlign = 'center';
        const dateParts = point.date.split('-');
        context.fillText(Number(dateParts[1]) + '/' + Number(dateParts[2]), center, pad.top + height + 16);
        if (point.score !== null) {
          const score = Math.max(0, Math.min(2, Number(point.score || 0)));
          const color = scoreColors[score] || scoreColors[0];
          context.fillStyle = color;
          context.beginPath(); context.arc(center, pad.top + height + 38, 8, 0, Math.PI * 2); context.fill();
          context.fillStyle = '#fff';
          context.fillText(String(score), center, pad.top + height + 38);
        }
      });
      if (ratePoints.length) {
        context.strokeStyle = '#ff9500';
        context.lineWidth = 2.2;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.beginPath();
        ratePoints.forEach((point, index) => {
          if (!index) context.moveTo(point.x, point.y);
          else {
            const previous = ratePoints[index - 1];
            const middle = (previous.x + point.x) / 2;
            context.bezierCurveTo(middle, previous.y, middle, point.y, point.x, point.y);
          }
        });
        context.stroke();
        ratePoints.forEach(point => {
          context.fillStyle = '#fff'; context.strokeStyle = '#ff9500'; context.lineWidth = 2;
          context.beginPath(); context.arc(point.x, point.y, 3.6, 0, Math.PI * 2); context.fill(); context.stroke();
        });
      }
      context.fillStyle = '#86868b';
      context.textAlign = 'right';
      context.fillText('扣分', pad.left - 7, pad.top + height + 38);
      return;
    }

    for (let score = 0; score <= 2; score += 1) {
      const y = pad.top + height - height * score / 2;
      context.strokeStyle = 'rgba(0,0,0,.07)';
      context.lineWidth = 1;
      context.setLineDash(score ? [3, 4] : []);
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(pad.left + width, y); context.stroke();
      context.setLineDash([]);
      context.fillStyle = '#86868b';
      context.textAlign = 'right';
      context.fillText(String(score), pad.left - 7, y);
    }
    let previous = null;
    series.forEach((point, index) => {
      const center = pad.left + slot * index + slot / 2;
      context.fillStyle = '#86868b';
      context.textAlign = 'center';
      const dateParts = point.date.split('-');
      context.fillText(Number(dateParts[1]) + '/' + Number(dateParts[2]), center, pad.top + height + 17);
      if (point.score === null) {
        previous = null;
        return;
      }
      const score = Math.max(0, Math.min(2, Number(point.score || 0)));
      const current = { x: center, y: pad.top + height - height * score / 2 };
      if (previous) {
        context.strokeStyle = '#ff3b30';
        context.lineWidth = 2.2;
        context.lineJoin = 'round';
        context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(current.x, current.y); context.stroke();
      }
      context.fillStyle = '#fff'; context.strokeStyle = scoreColors[score]; context.lineWidth = 2;
      context.beginPath(); context.arc(current.x, current.y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
      context.fillStyle = scoreColors[score];
      context.textAlign = 'center';
      context.fillText(String(score), center, Math.max(9, current.y - 11));
      previous = current;
    });
  }
  function renderDailyAnalysis() {
    const rows = top10Rows();
    setText('#analysisTitle', `${state.platform} · ${state.date || '—'} 当日分析`);
    setText('#analysisSubtitle', `${currentDataLabel()} 数据口径 · 仅分析页面所示 TOP10 客户，切换平台或日期后自动更新。`);
    const status = $('#analysisStatus');
    const content = $('#analysisContent');
    if (!rows.length) {
      status.className = 'analysis-status neutral';
      status.textContent = '暂无数据';
      content.innerHTML = '<div class="analysis-empty">当前平台在该数据日没有可分析的交件预警记录。</div>';
      return;
    }

    const total = rows.reduce((sum, row) => sum + Number(row.timeout_36h || 0), 0);
    const branchCount = new Set(rows.map(row => row.branch)).size;
    const sorted = [...rows].sort((a, b) => Number(b.timeout_36h || 0) - Number(a.timeout_36h || 0));
    const top3Total = sorted.slice(0, 3).reduce((sum, row) => sum + Number(row.timeout_36h || 0), 0);
    const top3Share = total ? top3Total / total * 100 : 0;
    const dates = datesForPlatform();
    const dateIndex = dates.indexOf(state.date);
    const previousDate = dateIndex > 0 ? dates[dateIndex - 1] : '';
    const previousRows = previousDate ? (data.platforms?.[state.platform]?.top10_by_date?.[previousDate] || []) : [];
    const previousTotal = previousRows.reduce((sum, row) => sum + Number(row.timeout_36h || 0), 0);
    const delta = previousDate ? total - previousTotal : null;
    const deltaPercent = previousDate && previousTotal ? delta / previousTotal * 100 : null;
    const tone = delta === null || delta === 0 ? 'neutral' : delta < 0 ? 'good' : 'risk';
    const statusCopy = delta === null ? '首个数据日' : delta < 0 ? '较前一日改善' : delta > 0 ? '较前一日上升' : '较前一日持平';
    status.className = `analysis-status ${tone}`;
    status.textContent = statusCopy;

    const topCustomer = sorted[0];
    const highestRate = [...rows].sort((a, b) => Number(b.timeout_rate_36h || 0) - Number(a.timeout_rate_36h || 0))[0];
    const concentration = top3Share >= 60 ? '风险高度集中' : top3Share >= 40 ? '风险相对集中' : '风险较分散';
    const deltaValue = delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`;
    const deltaNote = !previousDate ? '无上一数据日' : deltaPercent === null ? `${previousDate} 基数为 0` : `${previousDate} · ${deltaPercent > 0 ? '+' : ''}${deltaPercent.toFixed(1)}%`;
    const cards = [
      ['TOP10 36H超时量', formatNumber(total), `${rows.length} 个客户`],
      ['涉及分部', formatNumber(branchCount), '按分部名称去重'],
      ['前三客户占比', `${top3Share.toFixed(1)}%`, concentration],
      ['较前一数据日', deltaValue, deltaNote]
    ];
    const insights = [
      `当日 TOP10 的 36H 超时量合计 ${formatNumber(total)}，覆盖 ${branchCount} 个分部。`,
      `前三客户贡献 ${formatNumber(top3Total)} 单，占 TOP10 的 ${top3Share.toFixed(1)}%，${concentration}。`,
      `超时量最高的是“${topCustomer.customer || '未命名客户'}”（${topCustomer.branch || '未标注分部'}），共 ${formatNumber(topCustomer.timeout_36h)} 单；最高超时率为“${highestRate.customer || '未命名客户'}”的 ${formatRate(highestRate.timeout_rate_36h)}。`
    ];
    if (previousDate) {
      insights.push(`较上一数据日 ${previousDate}，TOP10 超时量${delta < 0 ? '减少' : delta > 0 ? '增加' : '持平'}${delta === 0 ? '' : ` ${formatNumber(Math.abs(delta))} 单`}。`);
    } else {
      insights.push('当前日期是该平台首个可用数据日，暂不做环比判断。');
    }
    if (state.platform === '抖音') {
      insights.push(`联动风险：滚动 16 天达到 6 分及以上的网点 ${currentScores().length} 个，近 7 天平台管控动作 ${currentControls().length} 条。`);
    } else {
      insights.push(`${state.platform}当前仅按内部交件预警分析，停滞积分和抖音平台管控不参与该平台结论。`);
    }

    content.innerHTML = `<div class="analysis-metrics">${cards.map(([label, value, note]) => `<article class="analysis-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('')}</div>
      <div class="analysis-conclusion"><h3>观察结论</h3><ul>${insights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
  }

  initialize();
})();