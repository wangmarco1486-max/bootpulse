(() => {
  const currency = () => getSymbol(appState.displayCurrency);
  const active = () => getActiveWorkspace();
  const amount = (items) => (items || []).reduce((sum, item) => sum + itemInDisplay(item), 0);
  const currentTotals = () => {
    const ws = active();
    const revenue = amount((ws.revenues || []).filter(item => item.type !== 'one-off'));
    const expenses = amount((ws.expenses || []).filter(item => item.type !== 'one-off'));
    const directCosts = (ws.revenues || []).filter(item => item.type !== 'one-off').reduce((sum, item) => {
      const cost = Number(item.directCost) || 0;
      return sum + convert(cost * (Number(item.qty) || 0), item.currency || 'USD', appState.displayCurrency);
    }, 0);
    return { revenue, expenses, directCosts, cash: convert(ws.cash || 0, ws.cashCurrency || 'USD', appState.displayCurrency) };
  };
  const fmt = value => `${currency()}${Math.round(value).toLocaleString()}`;
  const pct = value => `${value.toFixed(1)}%`;
  const safeText = value => escapeHtml(String(value ?? ''));
  const storedSnapshots = ws => Array.isArray(ws.comparisonSnapshots) ? ws.comparisonSnapshots : (ws.comparisonSnapshots = []);
  const currentSnapshot = () => {
    const ws = active();
    const { revenue, expenses } = currentTotals();
    const { directCosts } = currentTotals();
    const categories = {};
    (ws.expenses || []).filter(item => item.type !== 'one-off').forEach(item => {
      const key = item.category || 'Other';
      categories[key] = (categories[key] || 0) + itemInDisplay(item);
    });
    if (directCosts > 0) categories['Direct costs'] = directCosts;
    return { savedAt: new Date().toISOString(), currency: 'USD', revenue: convert(revenue, appState.displayCurrency, 'USD'), expenses: convert(expenses + directCosts, appState.displayCurrency, 'USD'), categories: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, convert(value, appState.displayCurrency, 'USD')])) };
  };

  window.setPlanTier = tier => {
    appState.tier = tier === 'pro' ? 'pro' : 'free';
    saveState();
    renderProExperience();
  };

  window.saveComparisonSnapshot = () => {
    const ws = active();
    const snapshots = storedSnapshots(ws);
    snapshots.push(currentSnapshot());
    ws.comparisonSnapshots = snapshots.slice(-24);
    saveState();
    renderProExperience();
  };

  function renderGuardian() {
    const target = document.getElementById('guardianContent');
    if (!target) return;
    const snapshots = storedSnapshots(active());
    const baseline = snapshots[snapshots.length - 1];
    const now = currentSnapshot();
    if (!baseline) {
      target.innerHTML = `<div class="guardian-empty"><span class="eyebrow">FIRST STEP</span><h3>Start a useful comparison</h3><p>Save a comparison snapshot now. After your next update to income or costs, the Guardian can flag which expense categories moved while revenue stayed steady.</p><button class="pro-button" onclick="saveComparisonSnapshot()">Save current comparison snapshot</button></div>`;
      return;
    }
    const revenueChange = baseline.revenue > 0 ? (now.revenue - baseline.revenue) / baseline.revenue * 100 : (now.revenue > 0 ? 100 : 0);
    const labels = new Set([...Object.keys(baseline.categories || {}), ...Object.keys(now.categories || {})]);
    const changes = [...labels].map(label => {
      const before = baseline.categories?.[label] || 0;
      const after = now.categories?.[label] || 0;
      return { label, before, after, change: before > 0 ? (after - before) / before * 100 : (after > 0 ? 100 : 0) };
    }).filter(row => row.after > 0 && row.change >= 10).sort((a, b) => b.change - a.change);
    const date = new Date(baseline.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const alert = changes.find(row => Math.abs(revenueChange) <= 5);
    const headline = alert
      ? `<div class="guardian-alert"><span class="guardian-alert__tag">REVIEW SUGGESTED</span><h3>${safeText(alert.label)} costs are up ${pct(alert.change)} while revenue is ${Math.abs(revenueChange) <= 1 ? 'flat' : `${revenueChange > 0 ? 'up' : 'down'} ${pct(Math.abs(revenueChange))}`}</h3><p>${fmt(convert(alert.after - alert.before, 'USD', appState.displayCurrency))} more than the saved comparison. Check updated vendor rates, staffing, quantity, and one-off purchases before deciding whether to renegotiate or adjust prices. This is a rules-based signal from your saved figures, not an AI diagnosis. It flags a correlation; it does not identify the cause.</p></div>`
      : `<div class="guardian-calm"><span class="eyebrow">NO LARGE COST SPIKE FOUND</span><h3>Nothing crossed the 10% review threshold.</h3><p>Revenue is ${revenueChange >= 0 ? 'up' : 'down'} ${pct(Math.abs(revenueChange))} versus the saved comparison. This is a rules-based check of your entered totals, not a transaction-feed or supplier-price scan.</p></div>`;
    const rows = changes.length ? changes.map(row => `<div class="guardian-row"><span>${safeText(row.label)}</span><strong>+${pct(row.change)}</strong><span>${fmt(convert(row.before, 'USD', appState.displayCurrency))} → ${fmt(convert(row.after, 'USD', appState.displayCurrency))}</span></div>`).join('') : '<p class="pro-note">No expense category increased by 10% or more.</p>';
    target.innerHTML = `${headline}<div class="guardian-summary"><div><span>Current revenue</span><strong>${fmt(convert(now.revenue, 'USD', appState.displayCurrency))}</strong></div><div><span>Current expenses</span><strong>${fmt(convert(now.expenses, 'USD', appState.displayCurrency))}</strong></div><div><span>Comparing against</span><strong>${safeText(date)}</strong></div></div><h4 class="pro-subhead">Expense movements</h4>${rows}<p class="pro-note">Comparison uses the live workspace against your latest manually saved snapshot. No supplier feed or external transaction source is connected.</p><button class="pro-button pro-button--quiet" onclick="saveComparisonSnapshot()">Save current totals as a new comparison</button>`;
  }

  function renderMargins() {
    const target = document.getElementById('marginContent');
    if (!target) return;
    const products = (active().revenues || []).filter(item => item.type !== 'one-off');
    if (!products.length) {
      target.innerHTML = '<p class="pro-note">Add an income stream and its optional direct unit cost to see contribution margin.</p>';
      return;
    }
    const rows = products.map(item => {
      const price = Number(item.unitCost) || 0;
      const hasCost = item.directCost !== undefined && item.directCost !== null && item.directCost !== '';
      const direct = hasCost ? Number(item.directCost) : null;
      const contribution = Number.isFinite(direct) ? price - direct : null;
      const margin = price > 0 && contribution !== null ? contribution / price * 100 : null;
      return { item, price, units: Number(item.qty) || 0, direct, contribution, margin, labor: Number(item.laborHoursPerUnit) || 0 };
    });
    const complete = rows.filter(row => row.margin !== null);
    const sortedMargin = complete.map(row => row.margin).sort((a, b) => a - b);
    const medianMargin = sortedMargin.length ? sortedMargin[Math.floor(sortedMargin.length / 2)] : null;
    const sortedUnits = rows.map(row => row.units).sort((a, b) => a - b);
    const medianUnits = sortedUnits.length ? sortedUnits[Math.floor(sortedUnits.length / 2)] : 0;
    const laborValues = rows.map(row => row.labor).sort((a, b) => a - b);
    const medianLabor = laborValues.length ? laborValues[Math.floor(laborValues.length / 2)] : 0;
    const body = rows.map(row => {
      let label = 'Add direct cost';
      if (row.margin !== null) {
        if (row.margin >= medianMargin && row.units >= medianUnits) label = 'Star';
        else if (row.margin < medianMargin && (row.units < medianUnits || row.labor > medianLabor)) label = 'Dog / review';
        else label = 'Opportunity';
      }
      const details = `<button class="inline-text-button" onclick="setProductCost('${safeText(row.item.id)}')">${row.margin === null ? 'Add direct cost per unit' : `${fmt(convert(row.direct, row.item.currency || 'USD', appState.displayCurrency))} / unit · edit`}</button>`;
      const hours = row.labor ? `${row.labor.toFixed(1)} h / unit` : '—';
      return `<tr><td><strong>${safeText(row.item.name)}</strong><small>${label}</small></td><td>${fmt(convert(row.price, row.item.currency || 'USD', appState.displayCurrency))}</td><td>${details}</td><td>${row.contribution === null ? '—' : fmt(convert(row.contribution, row.item.currency || 'USD', appState.displayCurrency))}</td><td>${row.margin === null ? '—' : pct(row.margin)}</td><td>${hours}</td><td>${row.units.toLocaleString()}</td></tr>`;
    }).join('');
    target.innerHTML = `<div class="table-scroll"><table class="margin-table"><thead><tr><th>Offer</th><th>Price / unit</th><th>Direct cost</th><th>Contribution</th><th>Margin</th><th>Labor</th><th>Units / mo.</th></tr></thead><tbody>${body}</tbody></table></div><p class="pro-note">Stars are items above the median on both contribution margin and monthly units. Dogs are below-median contributors with low volume or high labor time. These are relative to your entered offers; only direct costs you enter are included. Shared operating expenses are shown in break-even, not allocated to each offer.</p>`;
  }

  window.setProductCost = id => {
    const item = (active().revenues || []).find(row => row.id === id);
    if (!item) return;
    const cost = prompt(`Direct cost per unit for ${item.name} (in ${item.currency || 'USD'}):`, Number(item.directCost) || '');
    if (cost === null || (cost.trim() !== '' && (!Number.isFinite(Number(cost)) || Number(cost) < 0))) return;
    item.directCost = cost.trim() === '' ? null : Number(cost);
    const hours = prompt('Labor hours per unit (optional):', Number(item.laborHoursPerUnit) || '');
    if (hours !== null && hours.trim() !== '') {
      if (!Number.isFinite(Number(hours)) || Number(hours) < 0) return;
      item.laborHoursPerUnit = Number(hours);
    }
    saveState();
    renderProExperience();
    updateBreakEven();
  };

  function renderBenchmarks() {
    const target = document.getElementById('benchmarkContent');
    if (!target) return;
    const { revenue, directCosts } = currentTotals();
    const payroll = (active().expenses || []).filter(item => /payroll|labor|wage|staff/i.test(item.category || '')).reduce((sum, item) => sum + itemInDisplay(item), 0);
    const actualLabor = revenue > 0 ? payroll / revenue * 100 : null;
    const actualMargin = revenue > 0 ? (revenue - directCosts) / revenue * 100 : null;
    const profile = active().benchmarkProfile || {};
    const industryEl = document.getElementById('benchmarkIndustry');
    const sizeEl = document.getElementById('benchmarkSize');
    const laborEl = document.getElementById('benchmarkLabor');
    const marginEl = document.getElementById('benchmarkMargin');
    if (industryEl && profile.industry) industryEl.value = profile.industry;
    if (sizeEl && profile.size) sizeEl.value = profile.size;
    if (laborEl && profile.labor !== undefined && laborEl.value === '') laborEl.value = profile.labor;
    if (marginEl && profile.margin !== undefined && marginEl.value === '') marginEl.value = profile.margin;
    const laborRef = Number(laborEl?.value);
    const marginRef = Number(marginEl?.value);
    const comparison = (actual, reference, lowerIsBetter) => {
      if (actual === null || !Number.isFinite(reference) || reference <= 0) return '<span class="benchmark-pending">Add revenue and a peer reference to compare.</span>';
      const diff = actual - reference;
      return `<strong>${pct(actual)}</strong><span>${Math.abs(diff).toFixed(1)} pts ${diff === 0 ? 'at' : (diff > 0 ? (lowerIsBetter ? 'above' : 'above') : 'below')} your ${pct(reference)} reference ${diff === 0 ? '' : (diff > 0 && lowerIsBetter ? '— review' : '')}</span>`;
    };
    const peerContext = `${industryEl?.value || 'Selected business'} · team ${sizeEl?.value || 'size not selected'}`;
    target.innerHTML = `<p class="peer-context">Peer context: ${safeText(peerContext)}</p><div class="benchmark-grid"><div class="benchmark-card"><span>Labor / revenue</span><div>${comparison(actualLabor, laborRef, true)}</div></div><div class="benchmark-card"><span>Contribution margin</span><div>${comparison(actualMargin, marginRef, false)}</div></div></div><p class="pro-note">Comparisons run automatically against the editable peer ratios below. This prototype has no licensed industry dataset; enter ratios from a trusted source for your sector and business size. No peer averages are invented.</p>`;
  }

  window.saveBenchmarkProfile = function() {
    active().benchmarkProfile = { industry: document.getElementById('benchmarkIndustry')?.value || '', size: document.getElementById('benchmarkSize')?.value || '', labor: document.getElementById('benchmarkLabor')?.value || '', margin: document.getElementById('benchmarkMargin')?.value || '' };
    saveState();
    renderBenchmarks();
  };

  function renderHistorySummary() {
    const target = document.getElementById('freeHistoryContent');
    if (!target) return;
    const snapshots = storedSnapshots(active());
    if (!snapshots.length) { target.innerHTML = '<p class="pro-note">No snapshots saved yet. Save today’s numbers to establish a baseline. Free-plan users retain access to these saved totals.</p>'; return; }
    target.innerHTML = `<div class="history-list">${snapshots.slice(-6).reverse().map(row => `<div class="history-row"><span>${safeText(new Date(row.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span><span>Revenue <strong>${fmt(convert(row.revenue, row.currency || 'USD', appState.displayCurrency))}</strong></span><span>Costs <strong>${fmt(convert(row.expenses, row.currency || 'USD', appState.displayCurrency))}</strong></span></div>`).join('')}</div><p class="pro-note">${snapshots.length} saved comparison${snapshots.length === 1 ? '' : 's'} for this workspace, stored on this device.</p>`;
  };

  function renderTier() {
    const pro = appState.tier === 'pro';
    document.body.classList.toggle('plan-pro', pro);
    document.body.classList.toggle('plan-free', !pro);
    document.querySelectorAll('[data-pro-module]').forEach(module => module.classList.toggle('is-locked', !pro));
    document.querySelectorAll('[data-pro-status]').forEach(el => { el.textContent = pro ? 'PRO PREVIEW' : 'FREE PLAN'; });
    const status = document.getElementById('planStatus');
    if (status) status.textContent = pro ? 'Pro preview on this device' : 'Free plan';
    const planStatusPro = document.getElementById('planStatusPro');
    if (planStatusPro) planStatusPro.textContent = pro ? 'Pro preview · local only' : 'Free plan';
    const tierButton = document.getElementById('tierPreviewButton');
    if (tierButton) tierButton.textContent = pro ? 'Return to Free' : 'Enable Pro preview';
  }

  window.renderProExperience = function() {
    renderTier();
    renderHistorySummary();
    renderGuardian();
    renderMargins();
    renderBenchmarks();
    updateBreakEven();
  };

  window.updateBreakEven = function() {
    const target = document.getElementById('breakEvenContent');
    if (!target) return;
    const { revenue, expenses, directCosts } = currentTotals();
    const marginDollars = revenue - directCosts;
    const marginRatio = revenue > 0 ? marginDollars / revenue : 0;
    const requiredRevenue = marginRatio > 0 ? expenses / marginRatio : Infinity;
    const offers = (active().revenues || []).filter(item => item.type !== 'one-off');
    const units = offers.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const averagePrice = units > 0 ? revenue / units : 0;
    const requiredUnits = averagePrice > 0 && Number.isFinite(requiredRevenue) ? Math.ceil(requiredRevenue / averagePrice) : null;
    target.innerHTML = `<div class="breakeven-kpis"><div><span>Current monthly revenue</span><strong>${fmt(revenue)}</strong></div><div><span>Operating costs</span><strong>${fmt(expenses)}</strong></div><div><span>Contribution margin</span><strong>${revenue > 0 ? pct(marginRatio * 100) : '—'}</strong></div><div class="breakeven-primary"><span>Revenue to break even</span><strong>${Number.isFinite(requiredRevenue) ? fmt(requiredRevenue) : 'Add revenue'}</strong></div></div><p class="pro-note">${requiredUnits === null ? 'Add recurring income streams to estimate a unit target.' : `At your current offer mix and average price, that is approximately ${requiredUnits.toLocaleString()} units per month.`} Break-even combines entered direct costs per unit with the operating-cost list. Do not enter the same direct costs in both places.</p>`;
  };

  function seasonalityMultiplier(monthIndex, snapshots) {
    const months = new Set((snapshots || []).map(row => new Date(row.savedAt).getMonth()));
    if (months.size < 12) return 1;
    const grouped = Array.from({ length: 12 }, () => []);
    snapshots.forEach(row => grouped[new Date(row.savedAt).getMonth()].push(row.revenue));
    const values = grouped.map(group => group.length ? group.reduce((sum, value) => sum + value, 0) / group.length : 0);
    const overall = values.reduce((sum, value) => sum + value, 0) / 12;
    return overall > 0 && values[monthIndex] > 0 ? values[monthIndex] / overall : 1;
  }

  window.runProForecast = function() {
    const ws = active();
    const base = currentTotals();
    const hourly = Math.max(0, Number(document.getElementById('scenarioHourlyRate')?.value) || 0);
    const hours = Math.max(0, Number(document.getElementById('scenarioHoursWeek')?.value) || 0);
    const headcount = Math.max(0, Number(document.getElementById('scenarioHeadcount')?.value) || 0);
    const hireMonthly = hourly * hours * 52 / 12 * headcount;
    const locationCost = Math.max(0, Number(document.getElementById('scenarioLocationCost')?.value) || 0);
    const otherMonthlyCost = Math.max(0, Number(document.getElementById('scenarioOtherCost')?.value) || 0);
    const locationSetup = Math.max(0, Number(document.getElementById('scenarioLocationSetup')?.value) || 0);
    const locationMonth = Math.min(12, Math.max(1, Number(document.getElementById('scenarioLocationMonth')?.value) || 6));
    const locationRevenuePct = Math.max(0, Number(document.getElementById('scenarioLocationRevenue')?.value) || 0) / 100;
    const growth = (Number(ws.growthRate) || 0) / 100;
    const snapshots = storedSnapshots(ws);
    const useSeasonality = new Set(snapshots.map(row => new Date(row.savedAt).getMonth())).size === 12;
    let cash = base.cash;
    let revenue = base.revenue;
    let out = '';
    let firstShortfall = null;
    for (let month = 1; month <= 12; month++) {
      if (month > 1) revenue *= 1 + growth;
      const today = new Date();
      const date = new Date(today.getFullYear(), today.getMonth() + month - 1, 1);
      const locationOpen = month >= locationMonth;
      const seasonal = useSeasonality ? seasonalityMultiplier(date.getMonth(), snapshots) : 1;
      const monthRevenue = revenue * seasonal * (locationOpen ? 1 + locationRevenuePct : 1);
      const variableCosts = base.revenue > 0 ? base.directCosts * (monthRevenue / base.revenue) : 0;
      const monthCosts = base.expenses + variableCosts + hireMonthly + otherMonthlyCost + (locationOpen ? locationCost : 0);
      const opening = month === locationMonth ? locationSetup : 0;
      cash += monthRevenue - monthCosts - opening;
      if (cash < 0 && firstShortfall === null) firstShortfall = month;
      out += `<tr><td>Month ${month}${month === locationMonth ? ' · location opens' : ''}</td><td>${fmt(monthRevenue)}</td><td>${fmt(monthCosts + opening)}</td><td class="${cash < 0 ? 'value-negative' : ''}">${fmt(cash)}</td></tr>`;
    }
    const verdict = firstShortfall ? `Projected cash falls below zero in month ${firstShortfall}.` : `Projected closing cash after 12 months: ${fmt(cash)}.`;
    document.getElementById('forecastResult').innerHTML = `<div class="forecast-verdict"><span class="eyebrow">12-MONTH OUTLOOK</span><strong>${verdict}</strong><p>Added wages: ${fmt(hireMonthly)} / month · other added monthly costs: ${fmt(otherMonthlyCost)} · location costs begin in month ${locationMonth}.</p></div><div class="table-scroll"><table class="margin-table forecast-table"><thead><tr><th>Period</th><th>Revenue</th><th>Costs + setup</th><th>Closing cash</th></tr></thead><tbody>${out}</tbody></table></div><p class="pro-note">${useSeasonality ? 'Revenue seasonality uses your saved monthly snapshots and the current growth assumption.' : 'No complete 12-month snapshot history is saved yet. Seasonality is off; this estimate uses your current revenue and monthly growth assumption.'} Direct costs scale with revenue at the current offer mix. Hourly wages use hours × 52/12 and exclude employer taxes, benefits, and overtime; add them under other monthly costs. This is a planning estimate, not a guarantee.</p>`;
  };

  window.runCustomScenario = function() {
    const base = currentTotals();
    const addedRevenue = convert(Number(document.getElementById('customAddRev')?.value) || 0, document.getElementById('customAddRevCurr')?.value || appState.displayCurrency, appState.displayCurrency);
    const addedCost = convert(Number(document.getElementById('customAddExp')?.value) || 0, document.getElementById('customAddExpCurr')?.value || appState.displayCurrency, appState.displayCurrency);
    const oneTime = convert(Number(document.getElementById('customOneOff')?.value) || 0, document.getElementById('customOneOffCurr')?.value || appState.displayCurrency, appState.displayCurrency);
    const revenue = base.revenue + addedRevenue;
    const expenses = base.expenses + addedCost;
    const variableCosts = base.revenue > 0 ? base.directCosts * (revenue / base.revenue) : 0;
    const net = revenue - expenses - variableCosts;
    const cashAfterSetup = base.cash - oneTime;
    const runway = cashAfterSetup <= 0 ? `Immediate cash shortfall of ${fmt(Math.abs(cashAfterSetup))} after the one-time cost` : (net >= 0 ? 'Cash-positive' : `${(cashAfterSetup / Math.abs(net)).toFixed(1)} months at this pace`);
    const contributionRatio = base.revenue > 0 ? (base.revenue - base.directCosts) / base.revenue : 0;
    const requiredRevenue = contributionRatio > 0 ? (base.expenses + addedCost) / contributionRatio : (base.expenses + addedCost);
    const result = document.getElementById('customScenarioResult');
    if (result) {
      result.classList.remove('hidden');
      document.getElementById('customRunwayResult').textContent = runway;
      const advice = document.getElementById('marginAdviceText');
      const adviceBox = document.getElementById('marginAdviceBox');
      if (advice && adviceBox) {
        advice.innerHTML = `At this cost level, estimated monthly break-even sales are <strong>${fmt(requiredRevenue)}</strong>. Your scenario changes monthly net income to <strong>${fmt(net)}</strong>.`;
        adviceBox.classList.remove('hidden');
      }
    }
  };

  window.renderScenarios = function(cash, revenue, expenses, directCosts = 0) {
    const net = expenses + directCosts - revenue;
    const labels = [['scenBaseRunway', net <= 0 ? 'Cash-positive' : `${(cash / net).toFixed(1)} mos`], ['scenHireRunway', 'Run the 12-month forecast'], ['scenPriceRunway', revenue > 0 ? fmt(expenses + directCosts) : 'Add income']];
    labels.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value; });
  };

  const originalOnload = window.onload;
  window.onload = async function(event) {
    if (typeof originalOnload === 'function') await originalOnload.call(this, event);
    renderProExperience();
  };
  const originalRecalculate = window.recalculateAll;
  window.recalculateAll = function(...args) {
    const result = originalRecalculate.apply(this, args);
    renderProExperience();
    return result;
  };
})();
