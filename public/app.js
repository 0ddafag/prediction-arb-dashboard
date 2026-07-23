const state = {
  payload: null,
  selectedPairId: null,
  secondaryOpen: false,
  filters: {
    sourceMode: 'all',
    minEdge: 0,
    mappedOnly: true,
  },
  drafts: {},
};

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });

window.addEventListener('DOMContentLoaded', () => {
  bindControls();
  loadDashboard();
});

function bindControls() {
  document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
  document.getElementById('sourceFilter').addEventListener('change', (event) => {
    state.filters.sourceMode = event.target.value;
    renderDashboard();
  });
  document.getElementById('edgeFilter').addEventListener('input', (event) => {
    state.filters.minEdge = Number(event.target.value || 0) / 100;
    renderDashboard();
  });
  document.getElementById('mappedOnly').addEventListener('change', (event) => {
    state.filters.mappedOnly = event.target.checked;
    renderDashboard();
  });
  document.getElementById('toggleSecondary').addEventListener('click', () => {
    state.secondaryOpen = !state.secondaryOpen;
    renderSecondaryVisibility();
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
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString()}`;
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
  button.textContent = 'Refreshing…';
  try {
    const payload = await fetchJson('/api/refresh', { method: 'POST' });
    state.payload = payload;
    syncDraftsWithPayload();
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString()}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Refresh failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh';
  }
}

function getFilteredSnapshots() {
  const sourceMode = state.filters.sourceMode;
  const minEdge = state.filters.minEdge;
  return (state.payload?.arb_snapshots || []).filter((item) => {
    if (state.filters.mappedOnly && item.pair.mapping_status !== 'mapped') return false;
    if (sourceMode !== 'all' && item.bookmaker_market.source_mode !== sourceMode) return false;
    return (item.net_edge_limit ?? -999) >= minEdge;
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
  const rows = getFilteredSnapshots();
  const summary = state.payload.summary;
  const best = rows[0]?.net_edge_limit ?? summary.best_net_edge_limit;
  const warnings = state.payload.diagnostics?.warnings || [];
  document.getElementById('summaryBar').innerHTML = `
    <span class="summary-pill">rows ${rows.length}</span>
    <span class="summary-pill">mapped ${summary.mapped_pairs}</span>
    <span class="summary-pill">editable ${summary.editable_markets}</span>
    <span class="summary-pill">best limit edge ${pct(best)}</span>
    <span class="summary-pill">live warnings ${warnings.length}</span>
  `;
}

function renderOpportunities() {
  const rows = getFilteredSnapshots();
  const body = document.getElementById('opportunitiesBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="loading-cell">No rows match current filters.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((item) => {
    const draft = state.drafts[item.pair_id] || {};
    const dirty = isDirty(item, draft);
    const selected = item.pair_id === state.selectedPairId ? 'selected' : '';
    return `
      <tr class="${selected}" data-pair-id="${item.pair_id}">
        <td class="event-cell" data-select-row="${item.pair_id}">
          <div class="event-title">${escapeHtml(item.bookmaker_market.event_title)}</div>
          <div class="event-meta">${escapeHtml(item.bookmaker_market.outcome_label)} · ${escapeHtml(item.bookmaker_market.market_type)} · ${escapeHtml(item.bookmaker_market.source_mode)}</div>
          <div class="event-meta">captured ${formatOdds(item.bookmaker_market.captured_decimal_odds)} · updated ${relativeTime(item.computed_at)}</div>
        </td>
        <td class="odds-cell">
          <input class="odds-input ${dirty.bookmaker ? 'dirty' : ''}" data-field="bookmakerOdds" data-pair-id="${item.pair_id}" type="number" step="0.01" min="1.01" value="${escapeAttr(draft.bookmakerOdds ?? '')}" />
          <div class="input-note">saved ${formatOdds(item.bookmaker_market.effective_decimal_odds)}</div>
        </td>
        <td class="odds-cell">
          <input class="odds-input ${dirty.polyMarket ? 'dirty' : ''}" data-field="polyMarket" data-pair-id="${item.pair_id}" type="number" step="0.001" min="0.001" max="0.999" value="${escapeAttr(draft.polyMarket ?? '')}" />
          <div class="input-note">NO market</div>
        </td>
        <td class="odds-cell">
          <input class="odds-input ${dirty.polyLimit ? 'dirty' : ''}" data-field="polyLimit" data-pair-id="${item.pair_id}" type="number" step="0.001" min="0.001" max="0.999" value="${escapeAttr(draft.polyLimit ?? '')}" />
          <div class="input-note">NO limit</div>
        </td>
        <td>
          <div class="edge-value ${edgeTone(item.net_edge_easy_limit)}">${pct(item.net_edge_easy_limit)}</div>
          <div class="edge-subtext">price ${formatPct(item.poly_no_easy_limit_candidate)} · easy ${item.price_views.easy_limit_score ?? '—'}</div>
        </td>
        <td>
          <div class="edge-value ${edgeTone(item.net_edge_market)}">${pct(item.net_edge_market)}</div>
          <div class="edge-subtext">${formatPct(item.poly_no_market_exec)}</div>
        </td>
        <td>
          <div class="edge-value ${edgeTone(item.net_edge_limit)}">${pct(item.net_edge_limit)}</div>
          <div class="edge-subtext">${formatPct(item.poly_no_limit_candidate)}</div>
        </td>
        <td>
          <div class="edge-value ${edgeTone(item.net_edge_easy_limit)}">${pct(item.net_edge_easy_limit)}</div>
          <div class="edge-subtext">threshold ${formatPct(item.price_views.threshold)}</div>
        </td>
        <td>
          <div>${item.max_executable_size == null ? '—' : numberFmt.format(item.max_executable_size)}</div>
          <div class="event-meta">${renderStatusPill(item)}</div>
        </td>
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

function renderStatusPill(item) {
  const tone = item.pair.mapping_status === 'mapped' ? 'good' : item.pair.mapping_status === 'candidate' ? 'warn' : 'bad';
  return `<span class="status-pill ${tone}">${escapeHtml(item.pair.mapping_status)}</span>`;
}

function handleDraftInput(event) {
  const { pairId, field } = event.target.dataset;
  state.selectedPairId = pairId;
  state.drafts[pairId] = state.drafts[pairId] || {};
  state.drafts[pairId][field] = event.target.value;

  const snapshot = (state.payload?.arb_snapshots || []).find((item) => item.pair_id === pairId);
  const dirty = snapshot ? isDirty(snapshot, state.drafts[pairId]) : null;
  event.target.classList.toggle('dirty', !!dirty?.[field.replace('Odds', '')]);

  const row = event.target.closest('tr');
  row?.classList.add('selected');
  const saveButton = row?.querySelector('[data-save-row]');
  if (saveButton && dirty) {
    saveButton.classList.toggle('primary', hasAnyDirty(dirty));
    saveButton.classList.toggle('ghost', !hasAnyDirty(dirty));
  }
  renderPairDetail();
}

function getSelectedSnapshot() {
  const rows = state.payload?.arb_snapshots || [];
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
  root.innerHTML = `
    <div class="detail-list">
      <div class="detail-row"><strong>Event</strong><span>${escapeHtml(snapshot.bookmaker_market.event_title)}</span></div>
      <div class="detail-row"><strong>Book</strong><span>captured ${formatOdds(snapshot.bookmaker_market.captured_decimal_odds)} · saved ${formatOdds(snapshot.bookmaker_market.effective_decimal_odds)} · draft ${formatDraftOdds(draft.bookmakerOdds)}</span></div>
      <div class="detail-row"><strong>Poly</strong><span>market ${formatDraftPct(draft.polyMarket)} · limit ${formatDraftPct(draft.polyLimit)} · easy ${formatPct(snapshot.poly_no_easy_limit_candidate)}</span></div>
      <div class="detail-row"><strong>Mapping</strong><span>${escapeHtml(snapshot.pair.mapping_status)} · confidence ${Math.round((snapshot.pair.mapping_confidence || 0) * 100)}%</span></div>
      <div class="detail-row"><strong>Settlement caveat</strong><span>${escapeHtml(snapshot.pair.settlement_caveat || '—')}</span></div>
      <div class="detail-row"><strong>Source</strong><span>${escapeHtml(snapshot.bookmaker_input?.source_ref || 'manual')}</span></div>
      <div class="detail-row"><strong>Live note</strong><span>${escapeHtml(snapshot.calc_notes || '—')}</span></div>
    </div>
  `;
}

function renderSecondaryVisibility() {
  const panel = document.getElementById('secondaryPanel');
  panel.classList.toggle('hidden', !state.secondaryOpen);
  document.getElementById('toggleSecondary').textContent = state.secondaryOpen ? 'Hide secondary' : 'Secondary';
}

async function saveRow(pairId, button) {
  const snapshot = (state.payload?.arb_snapshots || []).find((item) => item.pair_id === pairId);
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
          poly_no_market_override: draft.polyMarket,
          poly_no_limit_override: draft.polyLimit,
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
  const snapshot = (state.payload?.arb_snapshots || []).find((item) => item.pair_id === pairId);
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
    status.textContent = 'Saved. Row added to the table.';
    await loadDashboard();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

function isDirty(snapshot, draft) {
  return {
    bookmaker: normalizeInputValue(snapshot.bookmaker_market.effective_decimal_odds) !== normalizeInputValue(draft.bookmakerOdds),
    polyMarket: normalizeInputValue(snapshot.poly_no_market_exec) !== normalizeInputValue(draft.polyMarket),
    polyLimit: normalizeInputValue(snapshot.poly_no_limit_candidate) !== normalizeInputValue(draft.polyLimit),
  };
}

function hasAnyDirty(dirty) {
  return dirty.bookmaker || dirty.polyMarket || dirty.polyLimit;
}

function normalizeInputValue(value) {
  if (value === '' || value == null || Number.isNaN(Number(value))) return '';
  return String(Number(value));
}

function pct(value) {
  return value == null || Number.isNaN(value) ? '—' : `${(value * 100).toFixed(2)}%`;
}

function formatPct(value) {
  return value == null || Number.isNaN(value) ? '—' : pctFmt.format(value);
}

function formatOdds(value) {
  return value == null || Number.isNaN(value) ? '—' : numberFmt.format(value);
}

function formatDraftPct(value) {
  return value === '' || value == null ? '—' : pct(Number(value));
}

function formatDraftOdds(value) {
  return value === '' || value == null ? '—' : formatOdds(Number(value));
}

function relativeTime(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function edgeTone(value) {
  if (value == null) return 'bad';
  if (value > 0.03) return 'good';
  if (value > 0) return 'warn';
  return 'bad';
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
