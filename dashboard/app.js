/* Token Radar dashboard: board, detail, live view, calibration and sandbox.
   Reads window.RADAR (written by main.ts from the same board.json the page
   shows) and renders with no network and no framework. Deep links for the
   screenshots: ?shot=detail&slug=<slug> opens a protocol,
   ?shot=filtered&category=<c> filters the board. */
(() => {
  'use strict';
  const D = window.RADAR;
  if (!D) { document.body.textContent = 'No radar data.'; return; }
  const rows = D.rows;
  const live = D.live;
  const $ = (id) => document.getElementById(id);

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const money = (value) => {
    if (value == null) return '—';
    const units = [[1e9, 2, 'B'], [1e6, 1, 'M'], [1e3, 1, 'K']];
    for (const [limit, digits, suffix] of units) {
      if (value >= limit) return '$' + (value / limit).toFixed(digits) + suffix;
    }
    return '$' + Math.round(value);
  };
  const pct = (n) => {
    if (n == null) return '<span class="dim">—</span>';
    const cls = n >= 0 ? 'up' : 'down';
    return `<span class="${cls}">${n >= 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
  };
  const ageLabel = (days) => {
    if (days == null) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  };
  const chainsLabel = (chains, max = 3) =>
    chains.slice(0, max).join(', ') + (chains.length > max ? ' +' + (chains.length - max) : '');

  /* ---- header stats ---- */
  const stat = (b, l) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`;
  const leader = rows[0];
  $('stats').innerHTML = [
    stat('758', 'protocols'),
    stat(String(D.watchlist_size), 'watchlist'),
    stat(String(D.board_size), 'ranked'),
    stat(String(D.live_size), 'live tokens'),
    stat(money(leader ? leader.implied_value_usd : 0), 'top implied'),
  ].join('');
  $('src').textContent = D.source + ' · as of ' + D.as_of;

  /* ---- tabs ---- */
  const tabs = document.querySelectorAll('#tabs button');
  const showTab = (name) => {
    tabs.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === name));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  };
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.getAttribute('data-tab'))));

  /* ---- filters ---- */
  const q = $('q'), fcat = $('fcat'), fchain = $('fchain'), fwl = $('fwl'), sortSel = $('sort');
  const cats = [...new Set(rows.map((r) => r.category || 'Uncategorized'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  cats.forEach((c) => fcat.add(new Option(c, c)));
  chains.forEach((c) => fchain.add(new Option(c, c)));

  let sortKey = 'rank', sortDir = 1, selected = null;
  const SORTS = {
    rank: (a, b) => a.rank - b.rank,
    implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d),
    age: (a, b) => (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days),
    name: (a, b) => a.name.localeCompare(b.name),
    category: (a, b) => (a.category || '').localeCompare(b.category || ''),
    multiple: (a, b) => b.category_multiple - a.category_multiple,
  };

  const filtered = () => {
    const query = q.value.trim().toLowerCase();
    const matches = rows.filter((r) => {
      if (query && r.name.toLowerCase().indexOf(query) < 0 && r.slug.indexOf(query) < 0) return false;
      const cat = r.category || 'Uncategorized';
      if (fcat.value && cat !== fcat.value) return false;
      if (fchain.value && r.chains.indexOf(fchain.value) < 0) return false;
      if (fwl.checked && !r.watchlist) return false;
      return true;
    });
    matches.sort(SORTS[sortKey] || SORTS.rank);
    if (sortDir < 0) matches.reverse();
    return matches;
  };

  const boardRowHtml = (r) =>
    `<tr data-slug="${esc(r.slug)}"${selected === r.slug ? ' class="sel"' : ''}>` +
    `<td class="num">${r.rank}</td>` +
    `<td><b>${esc(r.name)}</b>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}` +
    `<br><span class="slug">${esc(r.slug)}</span></td>` +
    `<td>${esc(r.category || '—')}</td>` +
    `<td>${esc(chainsLabel(r.chains))}</td>` +
    `<td class="num">${money(r.tvl_usd)}</td>` +
    `<td class="num">${pct(r.change_7d)}</td>` +
    `<td class="num implied">${money(r.implied_value_usd)}</td>` +
    `<td class="num">×${r.category_multiple.toFixed(2)}</td></tr>`;

  function renderBoard() {
    const list = filtered();
    const tb = $('rows');
    tb.innerHTML = list.map(boardRowHtml).join('');
    $('count').textContent =
      list.length + ' of ' + rows.length + ' protocols · click a row for its farm plan and model breakdown';
    tb.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
    });
  }

  document.querySelectorAll('#board th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-k');
      if (sortKey === key) { sortDir = -sortDir; } else { sortKey = key; sortDir = 1; }
      sortSel.value = key;
      renderBoard();
    });
  });
  [q, fcat, fchain, fwl, sortSel].forEach((control) => {
    control.addEventListener('input', () => {
      if (control === sortSel) { sortKey = sortSel.value; sortDir = 1; }
      renderBoard();
    });
  });

  /* ---- detail view ---- */
  const term = (b, l, res) => `<div class="term${res ? ' result' : ''}"><b>${b}</b><span>${esc(l)}</span></div>`;
  const op = (s) => `<div class="op">${s}</div>`;

  function openDetail(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    selected = slug;
    const cal = D.calibration.find((c) => c.category === (r.category || 'Uncategorized'));
    const comps = live.filter((l) => l.category === r.category).slice(0, 3);
    const base = r.tvl_usd * r.category_multiple;
    const detailParts = [
      '<div class="detail"><button class="close" id="dclose" aria-label="Close detail">×</button>',
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="slug">' + esc(r.slug) + '</span>',
      (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>',
      '<p class="meta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ')),
      ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + (r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'),
      ' · tracked ' + ageLabel(r.age_days) + ' · records no token</p>',
      '<div class="eq">' + term(money(r.tvl_usd), 'TVL') + op('×'),
      term('×' + r.category_multiple.toFixed(2), (r.category || 'Uncategorized') + ' multiple' + (cal ? ' · median of ' + cal.n + ' traded' : '')) + op('×'),
      term('×' + r.growth_multiplier.toFixed(2), 'growth ' + (r.growth_pct >= 0 ? '+' : '') + r.growth_pct.toFixed(1) + '%') + op('×'),
      term('×' + r.maturity_multiplier.toFixed(2), 'maturity ' + ageLabel(r.age_days)) + op('='),
      term(money(r.implied_value_usd), 'implied value', true) + '</div>',
      '<p class="meta">Base value ' + money(base) + ' before growth and maturity. The category multiple is the median market-cap / TVL of traded ',
      esc(r.category || 'Uncategorized') + ' protocols in this snapshot' + (cal && cal.fallback ? ', falling back to the all-market median ' + D.overall_median_multiple.toFixed(2) + ' where the category has fewer than 4 traded names' : '') + '.</p>',
      '<h3>Farm plan</h3><ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>',
      comps.length ? '<h3>Traded comparables in ' + esc(r.category || 'Uncategorized') + '</h3><p class="comps">' + comps.map((l) => '<b>' + esc(l.name) + '</b> mcap ' + money(l.mcap_usd) + ' on TVL ' + money(l.tvl_usd) + ' (×' + (l.multiple == null ? '—' : l.multiple.toFixed(2)) + ')').join(' · ') + '</p>' : '',
      '</div>',
    ];
    $('detail').innerHTML = detailParts.join('');
    $('dclose').addEventListener('click', () => {
      selected = null;
      $('detail').innerHTML = '';
      renderBoard();
    });
    renderBoard();
    $('detail').scrollIntoView({ block: 'nearest' });
  }

  /* ---- live view ---- */
  $('liverows').innerHTML = live.map((l, i) =>
    '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(l.name) + '</b><br><span class="slug">' + esc(l.slug) + '</span></td>' +
    '<td>' + esc(l.category || '—') + '</td><td>' + esc(chainsLabel(l.chains)) + '</td>' +
    '<td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td>' +
    '<td class="num">×' + (l.multiple == null ? '—' : l.multiple.toFixed(2)) + '</td>' +
    '<td class="num">' + pct(l.change_7d) + '</td></tr>').join('');

  /* ---- calibration table ---- */
  $('calrows').innerHTML = D.calibration.map((c) =>
    '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td>' +
    '<td class="num">×' + c.median_multiple.toFixed(2) + '</td>' +
    '<td class="num">×' + c.used_multiple.toFixed(2) + (c.fallback ? ' <span class="slug">(market median)</span>' : '') + '</td></tr>').join('');

  /* ---- sandbox ---- */
  const sScale = $('s-scale'), sGrowth = $('s-growth'), sMat = $('s-mat');
  function sandbox() {
    const scale = parseFloat(sScale.value), gw = parseFloat(sGrowth.value), mf = parseFloat(sMat.value);
    $('v-scale').textContent = scale.toFixed(2) + '×';
    $('v-growth').textContent = gw.toFixed(2);
    $('v-mat').textContent = mf.toFixed(2);
    const rescored = rows.map((r) => {
      const g = 1 + (r.growth_pct / 100) * gw;
      const age = r.age_days == null ? D.model.unknown_age_days : r.age_days;
      const m = mf + (Math.min(Math.max(age, 0), D.model.maturity_days) / D.model.maturity_days) * (1 - mf);
      return { r, v: Math.max(1, Math.round(r.tvl_usd * r.category_multiple * scale * g * m)) };
    }).sort((a, b) => b.v - a.v);
    $('sandrows').innerHTML = rescored.slice(0, 8).map((x, i) =>
      '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(x.r.name) + '</b></td>' +
      '<td class="num implied">' + money(x.v) + '</td><td class="num">#' + x.r.rank + '</td></tr>').join('');
  }
  [sScale, sGrowth, sMat].forEach((el) => el.addEventListener('input', sandbox));

  /* ---- deep links for screenshots ---- */
  const query = new URLSearchParams(location.search);
  const view = query.get('shot');
  if (view === 'filtered') {
    if (query.get('category')) { fcat.value = query.get('category'); }
    if (query.get('watchlist')) { fwl.checked = true; }
  }
  renderBoard();
  sandbox();
  if (view === 'detail' && query.get('slug')) { openDetail(query.get('slug')); }
})();
