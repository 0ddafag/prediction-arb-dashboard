const state = {
  payload: null,
  selectedPairId: null,
  filters: {
    sourceMode: 'all',
    minEdge: 0,
    mappedOnly: true,
  },
  scenarioOdds: null,
  targetProfitPct: 2,
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
    state.filters.minEdge = Number(event.target.value || 0);
    renderDashboard();
  });
  document.getElementById('mappedOnly').addEventListener('change', (event) => {
    state.filters.mappedOnly = event.target.checked;
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
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString()}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Ошибка загрузки: ${error.message}`;
  }
}

async function refreshDashboard() {
  const button = document.getElementById('refreshButton');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const payload = await fetchJson('/api/refresh', { method: 'POST' });
    state.payload = payload;
    document.getElementById('generatedAt').textContent = `Updated ${new Date(payload.generatedAt).toLocaleString()}`;
    renderDashboard();
  } catch (error) {
    document.getElementById('generatedAt').textContent = `Refresh failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh Polymarket';
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
  renderMetrics();
  renderLegendSummary();
  renderOpportunities();
  renderInbox();
  renderPairDetail();
  renderCalculator();
  renderFeaturedMarkets();
}

function renderMetrics() {
  const summary = state.payload.summary;
  const cards = [
    ['Mapped pairs', summary.mapped_pairs, 'Mapped bookmaker ↔ Polymarket rows in dashboard'],
    ['Inbox items', summary.ingestion_items, 'Raw screenshot/manual captures held in review queue'],
    ['Editable markets', summary.editable_markets, 'Normalized bookmaker rows with captured / edited / effective odds'],
    ['Best net limit edge', summary.best_net_edge_limit == null ? '—' : pct(summary.best_net_edge_limit), 'Best current net edge using limit candidate'],
  ];
  document.getElementById('metricCards').innerHTML = cards.map(([label, value, detail]) => `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(label)}</p>
      <p class="metric-value">${escapeHtml(String(value))}</p>
      <p class="metric-detail">${escapeHtml(detail)}</p>
    </article>
  `).join('');
}

function renderLegendSummary() {
  const adapters = state.payload.source_mode_adapters;
  document.getElementById('legendSummary').innerHTML = `
    <span class="legend-chip">manual adapter: ${escapeHtml(adapters.screenshot_manual.status)}</span>
    <span class="legend-chip">machine adapter: ${escapeHtml(adapters.machine_fetch.status)}</span>
    <span class="legend-chip">featured poly rows: ${state.payload.featured_polymarket_markets.length}</span>
  `;
}

function renderOpportunities() {
  const rows = getFilteredSnapshots();
  const body = document.getElementById('opportunitiesBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" class="loading-cell">No rows match current filters.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((item) => {
    const active = item.pair_id === state.selectedPairId ? ' class="active-row"' : '';
    return `
      <tr data-pair-id="${item.pair_id}"${active}>
        <td><span class="status-pill ${edgeClass(item.net_edge_limit)}">${escapeHtml(item.pair.mapping_status)}</span></td>
        <td>
          <button class="row-link" data-pair-id="${item.pair_id}">${escapeHtml(item.bookmaker_market.event_title)}</button>
          <div class="inline-subcount">${escapeHtml(item.bookmaker_market.outcome_label)} · ${escapeHtml(item.bookmaker_market.market_type)}</div>
        </td>
        <td>${escapeHtml(item.bookmaker_market.source_mode)}</td>
        <td>${formatOdds(item.bookmaker_market.effective_decimal_odds)}</td>
        <td>${formatPct(item.bookmaker_implied_prob)}</td>
        <td>${formatPct(item.poly_no_market_exec)}</td>
        <td>${formatPct(item.poly_no_limit_candidate)}</td>
        <td>${formatPct(item.poly_no_easy_limit_candidate)} <span class="inline-subcount">score ${item.price_views.easy_limit_score ?? '—'}</span></td>
        <td>${pct(item.net_edge_market)} / ${pct(item.net_edge_limit)} / ${pct(item.net_edge_easy_limit)}</td>
        <td>${item.max_executable_size == null ? '—' : numberFmt.format(item.max_executable_size)}</td>
        <td>${relativeTime(item.computed_at)}</td>
      </tr>
    `;
  }).join('');

  body.querySelectorAll('.row-link').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPairId = button.dataset.pairId;
      state.scenarioOdds = null;
      renderDashboard();
    });
  });
}

function renderInbox() {
  const root = document.getElementById('inboxList');
  root.innerHTML = state.payload.bookmaker_inputs.map((item) => `
    <article class="inbox-card ${item.mapping_status === 'mapped' ? 'mapped' : ''}">
      <div class="inbox-topline">
        <span class="pill small">${escapeHtml(item.source_mode)}</span>
        <span class="pill small pill-muted">confidence ${Math.round(item.parse_confidence * 100)}%</span>
        <span class="pill small ${item.mapping_status === 'mapped' ? 'pill-green' : 'pill-muted'}">${escapeHtml(item.mapping_status)}</span>
      </div>
      <strong>${escapeHtml(item.event_raw)}</strong>
      <p>${escapeHtml(item.market_type_raw)} · captured ${new Date(item.captured_at).toLocaleString()}</p>
      <p class="subdued">${escapeHtml(item.source_ref || 'manual')}</p>
      <p class="subdued">${escapeHtml(item.review_notes || '')}</p>
    </article>
  `).join('');
}

function getSelectedSnapshot() {
  const rows = state.payload?.arb_snapshots || [];
  return rows.find((item) => item.pair_id === state.selectedPairId) || rows[0] || null;
}

function renderPairDetail() {
  const root = document.getElementById('pairDetail');
  const snapshot = getSelectedSnapshot();
  if (!snapshot) {
    root.innerHTML = '<p class="subdued">Нет mapped pair.</p>';
    return;
  }
  const poly = snapshot.polymarket_market;
  const book = snapshot.bookmaker_market;
  const input = snapshot.bookmaker_input;
  root.innerHTML = `
    <div class="detail-grid">
      <section class="detail-card">
        <p class="eyebrow">1. Event identity</p>
        <h3>${escapeHtml(book.event_title)}</h3>
        <p>${escapeHtml(book.outcome_label)} · mapping confidence ${Math.round(snapshot.pair.mapping_confidence * 100)}%</p>
        <p class="subdued">Settlement caveat: ${escapeHtml(snapshot.pair.settlement_caveat)}</p>
      </section>
      <section class="detail-card">
        <p class="eyebrow">2. Bookmaker raw capture</p>
        <p><strong>source_ref:</strong> ${escapeHtml(input.source_ref || 'manual')}</p>
        <p><strong>captured_odds:</strong> ${formatOdds(book.captured_decimal_odds)}</p>
        <p><strong>edited_odds:</strong> ${book.edited_decimal_odds == null ? '—' : formatOdds(book.edited_decimal_odds)}</p>
        <p><strong>effective_odds:</strong> ${formatOdds(book.effective_decimal_odds)}</p>
      </section>
      <section class="detail-card">
        <p class="eyebrow">3. Polymarket execution</p>
        <p><strong>question:</strong> ${escapeHtml(poly.question)}</p>
        <p><strong>YES bid/ask:</strong> ${formatPct(poly.bestBid)} / ${formatPct(poly.bestAsk)}</p>
        <p><strong>NO market/limit/easy:</strong> ${formatPct(snapshot.poly_no_market_exec)} / ${formatPct(snapshot.poly_no_limit_candidate)} / ${formatPct(snapshot.poly_no_easy_limit_candidate)}</p>
        <p><strong>easy score:</strong> ${snapshot.price_views.easy_limit_score ?? '—'} · <strong>liquidity:</strong> ${numberFmt.format(poly.liquidityClob || 0)}</p>
      </section>
      <section class="detail-card">
        <p class="eyebrow">4. Arb math</p>
        <p><strong>book threshold:</strong> ${formatPct(snapshot.price_views.threshold)}</p>
        <p><strong>gross edge:</strong> ${pct(snapshot.gross_edge_market)} / ${pct(snapshot.gross_edge_limit)} / ${pct(snapshot.gross_edge_easy_limit)}</p>
        <p><strong>net edge:</strong> ${pct(snapshot.net_edge_market)} / ${pct(snapshot.net_edge_limit)} / ${pct(snapshot.net_edge_easy_limit)}</p>
        <p><strong>breakeven odds:</strong> ${formatOdds(snapshot.price_views.breakeven_odds.market_exec)} / ${formatOdds(snapshot.price_views.breakeven_odds.limit_candidate)} / ${formatOdds(snapshot.price_views.breakeven_odds.easy_limit_candidate)}</p>
      </section>
    </div>
  `;
}

function renderCalculator() {
  const snapshot = getSelectedSnapshot();
  const editor = document.getElementById('calculatorEditor');
  const results = document.getElementById('calculatorResults');
  const sandboxRows = state.payload.manual_sandbox_rows || [];

  if (!snapshot) {
    editor.innerHTML = '<p class="subdued">Select a mapped row first.</p>';
    results.innerHTML = '<p class="subdued">Нет данных.</p>';
    return;
  }

  const book = snapshot.bookmaker_market;
  if (state.scenarioOdds == null) {
    state.scenarioOdds = book.effective_decimal_odds;
  }

  editor.innerHTML = `
    <div class="form-grid calculator-form">
      <label class="field">
        <span>captured_odds</span>
        <input id="capturedOdds" value="${book.captured_decimal_odds ?? ''}" disabled />
      </label>
      <label class="field">
        <span>edited_odds (saved)</span>
        <input id="editedOdds" type="number" step="0.01" min="1.01" value="${book.edited_decimal_odds ?? ''}" />
      </label>
      <label class="field">
        <span>scenario_odds (unsaved sandbox)</span>
        <input id="scenarioOdds" type="number" step="0.01" min="1.01" value="${state.scenarioOdds ?? ''}" />
      </label>
      <label class="field">
        <span>target profit %</span>
        <input id="targetProfitPct" type="number" step="0.1" value="${state.targetProfitPct}" />
      </label>
      <div class="form-actions full-width">
        <button class="action-button" id="saveEditedOdds" type="button">Save edited_odds</button>
        <button class="action-button secondary" id="resetToCaptured" type="button">Reset to captured</button>
      </div>
    </div>
    <div class="subdued" style="margin-top:16px;">Unmapped 1X2 sandbox rows: ${sandboxRows.map((row) => `${row.outcome_key} ${formatOdds(row.effective_decimal_odds)}`).join(' · ') || 'none'}</div>
  `;

  document.getElementById('scenarioOdds').addEventListener('input', (event) => {
    state.scenarioOdds = Number(event.target.value || 0);
    renderCalculator();
  });
  document.getElementById('targetProfitPct').addEventListener('input', (event) => {
    state.targetProfitPct = Number(event.target.value || 0);
    renderCalculator();
  });
  document.getElementById('saveEditedOdds').addEventListener('click', () => saveEditedOdds(book.bookmaker_market_id));
  document.getElementById('resetToCaptured').addEventListener('click', () => resetToCaptured(book));

  const scenarioThreshold = 1 - 1 / state.scenarioOdds;
  const views = [
    ['market_exec', snapshot.price_views.market_net],
    ['limit_candidate', snapshot.price_views.limit_net],
    ['easy_limit_candidate', snapshot.price_views.easy_net],
  ];

  results.innerHTML = `
    <div class="calc-table">
      ${views.map(([label, polyCost]) => {
        const breakeven = polyCost != null && polyCost < 1 ? 1 / (1 - polyCost) : null;
        const targetOdds = polyCost != null && (1 - polyCost - state.targetProfitPct / 100) > 0
          ? 1 / (1 - polyCost - state.targetProfitPct / 100)
          : null;
        const edge = polyCost != null ? scenarioThreshold - polyCost : null;
        return `
          <div class="calc-row">
            <strong>${label}</strong>
            <span>poly NO all-in: ${formatPct(polyCost)}</span>
            <span>current edge: ${pct(edge)}</span>
            <span>breakeven odds: ${formatOdds(breakeven)}</span>
            <span>odds for ${state.targetProfitPct}% target: ${formatOdds(targetOdds)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function saveEditedOdds(bookmakerMarketId) {
  const input = document.getElementById('editedOdds');
  await fetchJson(`/api/markets/${encodeURIComponent(bookmakerMarketId)}/odds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edited_decimal_odds: input.value }),
  });
  await loadDashboard();
}

async function resetToCaptured(book) {
  state.scenarioOdds = book.captured_decimal_odds;
  await fetchJson(`/api/markets/${encodeURIComponent(book.bookmaker_market_id)}/odds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edited_decimal_odds: '' }),
  });
  await loadDashboard();
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
    status.textContent = 'Saved. Inbox and sandbox updated.';
    await loadDashboard();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

function renderFeaturedMarkets() {
  const body = document.getElementById('featuredMarketsBody');
  body.innerHTML = state.payload.featured_polymarket_markets.map((market) => `
    <tr>
      <td>${market.id}</td>
      <td>${escapeHtml(market.question)}</td>
      <td>${formatPct(market.bestBid)} / ${formatPct(market.bestAsk)}</td>
      <td>${escapeHtml((market.outcomePrices || []).join(' / '))}</td>
      <td>${numberFmt.format(market.liquidityClob || 0)}</td>
      <td>${numberFmt.format(market.volume24hr || 0)}</td>
    </tr>
  `).join('');
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

function relativeTime(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function edgeClass(value) {
  if (value == null) return 'neutral';
  if (value > 0.03) return 'actual';
  if (value > 0) return 'forecast';
  return 'neutral';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
