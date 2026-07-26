const state = {
  payload: null,
  selectedPairId: null,
  secondaryOpen: false,
  drafts: {},
  settings: {
    cashStakeRub: 1725,
    fxRubPerUsd: 81,
  },
};

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

window.addEventListener('DOMContentLoaded', () => {
  bindControls();
  loadDashboard();
});

function bindControls() {
  document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
  document.getElementById('toggleSecondary').addEventListener('click', () => {
    state.secondaryOpen = !state.secondaryOpen;
    renderSecondaryVisibility();
  });
  document.getElementById('cashStakeRub').addEventListener('input', (event) => {
    state.settings.cashStakeRub = Number(event.target.value || 0);
    renderDashboard();
  });
  document.getElementById('fxRubPerUsd').addEventListener('input', (event) => {
    state.settings.fxRubPerUsd = Number(event.target.value || 0);
    renderDashboard();
  });
  document.getElementById('manualEntryForm').addEventListener('submit', createManualEntry);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadDashboard() {
  try {
    const payload = await fetchJson('/api/data');
    state.payload = payload;
    if (!state.selectedPairId) {
      state.selectedPairId = payload.arb_snapshots[0]?.pair_id || null;
    }
    if (state.selectedPairId && !payload.arb_snapshots.some((item) => item.pair_id === state.selectedPairId)) {
      state.selectedPairId = payload.arb_snapshots[0]?.pair_id || null;
    }
    syncDraftsWithPayload();
    document.getElementById('generatedAt').textContent = `Обновлено ${new Date(payload.generatedAt).toLocaleString('ru-RU')}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Ошибка загрузки: ${error.message}`;
  }
}

function syncDraftsWithPayload() {
  const nextDrafts = {};
  for (const snapshot of state.payload?.arb_snapshots || []) {
    const existing = state.drafts[snapshot.pair_id] || {};
    nextDrafts[snapshot.pair_id] = {
      bookmakerOdds: existing.bookmakerOdds ?? normalizeInputValue(snapshot.bookmaker_market.effective_decimal_odds),
      polyMarket: existing.polyMarket ?? normalizeInputValue(snapshot.poly_no_market_exec),
      polyLimit: existing.polyLimit ?? normalizeInputValue(snapshot.poly_no_limit_candidate),
    };
  }
  state.drafts = nextDrafts;
}

async function refreshDashboard() {
  const button = document.getElementById('refreshButton');
  button.disabled = true;
  button.textContent = 'Обновляю…';
  try {
    const payload = await fetchJson('/api/refresh', { method: 'POST' });
    state.payload = payload;
    syncDraftsWithPayload();
    document.getElementById('generatedAt').textContent = `Обновлено ${new Date(payload.generatedAt).toLocaleString('ru-RU')}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Refresh failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh';
  }
}

function getSnapshots() {
  return (state.payload?.arb_snapshots || [])
    .filter((item) => item.bookmaker_market?.sport === 'mlb')
    .sort((a, b) => {
      const timeDiff = new Date(a.bookmaker_market.event_start_at).getTime() - new Date(b.bookmaker_market.event_start_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      const titleDiff = a.bookmaker_market.event_title.localeCompare(b.bookmaker_market.event_title, 'ru');
      if (titleDiff !== 0) return titleDiff;
      return a.bookmaker_market.outcome_label.localeCompare(b.bookmaker_market.outcome_label, 'ru');
    });
}

function renderDashboard() {
  if (!state.payload) return;
  renderSummaryBar();
  renderOpportunities();
  renderPairDetail();
  renderSecondaryVisibility();
}

function renderSummaryBar() {
  const rows = getSnapshots();
  const uniqueEvents = new Set(rows.map((item) => item.bookmaker_market.event_title)).size;
  document.getElementById('summaryBar').innerHTML = `
    <span class="summary-pill">матчей ${uniqueEvents}</span>
    <span class="summary-pill">строк ${rows.length}</span>
    <span class="summary-pill">ставка ₽${formatRub(state.settings.cashStakeRub, 0)}</span>
    <span class="summary-pill">курс ${formatNumber(state.settings.fxRubPerUsd, 2)}</span>
  `;
}

function renderOpportunities() {
  const rows = getSnapshots();
  const body = document.getElementById('opportunitiesBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="14" class="loading-cell">Нет строк MLB.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((item) => {
    const draft = state.drafts[item.pair_id] || {};
    const dirty = isDirty(item, draft);
    const selected = item.pair_id === state.selectedPairId ? 'selected' : '';
    const metrics = buildCashMetrics(item, draft);
    return `
      <tr class="${selected}" data-pair-id="${item.pair_id}">
        <td>${escapeHtml(prettyBookName(item.bookmaker_market.bookmaker_key))}</td>
        <td class="event-cell" data-select-row="${item.pair_id}">
          <div class="event-title">${escapeHtml(item.bookmaker_market.event_title)}</div>
          <div class="event-meta">${escapeHtml(item.bookmaker_market.outcome_label)}</div>
        </td>
        <td class="odds-cell">
          <input class="odds-input ${dirty.bookmaker ? 'dirty' : ''}" data-field="bookmakerOdds" data-pair-id="${item.pair_id}" type="number" step="0.01" min="1.01" value="${escapeAttr(draft.bookmakerOdds ?? '')}" />
        </td>
        <td class="odds-cell poly-cell">
          <input class="odds-input ${dirty.polyMarket ? 'dirty' : ''}" data-field="polyMarket" data-pair-id="${item.pair_id}" type="number" step="0.01" min="0.01" max="0.99" value="${escapeAttr(asCentsInput(draft.polyMarket))}" />
          <input class="odds-input ${dirty.polyLimit ? 'dirty' : ''}" data-field="polyLimit" data-pair-id="${item.pair_id}" type="number" step="0.01" min="0.01" max="0.99" value="${escapeAttr(asCentsInput(draft.polyLimit))}" />
          <div class="input-note">mkt / lim (%)</div>
        </td>
        <td>${formatRub(state.settings.cashStakeRub, 0)}</td>
        <td>${formatRub(metrics.toWinRub, 0)}</td>
        <td>${formatNumber(state.settings.fxRubPerUsd, 2)}</td>
        <td>${formatUsdPair(metrics.hedgeUsdMarketRaw, metrics.hedgeUsdLimitRaw)}</td>
        <td>${formatNumber(metrics.shares, 2)}</td>
        <td>${formatPctPair(metrics.feeMarketPct, metrics.feeLimitPct)}</td>
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
  const bookOdds = Number(draft.bookmakerOdds || snapshot.bookmaker_market.effective_decimal_odds || 0);
  const marketRaw = parseDraftPrice(draft.polyMarket, snapshot.poly_no_market_exec);
  const limitRaw = parseDraftPrice(draft.polyLimit, snapshot.poly_no_limit_candidate);
  const fx = Number(state.settings.fxRubPerUsd || 0);
  const stake = Number(state.settings.cashStakeRub || 0);
  const toWinRub = stake * bookOdds;
  const shares = fx > 0 ? toWinRub / fx : null;
  const feeRate = deriveFeeRate(snapshot);
  const marketTrue = applyFee(marketRaw, feeRate);
  const limitTrue = applyFee(limitRaw, feeRate);
  const hedgeUsdMarketRaw = shares == null || marketRaw == null ? null : shares * marketRaw;
  const hedgeUsdLimitRaw = shares == null || limitRaw == null ? null : shares * limitRaw;
  const hedgeUsdMarketTrue = shares == null || marketTrue == null ? null : shares * marketTrue;
  const hedgeUsdLimitTrue = shares == null || limitTrue == null ? null : shares * limitTrue;
  const wonPolyRub = shares == null ? null : shares * fx;
  const wonBettingRub = toWinRub || null;
  const profitMarketRub = hedgeUsdMarketTrue == null ? null : toWinRub - stake - hedgeUsdMarketTrue * fx;
  const profitLimitRub = hedgeUsdLimitTrue == null ? null : toWinRub - stake - hedgeUsdLimitTrue * fx;

  return {
    bookOdds,
    marketRaw,
    limitRaw,
    toWinRub,
    shares,
    feeMarketPct: feePct(marketRaw, marketTrue),
    feeLimitPct: feePct(limitRaw, limitTrue),
    hedgeUsdMarketRaw,
    hedgeUsdLimitRaw,
    hedgeUsdMarketTrue,
    hedgeUsdLimitTrue,
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
    root.innerHTML = '<div class="mini-note">Нет выбранной строки.</div>';
    return;
  }
  const draft = state.drafts[snapshot.pair_id] || {};
  const metrics = buildCashMetrics(snapshot, draft);
  root.innerHTML = `
    <div class="detail-list">
      <div class="detail-row"><strong>Event</strong><span>${escapeHtml(snapshot.bookmaker_market.event_title)}</span></div>
      <div class="detail-row"><strong>Outcome</strong><span>${escapeHtml(snapshot.bookmaker_market.outcome_label)}</span></div>
      <div class="detail-row"><strong>Poly price</strong><span>market ${formatPercentPrice(metrics.marketRaw)} · limit ${formatPercentPrice(metrics.limitRaw)}</span></div>
      <div class="detail-row"><strong>Poly true $</strong><span>market ${formatUsd(metrics.hedgeUsdMarketTrue)} · limit ${formatUsd(metrics.hedgeUsdLimitTrue)}</span></div>
      <div class="detail-row"><strong>Locked profit cash</strong><span>market ${formatRub(metrics.profitMarketRub, 0)} · limit ${formatRub(metrics.profitLimitRub, 0)}</span></div>
      <div class="detail-row"><strong>Mapping</strong><span>${escapeHtml(snapshot.pair.mapping_status)} · ${Math.round((snapshot.pair.mapping_confidence || 0) * 100)}%</span></div>
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
        body: JSON.stringify({ edited_decimal_odds: draft.bookmakerOdds }),
      }),
      fetchJson(`/api/pairs/${encodeURIComponent(pairId)}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poly_no_market_override: parseDraftPrice(draft.polyMarket, null),
          poly_no_limit_override: parseDraftPrice(draft.polyLimit, null),
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
    bookmakerOdds: normalizeInputValue(snapshot.bookmaker_market.captured_decimal_odds),
    polyMarket: normalizeInputValue(snapshot.price_views.derived_market_exec),
    polyLimit: normalizeInputValue(snapshot.price_views.derived_limit_candidate),
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
  renderDashboard();
}

function isDirty(snapshot, draft) {
  return {
    bookmaker: normalizeInputValue(snapshot.bookmaker_market.effective_decimal_odds) !== normalizeInputValue(draft.bookmakerOdds),
    polyMarket: normalizeInputValue(snapshot.poly_no_market_exec) !== normalizeInputValue(parseDraftPrice(draft.polyMarket, null)),
    polyLimit: normalizeInputValue(snapshot.poly_no_limit_candidate) !== normalizeInputValue(parseDraftPrice(draft.polyLimit, null)),
  };
}

function hasAnyDirty(dirty) {
  return dirty.bookmaker || dirty.polyMarket || dirty.polyLimit;
}

function normalizeInputValue(value) {
  if (value === '' || value == null || Number.isNaN(Number(value))) return '';
  return String(Number(value));
}

function parseDraftPrice(value, fallback) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  if (Number.isNaN(number)) return fallback;
  return number > 1 ? number / 100 : number;
}

function asCentsInput(value) {
  if (value === '' || value == null) return '';
  const number = Number(value);
  if (Number.isNaN(number)) return '';
  return String(Math.round(number * 100));
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
  return `${Math.round(Number(value) * 100)}%`;
}

function formatPctPair(a, b) {
  return `${formatPlainPct(a)} / ${formatPlainPct(b)}`;
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

function prettyBookName(key) {
  if (key === 'ligastavok') return 'Liga Stavok';
  return key;
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
