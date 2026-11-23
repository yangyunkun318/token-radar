/* Token Radar dashboard: board, detail, live view, calibration and sandbox.
   Reads window.RADAR (written by main.ts from the same board.json the page shows),
   renders with no network and no framework. Deep links for screenshots:
   ?shot=detail&slug=<slug> opens a protocol, ?shot=filtered&category=<c> filters. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'No radar data.'; return; }
  var rows = D.rows, live = D.live;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '<span class="dim">—</span>';
    var c = n >= 0 ? 'up' : 'down';
    return '<span class="' + c + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageLabel(d) {
    if (d == null) return '—';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }

  /* ---- header stats ---- */
  var top = rows[0];
  document.getElementById('stats').innerHTML =
    stat('758', 'protocols') + stat(String(D.watchlist_size), 'watchlist') +
    stat(String(D.board_size), 'ranked') + stat(String(D.live_size), 'live tokens') +
    stat(money(top ? top.implied_value_usd : 0), 'top implied');
  function stat(b, l) { return '<div class="stat"><b>' + b + '</b><span>' + l + '</span></div>'; }
  document.getElementById('src').textContent = D.source + ' · as of ' + D.as_of;

  /* ---- tabs ---- */
  var tabs = document.querySelectorAll('#tabs button');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });
  function showTab(name) {
    tabs.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    document.querySelectorAll('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
  }

  /* ---- filters ---- */
  var q = document.getElementById('q'), fcat = document.getElementById('fcat'),
      fchain = document.getElementById('fchain'), fwl = document.getElementById('fwl'),
      sortSel = document.getElementById('sort');
  var cats = [...new Set(rows.map(function (r) { return r.category || 'Uncategorized'; }))].sort();
  var chains = [...new Set(rows.flatMap(function (r) { return r.chains; }))].sort();
  cats.forEach(function (c) { fcat.add(new Option(c, c)); });
  chains.forEach(function (c) { fchain.add(new Option(c, c)); });

  var sortKey = 'rank', sortDir = 1;
  var selected = null;
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    change: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
    name: function (a, b) { return a.name.localeCompare(b.name); },
    category: function (a, b) { return (a.category || '').localeCompare(b.category || ''); },
    multiple: function (a, b) { return b.category_multiple - a.category_multiple; }
  };

  function filtered() {
    var needle = q.value.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (fcat.value && (r.category || 'Uncategorized') !== fcat.value) return false;
      if (fchain.value && r.chains.indexOf(fchain.value) < 0) return false;
      if (fwl.checked && !r.watchlist) return false;
      if (needle && r.name.toLowerCase().indexOf(needle) < 0 && r.slug.indexOf(needle) < 0) return false;
      return true;
    });
    list.sort(SORTS[sortKey] || SORTS.rank);
    if (sortDir < 0) list.reverse();
    return list;
  }

  function renderBoard() {
    var list = filtered();
    var tb = document.getElementById('rows');
    tb.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">×' + r.category_multiple.toFixed(2) + '</td></tr>';
    }).join('');
    document.getElementById('count').textContent =
      list.length + ' of ' + rows.length + ' protocols · click a row for its farm plan and model breakdown';
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = 1; }
      sortSel.value = k;
      renderBoard();
    });
  });
  [q, fcat, fchain, fwl, sortSel].forEach(function (el) {
    el.addEventListener('input', function () {
      if (el === sortSel) { sortKey = sortSel.value; sortDir = 1; }
      renderBoard();
    });
  });

  /* ---- detail view ---- */
  function openDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    selected = slug;
    var cal = D.calibration.find(function (c) { return c.category === (r.category || 'Uncategorized'); });
    var comps = live.filter(function (l) { return l.category === r.category; }).slice(0, 3);
    var base = r.tvl_usd * r.category_multiple;
    document.getElementById('detail').innerHTML =
      '<div class="detail"><button class="close" id="dclose" aria-label="Close detail">×</button><h2>#' + r.rank + ' ' + esc(r.name) +
      ' <span class="slug">' + esc(r.slug) + '</span>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + (r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') +
      ' · tracked ' + ageLabel(r.age_days) + ' · records no token</p>' +
      '<div class="eq">' +
      term(money(r.tvl_usd), 'TVL') + op('×') +
      term('×' + r.category_multiple.toFixed(2), (r.category || 'Uncategorized') + ' multiple' + (cal ? ' · median of ' + cal.n + ' traded' : '')) + op('×') +
      term('×' + r.growth_multiplier.toFixed(2), 'growth ' + (r.growth_pct >= 0 ? '+' : '') + r.growth_pct.toFixed(1) + '%') + op('×') +
      term('×' + r.maturity_multiplier.toFixed(2), 'maturity ' + ageLabel(r.age_days)) + op('=') +
      term(money(r.implied_value_usd), 'implied value', true) +
      '</div>' +
      '<p class="meta">Base value ' + money(base) + ' before growth and maturity. The category multiple is the median market-cap / TVL of traded ' +
      esc(r.category || 'Uncategorized') + ' protocols in this snapshot' + (cal && cal.fallback ? ', falling back to the all-market median ' + D.overall_median_multiple.toFixed(2) + ' where the category has fewer than 4 traded names' : '') + '.</p>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (comps.length ? '<h3>Traded comparables in ' + esc(r.category || 'Uncategorized') + '</h3><p class="comps">' +
        comps.map(function (l) { return '<b>' + esc(l.name) + '</b> mcap ' + money(l.mcap_usd) + ' on TVL ' + money(l.tvl_usd) + ' (×' + (l.multiple == null ? '—' : l.multiple.toFixed(2)) + ')'; }).join(' · ') + '</p>' : '') +
      '</div>';
    function term(b, l, res) { return '<div class="term' + (res ? ' result' : '') + '"><b>' + b + '</b><span>' + esc(l) + '</span></div>'; }
    function op(s) { return '<div class="op">' + s + '</div>'; }
    document.getElementById('dclose').addEventListener('click', function () {
      selected = null;
      document.getElementById('detail').innerHTML = '';
      renderBoard();
    });
    renderBoard();
    document.getElementById('detail').scrollIntoView({ block: 'nearest' });
  }

  /* ---- live view ---- */
  document.getElementById('liverows').innerHTML = live.map(function (l, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(l.name) + '</b><br><span class="slug">' + esc(l.slug) + '</span></td>' +
      '<td>' + esc(l.category || '—') + '</td><td>' + esc(l.chains.slice(0, 3).join(', ')) + '</td>' +
      '<td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td>' +
      '<td class="num">×' + (l.multiple == null ? '—' : l.multiple.toFixed(2)) + '</td>' +
      '<td class="num">' + pct(l.change_7d) + '</td></tr>';
  }).join('');

  /* ---- calibration table ---- */
  document.getElementById('calrows').innerHTML = D.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td>' +
      '<td class="num">×' + c.median_multiple.toFixed(2) + '</td>' +
      '<td class="num">×' + c.used_multiple.toFixed(2) + (c.fallback ? ' <span class="slug">(market median)</span>' : '') + '</td></tr>';
  }).join('');

  /* ---- sandbox ---- */
  var sScale = document.getElementById('s-scale'), sGrowth = document.getElementById('s-growth'),
      sMat = document.getElementById('s-mat');
  function sandbox() {
    var scale = parseFloat(sScale.value), gw = parseFloat(sGrowth.value), mf = parseFloat(sMat.value);
    document.getElementById('v-scale').textContent = scale.toFixed(2) + '×';
    document.getElementById('v-growth').textContent = gw.toFixed(2);
    document.getElementById('v-mat').textContent = mf.toFixed(2);
    var rescored = rows.map(function (r) {
      var g = 1 + (r.growth_pct / 100) * gw;
      var age = r.age_days == null ? D.model.unknown_age_days : r.age_days;
      var m = mf + (Math.min(Math.max(age, 0), D.model.maturity_days) / D.model.maturity_days) * (1 - mf);
      return { r: r, v: Math.max(1, Math.round(r.tvl_usd * r.category_multiple * scale * g * m)) };
    }).sort(function (a, b) { return b.v - a.v; });
    document.getElementById('sandrows').innerHTML = rescored.slice(0, 8).map(function (x, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(x.r.name) + '</b></td>' +
        '<td class="num implied">' + money(x.v) + '</td><td class="num">#' + x.r.rank + '</td></tr>';
    }).join('');
  }
  [sScale, sGrowth, sMat].forEach(function (el) { el.addEventListener('input', sandbox); });

  /* ---- deep links for screenshots ---- */
  var params = new URLSearchParams(location.search);
  var shot = params.get('shot');
  if (shot === 'filtered') {
    if (params.get('category')) { fcat.value = params.get('category'); }
    if (params.get('watchlist')) { fwl.checked = true; }
  }
  renderBoard();
  sandbox();
  if (shot === 'detail' && params.get('slug')) { openDetail(params.get('slug')); }
})();
