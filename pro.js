(() => {
  const currency = () => getSymbol(appState.displayCurrency);
  const active = () => getActiveWorkspace();
  const amount = items => (items || []).reduce((sum, item) => sum + itemInDisplay(item), 0);
  const currentTotals = () => {
    const ws = active();
    const revenue = amount((ws.revenues || []).filter(item => item.type !== 'one-off'));
    const expenses = amount((ws.expenses || []).filter(item => item.type !== 'one-off'));
    const directCosts = (ws.revenues || []).filter(item => item.type !== 'one-off').reduce((sum, item) => sum + convert((Number(item.directCost) || 0) * (Number(item.qty) || 0) * (item.frequency === 'weekly' ? 52 / 12 : 1), item.currency || 'USD', appState.displayCurrency), 0);
    return { revenue, expenses, directCosts, cash: convert(ws.cash || 0, ws.cashCurrency || 'USD', appState.displayCurrency) };
  };
  const fmt = value => `${currency()}${Math.round(value).toLocaleString()}`;
  const pct = value => `${value.toFixed(1)}%`;
  const safeText = value => escapeHtml(String(value ?? ''));
  const listFor = key => Array.isArray(active()[key]) ? active()[key] : (active()[key] = []);
  const storedSnapshots = ws => Array.isArray(ws.comparisonSnapshots) ? ws.comparisonSnapshots : (ws.comparisonSnapshots = []);
  const currencies = ['USD','EUR','GBP','HKD','SGD','CNY','JPY','AUD'];
  const uid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const localDateString = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

  const currentSnapshot = () => {
    const ws = active();
    const { revenue, expenses, directCosts } = currentTotals();
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
      ? `<div class="guardian-alert"><span class="guardian-alert__tag">REVIEW SUGGESTED</span><h3>${safeText(alert.label)} costs are up ${pct(alert.change)} while revenue is ${Math.abs(revenueChange) <= 1 ? 'flat' : `${revenueChange > 0 ? 'up' : 'down'} ${pct(Math.abs(revenueChange))}`}</h3><p>${fmt(convert(alert.after - alert.before, 'USD', appState.displayCurrency))} more than the saved comparison. Check updated rates, staffing, quantities, and one-off purchases. This is a rules-based signal from entered figures, not an AI diagnosis.</p></div>`
      : `<div class="guardian-calm"><span class="eyebrow">NO LARGE COST SPIKE FOUND</span><h3>Nothing crossed the 10% review threshold.</h3><p>Revenue is ${revenueChange >= 0 ? 'up' : 'down'} ${pct(Math.abs(revenueChange))} versus the saved comparison. No supplier or transaction feed is connected.</p></div>`;
    const rows = changes.length ? changes.map(row => `<div class="guardian-row"><span>${safeText(row.label)}</span><strong>+${pct(row.change)}</strong><span>${fmt(convert(row.before, 'USD', appState.displayCurrency))} → ${fmt(convert(row.after, 'USD', appState.displayCurrency))}</span></div>`).join('') : '<p class="pro-note">No expense category increased by 10% or more.</p>';
    target.innerHTML = `${headline}<div class="guardian-summary"><div><span>Current revenue</span><strong>${fmt(convert(now.revenue, 'USD', appState.displayCurrency))}</strong></div><div><span>Current expenses</span><strong>${fmt(convert(now.expenses, 'USD', appState.displayCurrency))}</strong></div><div><span>Comparing against</span><strong>${safeText(date)}</strong></div></div><h4 class="pro-subhead">Expense movements</h4>${rows}<p class="pro-note">Comparison uses your live workspace and latest manually saved snapshot. No external transaction source is connected.</p><button class="pro-button pro-button--quiet" onclick="saveComparisonSnapshot()">Save current totals as a new comparison</button>`;
  }

  function renderMargins() {
    const target = document.getElementById('marginContent');
    if (!target) return;
    const products = (active().revenues || []).filter(item => item.type !== 'one-off');
    if (!products.length) { target.innerHTML = '<p class="pro-note">Add an income stream and its optional direct unit cost to see contribution margin.</p>'; return; }
    const rows = products.map(item => {
      const price = Number(item.unitCost) || 0;
      const hasCost = item.directCost !== undefined && item.directCost !== null && item.directCost !== '';
      const direct = hasCost ? Number(item.directCost) : null;
      const contribution = Number.isFinite(direct) ? price - direct : null;
      const margin = price > 0 && contribution !== null ? contribution / price * 100 : null;
      const units = (Number(item.qty) || 0) * (item.frequency === 'weekly' ? 52 / 12 : 1);
      return { item, price, units, direct, contribution, margin, labor: Number(item.laborHoursPerUnit) || 0 };
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
      return `<tr><td><strong>${safeText(row.item.name)}</strong><small>${label}</small></td><td>${fmt(convert(row.price, row.item.currency || 'USD', appState.displayCurrency))}</td><td>${details}</td><td>${row.contribution === null ? '—' : fmt(convert(row.contribution, row.item.currency || 'USD', appState.displayCurrency))}</td><td>${row.margin === null ? '—' : pct(row.margin)}</td><td>${hours}</td><td>${row.units.toLocaleString(undefined,{maximumFractionDigits:1})}</td></tr>`;
    }).join('');
    target.innerHTML = `<div class="table-scroll"><table class="margin-table"><thead><tr><th>Offer</th><th>Price / unit</th><th>Direct cost</th><th>Contribution</th><th>Margin</th><th>Labor</th><th>Units / mo.</th></tr></thead><tbody>${body}</tbody></table></div><p class="pro-note">Stars and review items are relative to your entered offers. Only direct costs you enter are included; shared operating expenses remain in break-even.</p>`;
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
    recalculateAll();
  };

  function renderHistorySummary() {
    const target = document.getElementById('freeHistoryContent');
    if (!target) return;
    const snapshots = storedSnapshots(active());
    if (!snapshots.length) { target.innerHTML = '<p class="pro-note">No snapshots saved yet. Save today’s numbers to establish a baseline. Free-plan users retain access to these saved totals.</p>'; return; }
    target.innerHTML = `<div class="history-list">${snapshots.slice(-6).reverse().map(row => `<div class="history-row"><span>${safeText(new Date(row.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span><span>Revenue <strong>${fmt(convert(row.revenue, row.currency || 'USD', appState.displayCurrency))}</strong></span><span>Costs <strong>${fmt(convert(row.expenses, row.currency || 'USD', appState.displayCurrency))}</strong></span></div>`).join('')}</div><p class="pro-note">${snapshots.length} saved comparison${snapshots.length === 1 ? '' : 's'} for this workspace, stored on this device.</p>`;
  }

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

  function getScenarioItems() { return listFor('whatIfItems'); }
  function currencyOptions(selected) { return currencies.map(code => `<option value="${code}" ${code === selected ? 'selected' : ''}>${code}</option>`).join(''); }
  window.addScenarioAssumption = kind => {
    getScenarioItems().push({ id: uid('whatif'), kind: kind === 'cost' ? 'cost' : 'revenue', name: kind === 'cost' ? 'New cost' : 'New income', category: kind === 'cost' ? 'Other cost' : 'Other income', amount: 0, quantity: 1, frequency: 'monthly', currency: appState.displayCurrency, directCost: null });
    saveState(); renderScenarioAssumptions();
  };
  window.updateScenarioAssumption = (id, field, value) => {
    const item = getScenarioItems().find(row => row.id === id);
    if (!item || !['name','category','kind','amount','quantity','frequency','currency','directCost'].includes(field)) return;
    if (['amount','quantity','directCost'].includes(field)) {
      if (value === '' && field === 'directCost') item.directCost = null;
      else if (Number.isFinite(Number(value))) item[field] = Number(value);
    } else if (field === 'kind') item.kind = value === 'cost' ? 'cost' : 'revenue';
    else item[field] = value;
    saveState();
  };
  window.removeScenarioAssumption = id => {
    const ws = active(); ws.whatIfItems = getScenarioItems().filter(row => row.id !== id);
    saveState(); renderScenarioAssumptions();
  };
  function renderScenarioAssumptions() {
    const target = document.getElementById('scenarioAssumptionsList');
    if (!target) return;
    const rows = getScenarioItems();
    if (!rows.length) { target.innerHTML = '<p class="scenario-empty">Add an income or cost line to try a change. For example: $200 twice a week, or a one-time setup purchase.</p>'; return; }
    target.innerHTML = rows.map(row => `<article class="scenario-assumption-row"><div class="scenario-assumption-row__top"><span class="eyebrow">${row.kind === 'cost' ? 'COST ASSUMPTION' : 'INCOME ASSUMPTION'}</span><button type="button" class="inline-text-button" onclick="removeScenarioAssumption('${safeText(row.id)}')">Remove</button></div><div class="scenario-assumption-fields"><label>Name<input value="${safeText(row.name)}" oninput="updateScenarioAssumption('${safeText(row.id)}','name',this.value)"></label><label>Category<input value="${safeText(row.category)}" oninput="updateScenarioAssumption('${safeText(row.id)}','category',this.value)"></label><label>Amount each<input type="number" min="0" step="0.01" value="${Number(row.amount)||0}" oninput="updateScenarioAssumption('${safeText(row.id)}','amount',this.value)"></label><label>Times in period<input type="number" min="0" step="0.1" value="${Number(row.quantity)||0}" oninput="updateScenarioAssumption('${safeText(row.id)}','quantity',this.value)"></label><label>Timing<select onchange="updateScenarioAssumption('${safeText(row.id)}','frequency',this.value)"><option value="monthly" ${row.frequency==='monthly'?'selected':''}>Each month</option><option value="weekly" ${row.frequency==='weekly'?'selected':''}>Each week</option><option value="once" ${row.frequency==='once'?'selected':''}>One time</option></select></label><label>Currency<select onchange="updateScenarioAssumption('${safeText(row.id)}','currency',this.value)">${currencyOptions(row.currency || appState.displayCurrency)}</select></label>${row.kind==='revenue' ? `<label>Direct cost each (optional)<input type="number" min="0" step="0.01" value="${row.directCost ?? ''}" placeholder="0.00" oninput="updateScenarioAssumption('${safeText(row.id)}','directCost',this.value)"></label>` : ''}</div></article>`).join('');
  }
  function assumptionTotals() {
    const totals = { revenue:0, cost:0, directCost:0, oneOffRevenue:0, oneOffCost:0, oneOffDirectCost:0 };
    getScenarioItems().forEach(item => {
      const factor = item.frequency === 'weekly' ? 52 / 12 : 1;
      const raw = (Number(item.amount) || 0) * (Number(item.quantity) || 0);
      const value = convert(raw * (item.frequency === 'once' ? 1 : factor), item.currency || appState.displayCurrency, appState.displayCurrency);
      const direct = item.kind === 'revenue' ? convert((Number(item.directCost) || 0) * (Number(item.quantity) || 0) * (item.frequency === 'once' ? 1 : factor), item.currency || appState.displayCurrency, appState.displayCurrency) : 0;
      const isOnce = item.frequency === 'once';
      if (item.kind === 'cost') totals[isOnce ? 'oneOffCost' : 'cost'] += value;
      else {
        totals[isOnce ? 'oneOffRevenue' : 'revenue'] += value;
        totals[isOnce ? 'oneOffDirectCost' : 'directCost'] += direct;
      }
    });
    return totals;
  }

  function renderInventory() {
    const target = document.getElementById('inventoryContent');
    if (!target) return;
    const items = listFor('inventoryItems');
    const wasteLog = listFor('inventoryWaste');
    const today = new Date();
    today.setHours(0,0,0,0);
    const dateValue = localDateString();
    const offers = (active().revenues || []).filter(offer => offer.type !== 'one-off');
    const offerOptions = '<option value="">Not linked to an income item</option>' + offers.map(offer => `<option value="${safeText(offer.id)}">${safeText(offer.name)}</option>`).join('');
    const statusFor = item => {
      const expiry = item.expiryDate ? Math.ceil((new Date(`${item.expiryDate}T00:00:00`).getTime() - today.getTime()) / 86400000) : null;
      const linked = offers.find(offer => offer.id === item.linkedRevenueId);
      const monthlyUse = linked ? (Number(linked.qty) || 0) * (linked.frequency === 'weekly' ? 52 / 12 : 1) * (Number(item.usagePerSale) || 0) : 0;
      const tags = [];
      if (Number(item.quantity) <= 0) tags.push({label:'Out of stock',className:'ops-status--danger'});
      else if (Number(item.quantity) <= Number(item.threshold)) tags.push({label:'Low stock',className:'ops-status--warn'});
      else if (monthlyUse > 0 && Number(item.quantity) < monthlyUse) tags.push({label:'May run out at current sales',className:'ops-status--danger'});
      else if (monthlyUse > 0 && Number(item.quantity) - monthlyUse <= Number(item.threshold)) tags.push({label:'Low after expected sales',className:'ops-status--warn'});
      if (expiry !== null && expiry < 0) tags.push({label:'Expired',className:'ops-status--danger'});
      else if (expiry !== null && expiry <= 14) tags.push({label:expiry === 0 ? 'Expires today' : `Expires in ${expiry} days`,className:'ops-status--warn'});
      if (!tags.length) tags.push({label:'In range',className:'ops-status--ok'});
      return {tags,monthlyUse};
    };
    const rows = items.length ? `<div class="ops-list">${items.map(item => {
      const status = statusFor(item);
      const linked = offers.find(offer => offer.id === item.linkedRevenueId);
      const records = wasteLog.filter(entry => entry.itemId === item.id).sort((a,b) => b.date.localeCompare(a.date));
      const totalWaste = records.reduce((sum,entry) => sum + (Number(entry.quantity) || 0),0);
      const usage = status.monthlyUse ? ` · estimated use ${status.monthlyUse.toLocaleString(undefined,{maximumFractionDigits:1})} ${safeText(item.unit)} / month${linked ? ` from ${safeText(linked.name)} sales` : ''}` : '';
      const wasteHistory = records.length ? `<details class="ops-waste-history"><summary>${records.length} waste record${records.length === 1 ? '' : 's'} · ${totalWaste.toLocaleString(undefined,{maximumFractionDigits:2})} ${safeText(item.unit)} logged</summary><ul>${records.map(entry => `<li>${safeText(entry.date)} · ${safeText(entry.quantity)} ${safeText(item.unit)} · ${safeText(entry.reason)}</li>`).join('')}</ul></details>` : '';
      return `<article class="ops-row ops-row--inventory"><div class="ops-row__main"><strong>${safeText(item.name)}</strong><small>${safeText(item.quantity)} ${safeText(item.unit)} on hand · reorder at ${safeText(item.threshold)}${usage}${item.expiryDate ? ` · best before ${safeText(item.expiryDate)}` : ''}</small>${wasteHistory}<details class="ops-waste-form"><summary>Log discarded / spoiled stock</summary><form onsubmit="addInventoryWaste(event,'${safeText(item.id)}')"><label>Quantity lost<input id="waste-qty-${safeText(item.id)}" type="number" min="0.01" max="${Number(item.quantity) || 0}" step="0.01" required></label><label>Reason<input id="waste-reason-${safeText(item.id)}" required placeholder="Spoiled, damaged, expired…"></label><label>Date<input id="waste-date-${safeText(item.id)}" type="date" value="${dateValue}" required></label><button class="pro-button">Record waste</button></form></details></div><span class="ops-status-list">${status.tags.map(tag => `<span class="ops-status ${tag.className}">${tag.label}</span>`).join(' ')}</span><button class="inline-text-button" onclick="removeInventoryItem('${safeText(item.id)}')">Remove</button></article>`;
    }).join('')}</div>` : '<p class="scenario-empty">No inventory recorded yet.</p>';
    target.innerHTML = `<form class="ops-entry-form" onsubmit="addInventoryItem(event)"><label>Item<input id="invName" required placeholder="Stock or supply"></label><label>On hand<input id="invQuantity" type="number" min="0" step="0.1" required value="0"></label><label>Unit<input id="invUnit" required value="units"></label><label>Alert below<input id="invThreshold" type="number" min="0" step="0.1" required value="1"></label><label>Expiry (optional)<input id="invExpiry" type="date"></label><label>Track against income item<select id="invSalesItem">${offerOptions}</select></label><label>Units used per sale<input id="invUsagePerSale" type="number" min="0" step="0.01" value="0"></label><button class="pro-button">Add stock</button></form>${rows}<p class="pro-note">Stock and discarded quantity are entered manually. Optional usage is estimated from the linked income item’s monthly quantity; no inventory/POS system is connected. Expiry and low-stock alerts appear while the app is open.</p>`;
  }
  window.addInventoryItem = event => {
    event.preventDefault(); listFor('inventoryItems').push({id:uid('stock'),name:document.getElementById('invName').value.trim(),quantity:Number(document.getElementById('invQuantity').value)||0,unit:document.getElementById('invUnit').value.trim()||'units',threshold:Number(document.getElementById('invThreshold').value)||0,expiryDate:document.getElementById('invExpiry').value||'',linkedRevenueId:document.getElementById('invSalesItem').value||'',usagePerSale:Number(document.getElementById('invUsagePerSale').value)||0});
    saveState(); renderInventory();
  };
  window.addInventoryWaste = (event,id) => {
    event.preventDefault();
    const item = listFor('inventoryItems').find(row => row.id === id);
    if (!item) return;
    const quantity = Number(document.getElementById(`waste-qty-${id}`).value);
    const reason = document.getElementById(`waste-reason-${id}`).value.trim();
    const date = document.getElementById(`waste-date-${id}`).value;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(item.quantity) || !reason || !date) {
      alert('Enter a waste quantity greater than zero and no more than the amount on hand, plus a reason and date.');
      return;
    }
    listFor('inventoryWaste').push({id:uid('waste'),itemId:id,quantity,reason,date});
    item.quantity = Math.max(0, Number(item.quantity) - quantity);
    saveState();
    renderInventory();
  };
  window.removeInventoryItem = id => {
    active().inventoryItems=listFor('inventoryItems').filter(row=>row.id!==id);
    active().inventoryWaste=listFor('inventoryWaste').filter(row=>row.itemId!==id);
    saveState(); renderInventory();
  };

  function renderSuppliers() {
    const target=document.getElementById('supplierContent'); if(!target)return;
    const entries=listFor('supplierInvoices');
    const grouped=new Map(); entries.forEach(row=>{const key=`${row.supplier.toLowerCase()}|${row.item.toLowerCase()}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);});
    const previous=new Map(); grouped.forEach(rows=>{rows.sort((a,b)=>a.date.localeCompare(b.date));rows.forEach((row,index)=>previous.set(row.id,index?rows[index-1]:null));});
    const sorted=[...entries].sort((a,b)=>b.date.localeCompare(a.date));
    const rows=sorted.length?`<div class="ops-list ops-list--scroll">${sorted.map(row=>{const prev=previous.get(row.id);let change='First price recorded';if(prev){const old=convert(Number(prev.price)||0,prev.currency,appState.displayCurrency);const now=convert(Number(row.price)||0,row.currency,appState.displayCurrency);const delta=old>0?(now-old)/old*100:0;change=`${delta>0?'+':''}${delta.toFixed(1)}% vs previous invoice`;}return `<article class="ops-row ops-row--stack"><div><strong>${safeText(row.item)}</strong><small>${safeText(row.supplier)} · ${safeText(row.date)} · ${safeText(row.reference||'No invoice ref')} · ${safeText(row.quantity)} ${safeText(row.unit)}</small></div><div><strong>${safeText(row.currency)} ${Number(row.price).toLocaleString()}</strong><small>${change}</small></div><button class="inline-text-button" onclick="removeSupplierInvoice('${safeText(row.id)}')">Remove</button></article>`;}).join('')}</div>`:'<p class="scenario-empty">Add invoice lines to start a manual supplier price history.</p>';
    target.innerHTML=`<form class="ops-entry-form" onsubmit="addSupplierInvoice(event)"><label>Supplier<input id="supplierName" required placeholder="Vendor name"></label><label>Invoice date<input id="supplierDate" type="date" required></label><label>Reference<input id="supplierRef" placeholder="Optional"></label><label>Item / service<input id="supplierItem" required placeholder="What was purchased?"></label><label>Quantity<input id="supplierQuantity" type="number" min="0" step="0.01" required value="1"></label><label>Unit<input id="supplierUnit" value="units"></label><label>Price per unit<input id="supplierPrice" type="number" min="0" step="0.01" required></label><label>Currency<select id="supplierCurrency">${currencyOptions(appState.displayCurrency)}</select></label><button class="pro-button">Log invoice line</button></form>${rows}<p class="pro-note">Invoices are entered manually. No OCR or supplier integration is connected. Price-change comparisons convert recorded prices to the current display currency.</p>`;
    const date=document.getElementById('supplierDate'); if(date&&!date.value)date.value=localDateString();
  }
  window.addSupplierInvoice = event => { event.preventDefault(); const get=id=>document.getElementById(id).value; listFor('supplierInvoices').push({id:uid('invoice'),supplier:get('supplierName').trim(),date:get('supplierDate'),reference:get('supplierRef').trim(),item:get('supplierItem').trim(),quantity:Number(get('supplierQuantity'))||0,unit:get('supplierUnit').trim()||'units',price:Number(get('supplierPrice'))||0,currency:get('supplierCurrency')});saveState();renderSuppliers(); };
  window.removeSupplierInvoice = id => { active().supplierInvoices=listFor('supplierInvoices').filter(row=>row.id!==id);saveState();renderSuppliers(); };

  const reviewThemes=[['Wait times',['wait','slow','line','queue','late']],['Service & support',['service','staff','helpful','friendly','rude','support']],['Quality',['quality','great','excellent','damaged','poor','broken']],['Price & value',['price','value','expensive','affordable','cost']],['Communication',['communication','response','reply','clear','confusing']],['Availability',['available','availability','stock','sold out','out of stock','schedule']]];
  function renderReviews() {
    const target=document.getElementById('reviewContent');if(!target)return;
    const rows=listFor('customerReviews');
    const themes=reviewThemes.map(([label,words])=>({label,count:rows.filter(r=>words.some(word=>r.text.toLowerCase().includes(word))).length})).filter(x=>x.count).sort((a,b)=>b.count-a.count);
    const summary=themes.length?`<div class="review-themes">${themes.map(theme=>`<span class="review-theme"><strong>${theme.count}</strong> ${safeText(theme.label)}</span>`).join('')}</div>`:'<p class="scenario-empty">Add review text to see which simple keyword themes recur.</p>';
    const reviews=rows.length?`<div class="ops-list ops-list--scroll">${[...rows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8).map(r=>`<article class="ops-row ops-row--stack"><div><strong>${safeText(r.source)} · ${'★'.repeat(Number(r.rating)||0)}${'☆'.repeat(5-(Number(r.rating)||0))}</strong><small>${safeText(r.date)} · ${safeText(r.text)}</small></div><button class="inline-text-button" onclick="removeCustomerReview('${safeText(r.id)}')">Remove</button></article>`).join('')}</div>`:'';
    target.innerHTML=`<form class="ops-entry-form" onsubmit="addCustomerReview(event)"><label>Source (manual)<select id="reviewSource"><option>Google</option><option>Tripadvisor</option><option>Local app</option><option>Other</option></select></label><label>Date<input id="reviewDate" type="date" required></label><label>Rating<select id="reviewRating"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></label><label class="ops-entry-form__wide">Review text<textarea id="reviewText" required rows="2" placeholder="Paste a review you have permission to store"></textarea></label><button class="pro-button">Add review</button></form><div class="review-summary"><span class="eyebrow">REPEATED KEYWORD THEMES · ${rows.length} MANUAL REVIEW${rows.length===1?'':'S'}</span>${summary}</div>${reviews}<p class="pro-note">Source names are labels only; reviews are not fetched from Google, Tripadvisor, or other apps. Theme grouping is a local keyword check, not AI summarization.</p>`;
    const date=document.getElementById('reviewDate');if(date&&!date.value)date.value=localDateString();
  }
  window.addCustomerReview = event => {event.preventDefault();const get=id=>document.getElementById(id).value;listFor('customerReviews').push({id:uid('review'),source:get('reviewSource'),date:get('reviewDate'),rating:Number(get('reviewRating'))||5,text:get('reviewText').trim()});saveState();renderReviews();};
  window.removeCustomerReview = id => {active().customerReviews=listFor('customerReviews').filter(row=>row.id!==id);saveState();renderReviews();};

  function renderCompliance() {
    const target=document.getElementById('complianceContent');if(!target)return;
    const tasks=listFor('complianceTasks');
    const today=new Date();today.setHours(0,0,0,0);
    const rows=[...tasks].sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const list=rows.length?`<div class="ops-list">${rows.map(row=>{const days=Math.ceil((new Date(`${row.dueDate}T00:00:00`).getTime()-today.getTime())/86400000);let label=row.complete?'Complete':days<0?`Overdue ${Math.abs(days)} days`:days<=Number(row.leadDays||30)?`Due in ${days} days`:`Due ${row.dueDate}`;const css=row.complete?'ops-status--ok':days<0?'ops-status--danger':days<=Number(row.leadDays||30)?'ops-status--warn':'ops-status--ok';return `<article class="ops-row ops-row--stack"><div><strong>${safeText(row.name)}</strong><small>Due ${safeText(row.dueDate)}${row.notes?` · ${safeText(row.notes)}`:''}</small></div><span class="ops-status ${css}">${label}</span><button class="inline-text-button" onclick="toggleComplianceTask('${safeText(row.id)}')">${row.complete?'Reopen':'Complete'}</button><button class="inline-text-button" onclick="removeComplianceTask('${safeText(row.id)}')">Remove</button></article>`;}).join('')}</div>`:'<p class="scenario-empty">No renewal or inspection dates recorded.</p>';
    target.innerHTML=`<form class="ops-entry-form" onsubmit="addComplianceTask(event)"><label>Requirement<input id="complianceName" required placeholder="Permit, insurance, inspection…"></label><label>Due date<input id="complianceDate" type="date" required></label><label>Reminder lead<input id="complianceLead" type="number" min="0" step="1" value="30"></label><label>Notes<input id="complianceNotes" placeholder="Optional reference"></label><button class="pro-button">Add due date</button></form>${list}<p class="pro-note">Local in-app due-date indicators only. No background, email, or calendar reminders are sent; check this tracker while the app is open.</p>`;
  }
  window.addComplianceTask = event => {event.preventDefault();const get=id=>document.getElementById(id).value;listFor('complianceTasks').push({id:uid('due'),name:get('complianceName').trim(),dueDate:get('complianceDate'),leadDays:Number(get('complianceLead'))||0,notes:get('complianceNotes').trim(),complete:false});saveState();renderCompliance();};
  window.toggleComplianceTask = id => {const row=listFor('complianceTasks').find(x=>x.id===id);if(row){row.complete=!row.complete;saveState();renderCompliance();}};
  window.removeComplianceTask = id => {active().complianceTasks=listFor('complianceTasks').filter(row=>row.id!==id);saveState();renderCompliance();};

  let quoteRefreshTimer = null;
  const dailyQuotes=[
    'Small, steady decisions compound into room to grow.',
    'You do not need a perfect plan. You need one number you can trust today.',
    'A clear next step is more useful than a perfect forecast.',
    'Healthy businesses are built one thoughtful choice at a time.',
    'Progress is a habit of returning to what matters.',
    'Know the numbers. Then make room for the work only you can do.',
    'A careful question can save an expensive guess.',
    'Growth is strongest when the foundations grow with it.',
    'Today’s small improvement can make tomorrow easier.',
    'Good decisions begin with an honest look at the facts.',
    'Steady progress beats waiting for the perfect moment.',
    'Every useful system starts with one simple step.'
  ];
  function renderDailyQuote(){
    const text=document.getElementById('dailyQuoteText');if(!text)return;
    const now=new Date();const localDay=Math.floor(new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()/86400000);
    text.textContent=dailyQuotes[((localDay%dailyQuotes.length)+dailyQuotes.length)%dailyQuotes.length];
    const date=document.getElementById('dailyQuoteDate');if(date)date.textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  }

  window.updateBreakEven = function() {
    const target=document.getElementById('breakEvenContent');if(!target)return;
    const {revenue,expenses,directCosts}=currentTotals();
    const marginRatio=revenue>0?(revenue-directCosts)/revenue:0;
    const requiredRevenue=marginRatio>0?expenses/marginRatio:Infinity;
    const offers=(active().revenues||[]).filter(item=>item.type!=='one-off');
    const units=offers.reduce((sum,item)=>sum+(Number(item.qty)||0)*(item.frequency==='weekly'?52/12:1),0);
    const averagePrice=units>0?revenue/units:0;
    const requiredUnits=averagePrice>0&&Number.isFinite(requiredRevenue)?Math.ceil(requiredRevenue/averagePrice):null;
    target.innerHTML=`<div class="breakeven-kpis"><div><span>Current monthly revenue</span><strong>${fmt(revenue)}</strong></div><div><span>Operating costs</span><strong>${fmt(expenses)}</strong></div><div><span>Contribution margin</span><strong>${revenue>0?pct(marginRatio*100):'—'}</strong></div><div class="breakeven-primary"><span>Revenue to break even</span><strong>${Number.isFinite(requiredRevenue)?fmt(requiredRevenue):'Add revenue'}</strong></div></div><p class="pro-note">${requiredUnits===null?'Add recurring income streams to estimate a unit target.':`At your current offer mix and average price, that is approximately ${requiredUnits.toLocaleString()} units per month.`} Break-even combines entered direct costs per unit with the operating-cost list. Do not enter the same direct cost twice.</p>`;
  };

  function seasonalityMultiplier(monthIndex,snapshots){
    if(new Set((snapshots||[]).map(row=>new Date(row.savedAt).getMonth())).size<12)return 1;
    const grouped=Array.from({length:12},()=>[]);snapshots.forEach(row=>grouped[new Date(row.savedAt).getMonth()].push(row.revenue));
    const values=grouped.map(group=>group.length?group.reduce((sum,value)=>sum+value,0)/group.length:0);const overall=values.reduce((sum,value)=>sum+value,0)/12;
    return overall>0&&values[monthIndex]>0?values[monthIndex]/overall:1;
  }
  window.runProForecast = function(){
    const ws=active(),base=currentTotals(),extra=assumptionTotals();
    const hourly=Math.max(0,Number(document.getElementById('scenarioHourlyRate')?.value)||0),hours=Math.max(0,Number(document.getElementById('scenarioHoursWeek')?.value)||0),headcount=Math.max(0,Number(document.getElementById('scenarioHeadcount')?.value)||0);
    const hireMonthly=hourly*hours*52/12*headcount;
    const locationCost=Math.max(0,Number(document.getElementById('scenarioLocationCost')?.value)||0),otherCost=Math.max(0,Number(document.getElementById('scenarioOtherCost')?.value)||0),locationSetup=Math.max(0,Number(document.getElementById('scenarioLocationSetup')?.value)||0);
    const locationMonth=Math.min(12,Math.max(1,Number(document.getElementById('scenarioLocationMonth')?.value)||6)),locationRevenuePct=Math.max(0,Number(document.getElementById('scenarioLocationRevenue')?.value)||0)/100;
    const growth=(Number(ws.growthRate)||0)/100,snapshots=storedSnapshots(ws),useSeasonality=new Set(snapshots.map(row=>new Date(row.savedAt).getMonth())).size===12;
    let cash=base.cash,revenue=base.revenue,out='',firstShortfall=null;
    for(let month=1;month<=12;month++){
      if(month>1)revenue*=1+growth;
      const today=new Date(),date=new Date(today.getFullYear(),today.getMonth()+month-1,1),locationOpen=month>=locationMonth;
      const seasonal=useSeasonality?seasonalityMultiplier(date.getMonth(),snapshots):1;
      const baselineRevenue=revenue*seasonal*(locationOpen?1+locationRevenuePct:1);
      const monthRevenue=baselineRevenue+extra.revenue+(month===1?extra.oneOffRevenue:0);
      const variableBase=base.revenue>0?base.directCosts*(baselineRevenue/base.revenue):0;
      const monthCosts=base.expenses+variableBase+extra.cost+extra.directCost+hireMonthly+otherCost+(locationOpen?locationCost:0)+(month===1?extra.oneOffCost+extra.oneOffDirectCost+locationSetup:0);
      cash+=monthRevenue-monthCosts;if(cash<0&&firstShortfall===null)firstShortfall=month;
      out+=`<tr><td>Month ${month}${month===locationMonth?' · location opens':''}</td><td>${fmt(monthRevenue)}</td><td>${fmt(monthCosts)}</td><td class="${cash<0?'value-negative':''}">${fmt(cash)}</td></tr>`;
    }
    const verdict=firstShortfall?`Projected cash falls below zero in month ${firstShortfall}.`:`Projected closing cash after 12 months: ${fmt(cash)}.`;
    document.getElementById('forecastResult').innerHTML=`<div class="forecast-verdict"><span class="eyebrow">12-MONTH OUTLOOK</span><strong>${verdict}</strong><p>Added wages: ${fmt(hireMonthly)} / month · named assumptions are included at their chosen timing.</p></div><div class="table-scroll"><table class="margin-table forecast-table"><thead><tr><th>Period</th><th>Revenue</th><th>Costs + setup</th><th>Closing cash</th></tr></thead><tbody>${out}</tbody></table></div><p class="pro-note">${useSeasonality?'Revenue seasonality uses your saved monthly snapshots and current growth assumption.':'No complete 12-month snapshot history is saved; seasonality is off and current growth is used.'} Direct costs scale with baseline revenue at the current offer mix. Hourly wages use hours × 52/12 and exclude employer taxes, benefits, and overtime. This is a planning estimate, not a guarantee.</p>`;
  };

  window.runCustomScenario=function(){
    const base=currentTotals(),extra=assumptionTotals();
    const revenue=base.revenue+extra.revenue,direct=base.directCosts+extra.directCost,costs=base.expenses+extra.cost;
    const monthlyNet=revenue-costs-direct;
    const cashAfterOneOff=base.cash+extra.oneOffRevenue-extra.oneOffCost-extra.oneOffDirectCost;
    const runway=cashAfterOneOff<=0?`Immediate cash shortfall of ${fmt(Math.abs(cashAfterOneOff))} after one-time assumptions`:monthlyNet>=0?'Cash-positive':`${(cashAfterOneOff/Math.abs(monthlyNet)).toFixed(1)} months at this pace`;
    const contributionRatio=revenue>0?(revenue-direct)/revenue:0,requiredRevenue=contributionRatio>0?costs/contributionRatio:costs;
    const result=document.getElementById('customScenarioResult');if(!result)return;
    result.classList.remove('hidden');document.getElementById('customRunwayResult').textContent=runway;
    const advice=document.getElementById('marginAdviceText'),box=document.getElementById('marginAdviceBox');
    if(advice&&box){advice.innerHTML=`Estimated recurring monthly break-even sales are <strong>${fmt(requiredRevenue)}</strong>. Recurring assumptions change monthly net cash flow to <strong>${fmt(monthlyNet)}</strong>; one-time assumptions change opening cash to <strong>${fmt(cashAfterOneOff)}</strong>.`;box.classList.remove('hidden');}
  };
  window.renderScenarios=function(cash,revenue,expenses,directCosts=0){const net=expenses+directCosts-revenue;const labels=[['scenBaseRunway',net<=0?'Cash-positive':`${(cash/net).toFixed(1)} mos`],['scenHireRunway','Run the 12-month forecast'],['scenPriceRunway',revenue>0?fmt(expenses+directCosts):'Add income']];labels.forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=value;});};

  function scheduleDailyQuoteRefresh(){if(quoteRefreshTimer)clearTimeout(quoteRefreshTimer);const now=new Date();const next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,1);quoteRefreshTimer=setTimeout(()=>{renderDailyQuote();scheduleDailyQuoteRefresh();},Math.max(1000,next.getTime()-Date.now()));}
  window.renderProExperience=function(){renderTier();renderHistorySummary();renderGuardian();renderMargins();updateBreakEven();renderScenarioAssumptions();renderInventory();renderSuppliers();renderReviews();renderCompliance();renderDailyQuote();scheduleDailyQuoteRefresh();};
  const originalOnload=window.onload;
  window.onload=async function(event){if(typeof originalOnload==='function')await originalOnload.call(this,event);renderProExperience();};
  const originalRecalculate=window.recalculateAll;
  window.recalculateAll=function(...args){const result=originalRecalculate.apply(this,args);renderProExperience();return result;};
})();
