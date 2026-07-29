const state = {
  payload: null,
  selectedPairId: null,
  secondaryOpen: false,
  activeSport: 'baseball',
  activeBookmaker: 'all',
  drafts: {},
  settings: {
    cashStakeRub: '1725',
    fxRubPerUsd: '81',
  },
};

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

window.addEventListener('DOMContentLoaded', () => {
  bindControls();
  loadDashboard();
});

function bindControls() {
  const cashInput = document.getElementById('cashStakeRub');
  const fxInput = document.getElementById('fxRubPerUsd');

  document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
  document.getElementById('winlineRefreshButton').addEventListener('click', refreshWinline);
  document.getElementById('toggleSecondary').addEventListener('click', () => {
    state.secondaryOpen = !state.secondaryOpen;
    renderSecondaryVisibility();
  });

  cashInput.addEventListener('input', (event) => {
    state.settings.cashStakeRub = event.target.value;
    persistSetting('cashStakeRub', event.target.value);
    syncSettingInputs('cashStakeRub', event.target.value, event.target);
    renderSummaryBar();
    renderPairDetail();
  });
  cashInput.addEventListener('blur', () => renderDashboard());

  fxInput.addEventListener('input', (event) => {
    state.settings.fxRubPerUsd = event.target.value;
    persistSetting('fxRubPerUsd', event.target.value);
    syncSettingInputs('fxRubPerUsd', event.target.value, event.target);
    renderSummaryBar();
    renderPairDetail();
  });
  fxInput.addEventListener('blur', () => renderDashboard());

  document.getElementById('manualEntryForm').addEventListener('submit', createManualEntry);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let settingSaveTimer;
function persistSetting(key, value) {
  clearTimeout(settingSaveTimer);
  settingSaveTimer = setTimeout(() => {
    fetchJson('/api/state/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).catch(() => {});
  }, 250);
}

async function loadDashboard() {
  try {
    const payload = await fetchJson('/api/data');
    state.payload = payload;
    state.settings.cashStakeRub = payload.settings?.cashStakeRub ?? state.settings.cashStakeRub;
    state.settings.fxRubPerUsd = payload.settings?.fxRubPerUsd ?? state.settings.fxRubPerUsd;
    if (!state.selectedPairId) {
      state.selectedPairId = payload.arb_snapshots[0]?.pair_id || null;
    }
    if (state.selectedPairId && !payload.arb_snapshots.some((item) => item.pair_id === state.selectedPairId)) {
      state.selectedPairId = payload.arb_snapshots[0]?.pair_id || null;
    }
    syncDraftsWithPayload();
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString('en-GB')}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Load failed: ${error.message}`;
  }
}

function syncDraftsWithPayload() {
  const nextDrafts = {};
  for (const snapshot of state.payload?.arb_snapshots || []) {
    const existing = state.drafts[snapshot.pair_id] || {};
    nextDrafts[snapshot.pair_id] = {
      bookmakerOdds: existing.bookmakerOdds ?? formatRawNumber(snapshot.bookmaker_market.effective_decimal_odds, 2),
      polyMarket: existing.polyMarket ?? formatMarketDisplayInput(snapshot.price_views?.market_net),
      polyLimit: existing.polyLimit ?? formatLimitDisplayInput(snapshot.price_views?.limit_candidate),
    };
  }
  state.drafts = nextDrafts;
}

async function refreshDashboard() {
  const button = document.getElementById('refreshButton');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const payload = await fetchJson('/api/refresh', { method: 'POST' });
    state.payload = payload;
    syncDraftsWithPayload();
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString('en-GB')}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Refresh failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh';
  }
}

async function refreshWinline() {
  const button = document.getElementById('winlineRefreshButton');
  const status = document.getElementById('winlineRefreshStatus');
  button.disabled = true;
  button.textContent = 'Refreshing Winline…';
  status.dataset.status = 'running';
  status.textContent = 'running';

  try {
    await fetchJson('/api/winline/refresh', { method: 'POST' });
    status.dataset.status = 'success';
    status.textContent = 'success — reloading snapshot';
    await loadDashboard();
  } catch (error) {
    const notConfigured = error.message === 'Winline manual refresh is not configured';
    status.dataset.status = notConfigured ? 'not_configured' : 'error';
    status.textContent = notConfigured ? 'not configured' : `error — ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh Winline';
  }
}

function getAllSnapshots() {
  return state.payload?.arb_snapshots || [];
}

function clientMatchIdentity(item) {
  const providerEventId = item.pair?.provider_event_id;
  if (providerEventId != null) return `${item.bookmaker_market?.bookmaker_key || 'book'}:${providerEventId}`;
  return `${item.bookmaker_market?.event_title || 'event'}:${item.bookmaker_market?.event_start_at || ''}`;
}

function formatEventStart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)} UTC`;
}

function opportunityCategory(item) {
  const metrics = buildCashMetrics(item, state.drafts[item.pair_id] || {});
  const risk = String(item.pair?.basis_risk || 'NONE').toUpperCase();
  const marketPositive = Number.isFinite(metrics.profitMarketRub) && metrics.profitMarketRub > 0;
  const limitPositive = Number.isFinite(metrics.profitLimitRub) && metrics.profitLimitRub > 0;
  if (!marketPositive && !limitPositive) return null;
  if (risk !== 'NONE') return 'basis_risk';
  return marketPositive ? 'market' : 'limit';
}

function relevantOpportunityProfit(item, category = opportunityCategory(item)) {
  const metrics = buildCashMetrics(item, state.drafts[item.pair_id] || {});
  if (category === 'market') return metrics.profitMarketRub;
  if (category === 'limit') return metrics.profitLimitRub;
  return Math.max(metrics.profitMarketRub ?? -Infinity, metrics.profitLimitRub ?? -Infinity);
}

function getSnapshots() {
  let rows = getAllSnapshots();
  if (state.activeBookmaker !== 'all') {
    rows = rows.filter((item) => item.bookmaker_market?.bookmaker_key === state.activeBookmaker);
  }

  if (state.activeSport === 'top') {
    const priority = { market: 0, limit: 1, basis_risk: 2 };
    return rows
      .map((item) => ({ item, category: opportunityCategory(item) }))
      .filter(({ item, category }) => category && !item.stale_flag)
      .sort((left, right) => {
        const categoryDiff = priority[left.category] - priority[right.category];
        if (categoryDiff) return categoryDiff;
        return relevantOpportunityProfit(right.item, right.category) - relevantOpportunityProfit(left.item, left.category);
      })
      .map(({ item }) => item);
  }

  return rows
    .filter((item) => item.sport === state.activeSport || item.bookmaker_market?.sport === state.activeSport)
    .sort((a, b) => {
      const timeDiff = new Date(a.bookmaker_market.event_start_at).getTime() - new Date(b.bookmaker_market.event_start_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      const titleDiff = getEventDisplayName(a).localeCompare(getEventDisplayName(b), 'en');
      if (titleDiff !== 0) return titleDiff;
      return a.bookmaker_market.outcome_label.localeCompare(b.bookmaker_market.outcome_label, 'en');
    });
}

function renderDashboard() {
  if (!state.payload) return;
  renderTabs();
  const visibleRows = getSnapshots();
  if (state.selectedPairId && !visibleRows.some((item) => item.pair_id === state.selectedPairId)) {
    state.selectedPairId = visibleRows[0]?.pair_id || null;
  }
  renderSummaryBar();
  renderOpportunities();
  renderPairDetail();
  renderSecondaryVisibility();
  syncSettingInputs('cashStakeRub', state.settings.cashStakeRub);
  syncSettingInputs('fxRubPerUsd', state.settings.fxRubPerUsd);
}

function renderTabs() {
  const sportTabs = [{ key: 'top', label: 'Top Opportunities' }, ...(state.payload?.filters?.sports || [])];
  const bookmakerTabs = [{ key: 'all', label: 'All books' }, ...(state.payload?.filters?.bookmakers || [])];

  const sportRoot = document.getElementById('sportTabs');
  sportRoot.innerHTML = sportTabs.map((item) => `
    <button class="tab-button ${item.key === state.activeSport ? 'active' : ''}" data-sport-tab="${escapeAttr(item.key)}" type="button">${escapeHtml(item.label)}</button>
  `).join('');
  sportRoot.querySelectorAll('[data-sport-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeSport = button.dataset.sportTab;
      renderDashboard();
    });
  });

  const bookRoot = document.getElementById('bookmakerTabs');
  bookRoot.innerHTML = bookmakerTabs.map((item) => `
    <button class="tab-button compact ${item.key === state.activeBookmaker ? 'active' : ''}" data-book-tab="${escapeAttr(item.key)}" type="button">${escapeHtml(item.label)}</button>
  `).join('');
  bookRoot.querySelectorAll('[data-book-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeBookmaker = button.dataset.bookTab;
      renderDashboard();
    });
  });
}

function renderSummaryBar() {
  const rows = getSnapshots();
  const matches = new Set(rows.map(clientMatchIdentity)).size;
  const categoryPills = state.activeSport === 'top'
    ? ['market', 'limit', 'basis_risk'].map((category) => {
      const count = rows.filter((item) => opportunityCategory(item) === category).length;
      return `<span class="summary-pill category-${category}">${opportunityCategoryLabel(category)} ${count}</span>`;
    }).join('')
    : '';
  const warnings = state.payload?.diagnostics?.warnings || [];
  const sourceState = warnings.length ? `Winline unavailable: ${warnings.join('; ')}` : `Winline snapshot: ${state.payload?.summary?.source_captured_at || 'not captured'}`;
  document.getElementById('winlineFeedStatus').textContent = sourceState;
  document.getElementById('summaryBar').innerHTML = `
    <span class="summary-pill">Matches ${matches}</span>
    <span class="summary-pill">Rows ${rows.length}</span>
    ${categoryPills}
  `;
}

function renderOpportunities() {
  const rows = getSnapshots();
  const body = document.getElementById('opportunitiesBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="12" class="loading-cell">No exact Polymarket matches for this filter.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((item) => {
    const draft = state.drafts[item.pair_id] || {};
    const dirty = isDirty(item, draft);
    const selected = item.pair_id === state.selectedPairId ? 'selected' : '';
    const metrics = buildCashMetrics(item, draft);
    const category = opportunityCategory(item);
    return `
      <tr class="${selected}" data-pair-id="${item.pair_id}">
        <td>${escapeHtml(item.bookmaker_label || prettyBookName(item.bookmaker_market.bookmaker_key))}</td>
        <td class="event-cell" data-select-row="${item.pair_id}">
          <div class="event-title">${escapeHtml(getEventDisplayName(item))}</div>
          <div class="event-meta">
            ${escapeHtml(sportLabel(item.sport))} · ${escapeHtml(formatEventStart(item.bookmaker_market.event_start_at))} · Book side: ${escapeHtml(item.bookmaker_market.outcome_label)}
            ${category ? opportunityBadge(category, item.pair?.basis_risk) : ''}
          </div>
        </td>
        <td class="odds-cell">
          <input class="odds-input ${dirty.bookmaker ? 'dirty' : ''}" data-field="bookmakerOdds" data-pair-id="${item.pair_id}" type="text" inputmode="decimal" value="${escapeAttr(draft.bookmakerOdds ?? '')}" />
        </td>
        <td class="odds-cell poly-cell">
          <input class="odds-input ${dirty.polyMarket ? 'dirty' : ''}" data-field="polyMarket" data-pair-id="${item.pair_id}" type="text" inputmode="decimal" value="${escapeAttr(draft.polyMarket ?? '')}" />
          <input class="odds-input ${dirty.polyLimit ? 'dirty' : ''}" data-field="polyLimit" data-pair-id="${item.pair_id}" type="text" inputmode="decimal" value="${escapeAttr(draft.polyLimit ?? '')}" />
          <div class="input-note">market / limit (%)</div>
        </td>
        <td>${formatRub(metrics.toWinRub, 0)}</td>
        <td>${formatUsdPair(metrics.hedgeUsdMarket, metrics.hedgeUsdLimit)}</td>
        <td>${formatNumber(metrics.shares, 2)}</td>
        <td>${formatFeeDisplay(metrics.feeTotalUsd)}</td>
        <td>${formatRub(metrics.wonPolyRub, 0)}</td>
        <td>${formatRub(metrics.wonBettingRub, 0)}</td>
        <td class="${profitTone(metrics.profitMarketRub, metrics.profitLimitRub)}">${formatRubPair(metrics.profitMarketRub, metrics.profitLimitRub)}</td>
        <td>${arbFlag(metrics)}</td>
        <td>
          <div class="row-actions">
            <button class="action-button ${hasAnyDirty(dirty) ? 'primary' : 'ghost'}" data-save-row="${item.pair_id}" type="button">Save</button>
            <button class="action-button" data-reset-row="${item.pair_id}" type="button">Reset</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', handleDraftInput);
    input.addEventListener('focus', () => {
      state.selectedPairId = input.dataset.pairId;
      renderPairDetail();
    });
    input.addEventListener('blur', () => renderDashboard());
  });

  body.querySelectorAll('[data-select-row]').forEach((cell) => {
    cell.addEventListener('click', () => {
      state.selectedPairId = cell.dataset.selectRow;
      renderDashboard();
    });
  });
  body.querySelectorAll('[data-save-row]').forEach((button) => {
    button.addEventListener('click', () => saveRow(button.dataset.saveRow, button));
  });
  body.querySelectorAll('[data-reset-row]').forEach((button) => {
    button.addEventListener('click', () => resetRow(button.dataset.resetRow));
  });
}

function buildCashMetrics(snapshot, draft) {
  const bookOdds = parseLocalizedDecimal(draft.bookmakerOdds, snapshot.bookmaker_market.effective_decimal_odds);
  const marketNet = parseDisplayPercentPrice(draft.polyMarket, snapshot.price_views?.market_net);
  const limitNet = parseDisplayPercentPrice(draft.polyLimit, snapshot.price_views?.limit_candidate);
  const marketGross = grossFromAllIn(marketNet, deriveFeeRate(snapshot));
  const fx = getFxRubPerUsd();
  const stake = getCashStakeRub();
  const toWinRub = Number.isFinite(bookOdds) ? stake * bookOdds : null;
  const shares = Number.isFinite(toWinRub) && fx > 0 ? toWinRub / fx : null;
  const hedgeUsdMarket = shares == null || marketNet == null ? null : shares * marketNet;
  const hedgeUsdLimit = shares == null || limitNet == null ? null : shares * limitNet;
  const wonPolyRub = shares == null ? null : shares * fx;
  const wonBettingRub = toWinRub;
  const profitMarketRub = hedgeUsdMarket == null || toWinRub == null ? null : toWinRub - stake - hedgeUsdMarket * fx;
  const profitLimitRub = hedgeUsdLimit == null || toWinRub == null ? null : toWinRub - stake - hedgeUsdLimit * fx;
  const feePerShare = marketNet == null || marketGross == null ? null : marketNet - marketGross;
  const feeTotalUsd = shares == null || feePerShare == null ? null : shares * feePerShare;

  return {
    bookOdds,
    marketNet,
    limitNet,
    marketGross,
    toWinRub,
    shares,
    feeTotalUsd,
    hedgeUsdMarket,
    hedgeUsdLimit,
    wonPolyRub,
    wonBettingRub,
    profitMarketRub,
    profitLimitRub,
  };
}

function getSelectedSnapshot() {
  const rows = getSnapshots();
  return rows.find((item) => item.pair_id === state.selectedPairId) || rows[0] || null;
}

function renderPairDetail() {
  const root = document.getElementById('pairDetail');
  const snapshot = getSelectedSnapshot();
  if (!snapshot) {
    root.innerHTML = '<div class="mini-note">No row selected.</div>';
    return;
  }
  const draft = state.drafts[snapshot.pair_id] || {};
  const metrics = buildCashMetrics(snapshot, draft);
  root.innerHTML = `
    <div class="detail-list">
      <div class="detail-row"><strong>Event</strong><span>${escapeHtml(getEventDisplayName(snapshot))}</span></div>
      <div class="detail-row"><strong>Book side</strong><span>${escapeHtml(snapshot.bookmaker_market.outcome_label)}</span></div>
      <div class="detail-row"><strong>Starts</strong><span>${escapeHtml(formatEventStart(snapshot.bookmaker_market.event_start_at))}</span></div>
      <div class="detail-row"><strong>Source captured</strong><span>${escapeHtml(formatEventStart(snapshot.bookmaker_input?.captured_at || state.payload?.summary?.source_captured_at))}</span></div>
      <div class="detail-row"><strong>Poly price</strong><span>market ${formatPercentPrice(metrics.marketNet)} · limit ${formatPercentPrice(metrics.limitNet)}</span></div>
      <div class="detail-row"><strong>Fee</strong><span>${formatFeeDisplay(metrics.feeTotalUsd)}</span></div>
      <div class="detail-row"><strong>Total hedge USD</strong><span>market ${formatUsd(metrics.hedgeUsdMarket)} · limit ${formatUsd(metrics.hedgeUsdLimit)}</span></div>
      <div class="detail-row"><strong>Locked profit cash</strong><span>market ${formatRub(metrics.profitMarketRub, 0)} · limit ${formatRub(metrics.profitLimitRub, 0)}</span></div>
      <div class="detail-row"><strong>Mapping</strong><span>${escapeHtml(snapshot.pair.mapping_status)} · ${Math.round((snapshot.pair.mapping_confidence || 0) * 100)}%</span></div>
      <div class="detail-row"><strong>Hedge</strong><span>${escapeHtml(snapshot.pair.hedge_strategy || snapshot.pair.poly_hedge_side || '—')} · ${escapeHtml(snapshot.pair.settlement_scope || '—')}</span></div>
      <div class="detail-row"><strong>Basis risk</strong><span>${escapeHtml(snapshot.pair.basis_risk || 'NONE')}</span></div>
      <div class="detail-row"><strong>Comment</strong><span>${escapeHtml(snapshot.pair.settlement_caveat || '—')}</span></div>
    </div>
  `;
}

function renderSecondaryVisibility() {
  const panel = document.getElementById('secondaryPanel');
  panel.classList.toggle('hidden', !state.secondaryOpen);
  document.getElementById('toggleSecondary').textContent = state.secondaryOpen ? 'Hide notes' : 'Notes';
}

async function saveRow(pairId, button) {
  const snapshot = getSnapshots().find((item) => item.pair_id === pairId);
  if (!snapshot) return;
  const draft = state.drafts[pairId] || {};
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await Promise.all([
      fetchJson(`/api/markets/${encodeURIComponent(snapshot.bookmaker_market.bookmaker_market_id)}/odds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_decimal_odds: parseDraftNumberForSave(draft.bookmakerOdds) }),
      }),
      fetchJson(`/api/pairs/${encodeURIComponent(pairId)}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poly_no_market_override: parseDraftNumberForSave(draft.polyMarket, { mode: 'marketNet', feeRate: deriveFeeRate(snapshot) }),
          poly_no_limit_override: parseDraftNumberForSave(draft.polyLimit, { mode: 'limitRaw' }),
        }),
      }),
    ]);
    await loadDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Save failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Save';
  }
}

async function resetRow(pairId) {
  const snapshot = getSnapshots().find((item) => item.pair_id === pairId);
  if (!snapshot) return;
  state.drafts[pairId] = {
    bookmakerOdds: formatRawNumber(snapshot.bookmaker_market.captured_decimal_odds, 2),
    polyMarket: formatMarketDisplayInput(snapshot.price_views?.market_net),
    polyLimit: formatLimitDisplayInput(snapshot.price_views?.limit_candidate),
  };
  renderDashboard();
  try {
    await Promise.all([
      fetchJson(`/api/markets/${encodeURIComponent(snapshot.bookmaker_market.bookmaker_market_id)}/odds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_decimal_odds: '' }),
      }),
      fetchJson(`/api/pairs/${encodeURIComponent(pairId)}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poly_no_market_override: '',
          poly_no_limit_override: '',
        }),
      }),
    ]);
    await loadDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Reset failed: ${error.message}`;
  }
}

async function createManualEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.captured_decimal_odds = Number(payload.captured_decimal_odds);
  const status = document.getElementById('manualFormStatus');
  status.textContent = 'Saving…';
  try {
    await fetchJson('/api/manual-inputs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    form.reset();
    status.textContent = 'Saved.';
    await loadDashboard();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

function handleDraftInput(event) {
  const { pairId, field } = event.target.dataset;
  state.selectedPairId = pairId;
  state.drafts[pairId] = state.drafts[pairId] || {};
  state.drafts[pairId][field] = event.target.value;
  event.target.classList.toggle('dirty', isFieldDirty(pairId, field));
  updateSaveButton(pairId);
  renderPairDetail();
}

function handleSettingInput(event) {
  const field = event.target.dataset.settingField;
  state.settings[field] = event.target.value;
  syncSettingInputs(field, event.target.value, event.target);
  renderSummaryBar();
  renderPairDetail();
}

function updateSaveButton(pairId) {
  const snapshot = getSnapshots().find((item) => item.pair_id === pairId);
  const button = document.querySelector(`[data-save-row="${CSS.escape(pairId)}"]`);
  if (!snapshot || !button) return;
  const dirty = isDirty(snapshot, state.drafts[pairId] || {});
  button.classList.toggle('primary', hasAnyDirty(dirty));
  button.classList.toggle('ghost', !hasAnyDirty(dirty));
}

function syncSettingInputs(field, value, sourceEl = null) {
  const topEl = document.getElementById(field);
  if (topEl && topEl !== sourceEl) topEl.value = value;
  document.querySelectorAll(`[data-setting-field="${field}"]`).forEach((input) => {
    if (input !== sourceEl) input.value = value;
  });
}

function isFieldDirty(pairId, field) {
  const snapshot = getSnapshots().find((item) => item.pair_id === pairId);
  if (!snapshot) return false;
  return isDirty(snapshot, state.drafts[pairId] || {})[fieldToDirtyKey(field)];
}

function fieldToDirtyKey(field) {
  if (field === 'bookmakerOdds') return 'bookmaker';
  if (field === 'polyMarket') return 'polyMarket';
  if (field === 'polyLimit') return 'polyLimit';
  return field;
}

function isDirty(snapshot, draft) {
  return {
    bookmaker: normalizeInputValue(parseLocalizedDecimal(draft.bookmakerOdds, null)) !== normalizeInputValue(snapshot.bookmaker_market.effective_decimal_odds),
    polyMarket: normalizeInputValue(grossFromAllIn(parseDisplayPercentPrice(draft.polyMarket, null), deriveFeeRate(snapshot))) !== normalizeInputValue(snapshot.poly_no_market_exec),
    polyLimit: normalizeInputValue(parseDisplayPercentPrice(draft.polyLimit, null)) !== normalizeInputValue(snapshot.poly_no_limit_candidate),
  };
}

function hasAnyDirty(dirty) {
  return dirty.bookmaker || dirty.polyMarket || dirty.polyLimit;
}

function normalizeInputValue(value) {
  if (value === '' || value == null || Number.isNaN(Number(value))) return '';
  return String(Number(value));
}

function parseLocalizedDecimal(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '' || normalized === '.' || normalized === '-') return fallback;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function parseDraftPrice(value, fallback) {
  const number = parseLocalizedDecimal(value, null);
  if (number == null) return fallback;
  return number > 1 ? number / 100 : number;
}

function parseDisplayPercentPrice(value, fallback) {
  const number = parseLocalizedDecimal(value, null);
  if (number == null) return fallback;
  return number > 1 ? number / 100 : number;
}

function parseDraftNumberForSave(value, options = {}) {
  if (value === '' || value == null) return '';
  const number = parseDisplayPercentPrice(value, null);
  if (number == null) return '';
  if (options.mode === 'marketNet') {
    return grossFromAllIn(number, Number(options.feeRate || 0));
  }
  return number;
}

function formatPercentInput(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return trimTrailingZeros((Number(value) * 100).toFixed(2));
}

function formatMarketDisplayInput(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return trimTrailingZeros((Number(value) * 100).toFixed(2));
}

function formatLimitDisplayInput(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return String(Math.round(Number(value) * 100));
}

function formatRawNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return trimTrailingZeros(Number(value).toFixed(digits));
}

function trimTrailingZeros(value) {
  return String(value).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function getCashStakeRub() {
  return parseLocalizedDecimal(state.settings.cashStakeRub, 0) || 0;
}

function getFxRubPerUsd() {
  return parseLocalizedDecimal(state.settings.fxRubPerUsd, 0) || 0;
}

function getEventDisplayName(snapshot) {
  return snapshot.polymarket_market?.question || snapshot.bookmaker_market.event_title;
}

function grossFromAllIn(allInPrice, feeRate) {
  if (allInPrice == null || !Number.isFinite(allInPrice)) return null;
  const rate = Number(feeRate || 0);
  if (!rate) return allInPrice;
  const discriminant = ((1 + rate) ** 2) - (4 * rate * allInPrice);
  if (discriminant < 0) return allInPrice;
  return ((1 + rate) - Math.sqrt(discriminant)) / (2 * rate);
}

function deriveFeeRate(snapshot) {
  const raw = Number(snapshot.poly_no_market_exec);
  const net = Number(snapshot.price_views?.market_net);
  if (!Number.isFinite(raw) || !Number.isFinite(net) || raw <= 0 || raw >= 1) return 0;
  const denom = raw * (1 - raw);
  return denom > 0 ? Math.max(0, (net - raw) / denom) : 0;
}

function applyFee(raw, feeRate) {
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw + feeRate * raw * (1 - raw);
}

function feePct(raw, trueCost) {
  if (!Number.isFinite(raw) || !Number.isFinite(trueCost) || raw <= 0) return null;
  return ((trueCost / raw) - 1) * 100;
}

function formatPercentPrice(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${trimTrailingZeros((Number(value) * 100).toFixed(2))}%`;
}

function formatPctPair(a, b) {
  return `${formatPlainPct(a)} / ${formatPlainPct(b)}`;
}

function formatFeeDisplay(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${formatUsd(value)} / —`;
}

function formatPlainPct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function formatRub(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return numberFmt.format(Number(value).toFixed ? Number(Number(value).toFixed(digits)) : value);
}

function formatUsd(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function formatUsdPair(a, b) {
  return `${formatUsd(a)} / ${formatUsd(b)}`;
}

function formatRubPair(a, b) {
  return `${formatRub(a, 0)} / ${formatRub(b, 0)}`;
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

function arbFlag(metrics) {
  const positive = [metrics.profitMarketRub, metrics.profitLimitRub].some((value) => Number.isFinite(value) && value > 0);
  return positive ? 'ARB' : 'NO ARB';
}

function profitTone(a, b) {
  const best = Math.max(a ?? -1e9, b ?? -1e9);
  if (best > 0) return 'profit-good';
  if (best > -50) return 'profit-warn';
  return 'profit-bad';
}

function opportunityCategoryLabel(category) {
  if (category === 'market') return 'Market';
  if (category === 'limit') return 'Limit';
  if (category === 'basis_risk') return 'Basis risk';
  return category || '';
}

function opportunityBadge(category, risk) {
  const suffix = category === 'basis_risk' && risk && risk !== 'NONE' ? `: ${risk}` : '';
  return `<span class="opportunity-badge ${escapeAttr(category)}">${escapeHtml(opportunityCategoryLabel(category) + suffix)}</span>`;
}

function sportLabel(key) {
  const match = state.payload?.filters?.sports?.find((item) => item.key === key);
  return match?.label || key || 'Sport';
}

function prettyBookName(key) {
  const labels = { winline: 'Winline', fonbet: 'Fonbet', ligastavok: 'Liga Stavok' };
  return labels[key] || key;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
