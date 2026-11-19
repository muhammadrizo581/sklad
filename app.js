(function () {
  'use strict';
  const C = window.Core;
  const STORE_KEY = 'sklad-db-v1';
  const DEFAULT_WAREHOUSES = ['Sentr', 'XBK', 'Orzu', 'Yangi yol', '80 metr', 'Uy'];
  const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
  const TYPE_HINT = {
    chiqim: "Skladdan do'konga tovar berildi: sklad qoldig'i kamayadi, do'konning hisobiga yoziladi.",
    kirim: "Skladga tovar keldi: qoldiq oshadi. Narx — tushgan narx.",
    qaytish: "Do'kon tovarni qaytardi: tovar skladga qaytadi, do'konning hisobidan ayiriladi.",
    kochirish: "Tovar bir skladdan boshqasiga o'tkaziladi.",
    tuzatish: "Skladni sanab chiqqanda haqiqiy qoldiqni yozing — dastur farqni o'zi hisoblaydi.",
  };
  const NAV = [
    ['yangi', 'Yangi harakat'],
    ['skladlar', 'Skladlar'],
    ['dokonlar', "Do'konlar"],
    ['hisob', 'Hisob-kitob'],
    ['statistika', 'Statistika'],
    ['jurnal', 'Jurnal'],
    ['qoldiq', 'Qoldiq / Tovarlar'],
    ['klient', "Mijoz ro'yxati"],
    ['sozlamalar', 'Sozlamalar'],
  ];

  let db = null;
  let storageOk = true;
  const main = document.getElementById('main');

  // ---------- Saqlash ----------
  function loadDb() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { storageOk = false; }
    return null;
  }

  // Faqat shu qurilmaga yozish
  function writeLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOk = true; } catch (e) { storageOk = false; }
    updateStorageBanner();
  }

  // Har qanday o'zgarishdan keyin: shu qurilmaga yoziladi, bulut ulangan bo'lsa u yerga ham yuboriladi
  function saveDb() {
    writeLocal();
    if (cloud) window.Sync.schedule();
  }

  function updateStorageBanner() {
    document.getElementById('storage-banner').hidden = storageOk;
  }

  // ---------- Yordamchilar ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const find = (arr, id) => arr.find((x) => x.id === id);
  const prodName = (id) => (find(db.products, id) || {}).name || '—';
  const whName = (id) => (find(db.warehouses, id) || {}).name || '—';
  const personName = (id) => (find(db.people, id) || {}).name || '—';
  // Do'kon turi: 'own' = o'zimizniki (faqat tushgan narx), 'other' = birovniki (narx + bizning foyda)
  const PERSON_KINDS = { other: 'Birovniki', own: "O'zimizniki" };
  const personKind = (p) => (p && p.kind === 'own' ? 'own' : 'other');
  const isOwnShop = (id) => personKind(find(db.people, id)) === 'own';
  const cur = () => (db.settings && db.settings.currency) || '';
  // Summa yonida kichik yashil pul belgisi (HTML)
  const money = (x) => (cur() ? `<span class="cur">${esc(cur())}</span>` : '') + C.fmtMoney(x);
  const sortByName = (arr) => arr.slice().sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  const str = (v) => (v ? String(v) : '');
  const monthLabel = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const tokens = (q) => C.normName(q).split(' ').filter(Boolean);
  const matches = (name, toks) => { const n = C.normName(name); return toks.every((t) => n.includes(t)); };

  function options(list, selected, placeholder) {
    const items = list.filter((x) => !x.archived || x.id === selected);
    return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
      items.map((x) => `<option value="${x.id}"${x.id === selected ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  }

  function typeBadge(t) { return `<span class="badge t-${t}">${C.TYPES[t].label}</span>`; }

  function docTarget(doc) {
    if (doc.type === 'kochirish') return '→ ' + whName(doc.toWarehouseId);
    if (doc.personId) return personName(doc.personId);
    return '';
  }

  function hasMoney(type) { return C.TYPES[type].needsPrice; }
  function isPerLine(type) { return C.TYPES[type].perLine; }
  // Narx ustuni tushgan narxni (cost) bildiradimi? Kirim va "o'zimizniki" do'konga chiqim/qaytishda — ha.
  function isCostField() {
    const t = form.type;
    if (t === 'kirim') return true;
    if ((t === 'chiqim' || t === 'qaytish') && form.personId && isOwnShop(form.personId)) return true;
    return false;
  }
  // Ikki narx: oddiy (o'zimizniki bo'lmagan) do'konga chiqim/qaytishda tushgan narx (ko'rsatiladi) + sotish narxi (tahrirlanadi).
  function isDualPrice() {
    const t = form.type;
    return (t === 'chiqim' || t === 'qaytish') && !!form.personId && !isOwnShop(form.personId);
  }
  // O'z do'koniga chiqim/qaytishda tushgan narx shu yerda tahrirlanmaydi (faqat Qoldiq/Tovarlardan o'zgaradi).
  function isReadonlyCost() {
    const t = form.type;
    return (t === 'chiqim' || t === 'qaytish') && !!form.personId && isOwnShop(form.personId);
  }
  const NUM_KEYS = ['rolls', 'rollM', 'linto', 'price'];
  // Qoldiq: avval rulon, yonida kichik qilib metr
  function stockHtml(s) {
    return `<b>${C.fmtNum(s.rolls)}</b> <span class="sub">r</span> <span class="sub">· ${C.fmtNum(s.metr)} m</span>`;
  }
  // Rulon ustuni: jami rulon, lintodagilar bo'lsa qavsda (butun + linto)
  function rollsCell(it) {
    const lr = C.num(it.lintoRolls);
    return C.fmtNum(C.itemRolls(it)) + (lr ? ` <span class="sub">(${C.fmtNum(it.rolls)}+${C.fmtNum(lr)})</span>` : '');
  }
  function lintoCell(it) {
    if (!it.linto) return '';
    const ex = it.exprs && it.exprs.linto;
    return ex ? `<span title="${esc(ex)}">${C.fmtNum(it.linto)}</span>` : C.fmtNum(it.linto);
  }
  function docWhNames(doc) { return C.docWarehouses(doc).map(whName).join(', ') || '—'; }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2600);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Excel (rus/o'zbek Windows) uchun: ; ajratgich, vergulli kasr
  function downloadCSV(filename, header, rows) {
    const cell = (v) => {
      if (typeof v === 'number') return String(C.r4(v)).replace('.', ',');
      const s = String(v == null ? '' : v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const text = '﻿' + [header].concat(rows).map((r) => r.map(cell).join(';')).join('\r\n');
    download(filename, text, 'text/csv;charset=utf-8');
  }

  // ---------- Modal oynalar ----------
  function openModal(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(opts.title)}</h2><button class="x-btn" data-close aria-label="Yopish">×</button></div>
      <div class="modal-body">${opts.body}</div>
      <div class="modal-foot"></div></div>`;
    const foot = $('.modal-foot', wrap);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (opts.onClose) opts.onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && opts.enterButton !== undefined && e.target.tagName === 'INPUT') {
        e.preventDefault();
        foot.children[opts.enterButton].click();
      }
    };
    (opts.buttons || [{ label: 'Yopish', kind: 'ghost' }]).forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.kind || '');
      el.textContent = b.label;
      el.onclick = () => (b.onClick ? b.onClick(close, wrap) : close());
      foot.appendChild(el);
    });
    $('[data-close]', wrap).onclick = close;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    const f = opts.focus ? $(opts.focus, wrap) : null;
    if (f) { f.focus(); if (f.select) f.select(); }
    return { el: wrap, close };
  }

  function confirmModal(title, html, okLabel, kind) {
    return new Promise((resolve) => {
      let result = false;
      openModal({
        title, body: html,
        onClose: () => resolve(result),
        buttons: [
          { label: 'Bekor', kind: 'ghost' },
          { label: okLabel || 'Ha', kind: kind || 'primary', onClick: (close) => { result = true; close(); } },
        ],
      });
    });
  }

  // O'chirish — ikki marta so'raydi (bexosdan o'chib ketmasligi uchun)
  async function confirmDelete(title, html, okLabel) {
    const ok1 = await confirmModal(title, html, okLabel || "Ha, o'chirish", 'danger');
    if (!ok1) return false;
    return confirmModal(title, '<p><b>Oxirgi tasdiq.</b> Buni ortga qaytarib bo\'lmaydi. Rostdan o\'chirilsinmi?</p>', "Ha, o'chirish", 'danger');
  }

  // ---------- Navigatsiya ----------
  function buildNav() {
    $('#nav').innerHTML = NAV.map(([k, label]) => `<a href="#/${k}" data-nav="${k}">${label}</a>`).join('');
  }

  // Chap menyu: katta ekranda yopiladi/ochiladi (eslab qolinadi), tor ekranda ustidan sirg'alib chiqadi
  const SIDE_KEY = 'sklad-side-collapsed';
  const narrow = () => window.matchMedia('(max-width: 860px)').matches;

  function setupSide() {
    const app = $('.app');
    try { if (localStorage.getItem(SIDE_KEY) === '1') app.classList.add('collapsed'); } catch (e) { /* saqlab bo'lmasa ham ishlayveradi */ }
    $('#side-toggle').onclick = () => {
      if (narrow()) { app.classList.toggle('side-open'); return; }
      const collapsed = app.classList.toggle('collapsed');
      try { localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0'); } catch (e) { /* e'tiborsiz */ }
    };
    $('#side-backdrop').onclick = () => app.classList.remove('side-open');
    $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) app.classList.remove('side-open'); });
  }

  const routes = {};
  let currentRoute = '';

  function renderCurrent() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const name = routes[parts[0]] ? parts[0] : 'yangi';
    currentRoute = name;
    document.body.classList.toggle('share-view', name === 'h');
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
    routes[name](parts.slice(1));
  }

  function route() {
    acClose();
    if ($('#chart-tip')) $('#chart-tip').hidden = true;
    exitSheetFullscreen();
    clearShopEdits();
    renderCurrent();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // Bulutdan yangi ma'lumot kelganda sahifani yangilaymiz (kiritish oynasi yoki modal ochiq bo'lsa tegmaymiz)
  function refreshAfterRemote() {
    if (currentRoute === 'yangi' || $('.modal-wrap') || $('#login') || $('.sheet-card.fs')) return;
    const y = window.scrollY;
    renderCurrent();
    window.scrollTo(0, y);
  }

  // ---------- Hujjatlar jadvali (bosh sahifa va jurnal) ----------
  function docTableHtml(docs, emptyText) {
    if (!docs.length) return `<div class="empty">${esc(emptyText || "Hech narsa yo'q")}</div>`;
    const rows = docs.map((d) => {
      const t = C.docTotals(d);
      const names = d.items.map((it) => prodName(it.productId));
      const preview = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
      return `<tr class="click${d.cancelled ? ' cancelled' : ''}" data-doc="${d.id}">
        <td class="num muted">${d.no}</td>
        <td class="nowrap">${C.fmtDate(d.date)}</td>
        <td>${typeBadge(d.type)}</td>
        <td>${esc(docWhNames(d))}</td>
        <td>${esc(docTarget(d))}</td>
        <td class="muted ell">${esc(preview)}</td>
        <td class="num">${C.fmtNum(t.metr)}</td>
        <td class="num">${hasMoney(d.type) ? money(t.sum) : ''}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="grid">
      <thead><tr><th class="num">№</th><th>Sana</th><th>Turi</th><th>Sklad</th><th>Do'kon / qayerga</th><th>Tovarlar</th><th class="num">Metr</th><th class="num">Summa</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function bindDocClicks(container) {
    $$('tr[data-doc]', container).forEach((tr) => { tr.onclick = () => openDocModal(find(db.docs, tr.dataset.doc)); });
  }

  // ---------- Bosh sahifa ----------
  routes.bosh = function renderHome() {
    const stock = C.computeStock(db);
    const month = C.today().slice(0, 7);
    const cards = db.warehouses.filter((w) => !w.archived).map((w) => {
      let metr = 0, rolls = 0, value = 0, kinds = 0;
      for (const p of db.products) {
        const s = C.getStock(stock, w.id, p.id);
        if (Math.abs(s.metr) < 0.005 && Math.abs(s.rolls) < 0.005) continue;
        metr += s.metr; rolls += s.rolls; value += (s.sum != null ? s.sum : s.metr * (p.cost || 0)); kinds++;
      }
      return `<a class="stat" href="#/skladlar" data-wh="${w.id}">
        <div class="stat-label">${esc(w.name)}</div>
        <div class="stat-value">${C.fmtNum(rolls, 0)} rulon</div>
        <div class="stat-sub">${C.fmtNum(metr, 0)} m · ${kinds} xil tovar · ${money(value)}</div></a>`;
    }).join('');

    const per = new Map();
    for (const d of db.docs) {
      if (d.cancelled || !d.date.startsWith(month) || (d.type !== 'chiqim' && d.type !== 'qaytish')) continue;
      const sign = d.type === 'qaytish' ? -1 : 1;
      const t = C.docTotals(d);
      const cur0 = per.get(d.personId) || { metr: 0, sum: 0 };
      cur0.metr += sign * t.metr; cur0.sum += sign * t.sum;
      per.set(d.personId, cur0);
    }
    const perRows = Array.from(per.entries()).sort((a, b) => b[1].sum - a[1].sum).map(([pid, v]) =>
      `<tr class="click" data-person="${pid}"><td>${esc(personName(pid))}</td><td class="num">${C.fmtNum(v.metr)}</td><td class="num">${money(v.sum)}</td></tr>`).join('');

    const recent = db.docs.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 10);

    main.innerHTML = `
      <div class="page-head"><h1>Bosh sahifa</h1>
        <div class="head-actions">
          <button class="btn primary" data-new="chiqim">+ Chiqim</button>
          <button class="btn" data-new="kirim">+ Kirim</button>
          <button class="btn" data-new="qaytish">+ Qaytish</button>
        </div></div>
      <h2 class="sec">Skladlardagi qoldiq</h2>
      <div class="stats">${cards || '<div class="empty">Sklad yo\'q</div>'}</div>
      <div class="two-col">
        <section class="card">
          <h2 class="card-title">${monthLabel(month)}: do'konlarga qancha chiqdi</h2>
          ${perRows ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Do'kon</th><th class="num">Metr</th><th class="num">Summa</th></tr></thead><tbody>${perRows}</tbody></table></div>`
            : '<div class="empty">Bu oy hali chiqim yo\'q</div>'}
        </section>
        <section class="card">
          <h2 class="card-title">Oxirgi kiritilganlar</h2>
          <div id="home-recent">${docTableHtml(recent, "Hali hech narsa kiritilmagan")}</div>
        </section>
      </div>`;
    $$('[data-new]').forEach((b) => { b.onclick = () => startNew(b.dataset.new); });
    $$('a[data-wh]').forEach((a) => { a.onclick = () => { wf.wh = a.dataset.wh; wf.q = ''; }; });
    $$('tr[data-person]').forEach((tr) => { tr.onclick = () => { pf.person = tr.dataset.person; pf.from = month + '-01'; pf.to = ''; location.hash = '#/dokonlar'; }; });
    bindDocClicks($('#home-recent'));
  };

  // ---------- Yangi harakat formasi ----------
  let form = null;

  function newLine(warehouseId) {
    return { warehouseId: warehouseId || '', productId: '', text: '', rolls: '', rollM: '', linto: '', price: '', priceTouched: false, rollMTouched: false };
  }

  function firstWh() { const w = db.warehouses.find((x) => !x.archived); return w ? w.id : ''; }

  // Qatorning skladi: chiqim/kirim/qaytishda qatorning o'zida, qolganlarida hujjat tepasida
  function lineWh(l) { return isPerLine(form.type) ? l.warehouseId : form.warehouseId; }

  function newForm(type, keep) {
    keep = keep || {};
    const wh = keep.warehouseId || firstWh();
    return {
      type: type || 'chiqim', date: keep.date || C.today(), warehouseId: wh,
      toWarehouseId: '', personId: keep.personId || '', note: '', lines: [newLine(wh)], editingId: null,
    };
  }

  function formFromDoc(doc) {
    const tz = doc.type === 'tuzatish';
    const lines = doc.items.map((it) => ({
      warehouseId: C.itemWh(doc, it), productId: it.productId, text: prodName(it.productId),
      rolls: (it.exprs && it.exprs.rolls) || str(tz ? it.counted.rolls : it.rolls), rollM: (it.exprs && it.exprs.rollM) || str(it.rollM),
      linto: (it.exprs && it.exprs.linto) || str(it.linto), price: (it.exprs && it.exprs.price) || str(it.price),
      priceTouched: true, rollMTouched: true,
    }));
    const wh = doc.warehouseId || (lines[0] && lines[0].warehouseId) || firstWh();
    lines.push(newLine(lines.length ? lines[lines.length - 1].warehouseId : wh));
    return {
      type: doc.type, date: doc.date, warehouseId: wh, toWarehouseId: doc.toWarehouseId || '',
      personId: doc.personId || '', note: doc.note || '', lines, editingId: doc.id,
    };
  }

  function startNew(type, preset) {
    const keep = form && !form.editingId ? { date: form.date, warehouseId: form.warehouseId } : {};
    form = newForm(type, Object.assign(keep, preset || {}));
    if (location.hash === '#/yangi') routes.yangi(); else location.hash = '#/yangi';
  }

  function startEdit(doc) {
    form = formFromDoc(doc);
    if (location.hash === '#/yangi') routes.yangi(); else location.hash = '#/yangi';
  }

  function defaultPrice(type, productId, personId) {
    const p = find(db.products, productId);
    if (!p) return '';
    if (type === 'kirim') return p.cost ? str(p.cost) : '';
    if (type === 'chiqim' || type === 'qaytish') {
      // O'z do'koni: narx qo'yilmaydi, faqat tushgan narx (cost) yoziladi.
      // Bazada tushgan narx bo'lmasa — bo'sh qoldiramiz, "yo'q" ko'rinib turadi, user kiritadi.
      if (personId && isOwnShop(personId)) return p.cost ? str(p.cost) : '';
      if (personId) {
        let best = null;
        for (const d of db.docs) {
          if (d.cancelled || d.type !== 'chiqim' || d.personId !== personId) continue;
          const it = d.items.find((x) => x.productId === productId);
          if (it && (!best || d.date > best.date || (d.date === best.date && d.no > best.no))) best = { date: d.date, no: d.no, price: it.price };
        }
        if (best) return str(best.price);
      }
      return str(p.price);
    }
    return '';
  }

  function refreshPrices() {
    for (const l of form.lines) {
      if (l.productId && !l.priceTouched) l.price = defaultPrice(form.type, l.productId, form.personId);
    }
  }

  function lineCols() {
    const tz = form.type === 'tuzatish';
    const cols = [{ key: 'no', label: '#' }];
    if (isPerLine(form.type)) cols.push({ key: 'wh', label: 'Sklad', text: true });
    cols.push(
      { key: 'prod', label: 'Tovar', text: true },
      { key: 'stock', label: tz ? 'Hisobda bor' : 'Skladda bor' },
      { key: 'rolls', label: tz ? 'Sanalgan rulon' : 'Rulon' },
      { key: 'rollM', label: '1 rulon, m' },
      { key: 'linto', label: 'Linto, m' },
      { key: 'metr', label: tz ? 'Sanalgan jami, m' : 'Jami metr' });
    if (tz) cols.push({ key: 'diff', label: 'Farq, m' });
    if (hasMoney(form.type)) {
      if (isDualPrice()) {
        cols.push({ key: 'cost', label: 'Tushgan narx' }, { key: 'price', label: 'Sotish narxi' }, { key: 'sum', label: 'Summa' });
      } else {
        const ownPrice = (form.type === 'chiqim' || form.type === 'qaytish') && form.personId && isOwnShop(form.personId);
        cols.push({ key: 'price', label: ownPrice ? 'Tushgan narx' : 'Narx' }, { key: 'sum', label: 'Summa' });
      }
    }
    cols.push({ key: 'del', label: '', text: true });
    return cols;
  }

  function lineRow(l, i) {
    const tz = form.type === 'tuzatish';
    const costField = isCostField();
    const roCost = isReadonlyCost();
    const ph = (k) => (k === 'linto' ? ' placeholder="45+44+46"' : (k === 'price' && costField && !roCost ? " placeholder=\"yo'q\"" : ''));
    const inp = (k) => `<td class="inp${k === 'price' ? ' price' : ''}${k === 'price' && costField && !roCost ? ' need' : ''}">${k === 'price' && cur() ? `<span class="cur in">${esc(cur())}</span>` : ''}<input class="n${k === 'linto' ? ' wide' : ''}${k === 'price' && roCost ? ' ro' : ''}" data-k="${k}" autocomplete="off" spellcheck="false" value="${esc(l[k])}"${k === 'price' && roCost ? ' readonly tabindex="-1" title="Tushgan narx Qoldiq/Tovarlardan o\'zgaradi"' : ''}${ph(k)}><div class="calc"></div></td>`;
    return `<tr data-i="${i}">
      <td class="num muted">${i + 1}</td>
      ${isPerLine(form.type) ? `<td><select class="wh" data-k="warehouseId">${options(db.warehouses, l.warehouseId, '— sklad —')}</select></td>` : ''}
      <td class="prod"><input class="ac${l.text && !l.productId ? ' bad' : ''}" data-k="text" value="${esc(l.text)}" placeholder="Tovar nomini yozing…" autocomplete="off" spellcheck="false"></td>
      <td class="num c-stock muted nowrap"></td>
      ${inp('rolls')}${inp('rollM')}${inp('linto')}
      <td class="num c-metr strong"></td>
      ${tz ? '<td class="num c-diff"></td>' : ''}
      ${hasMoney(form.type) ? (isDualPrice() ? '<td class="num c-cost muted nowrap"></td>' : '') + inp('price') + '<td class="num c-sum"></td>' : ''}
      <td><button class="x-btn" data-del title="Qatorni o'chirish" tabindex="-1">×</button></td></tr>`;
  }

  routes.yangi = function renderForm() {
    if (!form) form = newForm('chiqim');
    const t = C.TYPES[form.type];
    const editing = form.editingId ? find(db.docs, form.editingId) : null;
    const tz = form.type === 'tuzatish';
    const cols = lineCols();
    const footCell = { prod: '<td class="strong">Jami</td>', rolls: '<td class="num strong" id="t-rolls"></td>',
      metr: '<td class="num strong" id="t-metr"></td>', diff: '<td class="num strong" id="t-diff"></td>', sum: '<td class="num strong" id="t-sum"></td>' };
    const foot = cols.map((c) => footCell[c.key] || '<td></td>').join('');

    main.innerHTML = `
      <div class="page-head"><h1>${editing ? `№${editing.no} ni tahrirlash` : 'Yangi harakat'}</h1>
        ${editing ? '<div class="head-actions"><button class="btn ghost" id="f-cancel-edit">Tahrirlashni bekor qilish</button></div>' : ''}</div>
      <div class="seg" id="f-type" role="tablist">${Object.keys(C.TYPES).map((k) =>
        `<button data-type="${k}" class="${k === form.type ? 'on' : ''}"${editing ? ' disabled' : ''}>${C.TYPES[k].label}</button>`).join('')}</div>
      <p class="hint">${TYPE_HINT[form.type]}</p>
      <div class="card fields">
        <label class="f">Sana<input type="date" id="f-date" value="${form.date}"></label>
        ${isPerLine(form.type) ? '' : `<label class="f">${form.type === 'kochirish' ? 'Qaysi skladdan' : 'Sklad'}<select id="f-wh">${options(db.warehouses, form.warehouseId, '— tanlang —')}</select></label>`}
        ${form.type === 'kochirish' ? `<label class="f">Qaysi skladga<select id="f-to">${options(db.warehouses, form.toWarehouseId, '— tanlang —')}</select></label>` : ''}
        ${t.needsPerson ? `<div class="f">${form.type === 'qaytish' ? "Qaysi do'kon qaytardi" : "Do'kon"}<span class="inline">
          <select id="f-person">${options(sortByName(db.people), form.personId, '— tanlang —')}</select>
          <button class="btn sm" id="f-person-add" title="Yangi do'kon qo'shish">+ Yangi</button></span></div>` : ''}
        <label class="f grow">Izoh<input id="f-note" value="${esc(form.note)}" placeholder="ixtiyoriy"></label>
      </div>
      <div class="card flush">
        <div class="table-wrap"><table class="grid lines${tz ? ' tz' : ''}">
          <thead><tr>${cols.map((c) => `<th class="${c.text ? '' : 'num'}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody id="f-lines">${form.lines.map(lineRow).join('')}</tbody>
          <tfoot><tr>${foot}</tr></tfoot>
        </table></div>
        <div class="card-foot"><button class="btn" id="f-addline">+ Qator qo'shish</button>
          <span class="muted small">Enter — keyingi katakka o'tish</span></div>
      </div>
      <div id="f-msgs"></div>
      <div class="actions">
        <button class="btn ghost" id="f-clear">Tozalash</button>
        <button class="btn primary" id="f-save">Saqlash <kbd>Ctrl+S</kbd></button>
      </div>`;

    $$('#f-type button').forEach((b) => {
      b.onclick = () => {
        form.type = b.dataset.type;
        for (const l of form.lines) if (!l.warehouseId) l.warehouseId = form.warehouseId;
        refreshPrices();
        routes.yangi();
      };
    });
    $('#f-date').onchange = (e) => { form.date = e.target.value; };
    if ($('#f-wh')) $('#f-wh').onchange = (e) => { form.warehouseId = e.target.value; updateComputed(); };
    if ($('#f-to')) $('#f-to').onchange = (e) => { form.toWarehouseId = e.target.value; };
    if ($('#f-person')) {
      $('#f-person').onchange = (e) => { form.personId = e.target.value; refreshPrices(); routes.yangi(); };
      $('#f-person-add').onclick = async () => {
        const p = await entityModal('person', null);
        if (p) { form.personId = p.id; refreshPrices(); routes.yangi(); }
      };
    }
    $('#f-note').oninput = (e) => { form.note = e.target.value; };
    $('#f-addline').onclick = () => { addLine(); focusLine(form.lines.length - 1, 'text'); };
    $('#f-clear').onclick = async () => {
      const filled = form.lines.some((l) => l.productId || l.text);
      if (filled && !(await confirmModal('Tozalash', '<p>Kiritilgan qatorlar o\'chiriladi. Davom etasizmi?</p>', 'Tozalash', 'danger'))) return;
      const editingId = form.editingId;
      form = newForm(form.type, { date: form.date, warehouseId: form.warehouseId, personId: form.personId });
      if (editingId) form = formFromDoc(find(db.docs, editingId));
      routes.yangi();
    };
    if ($('#f-cancel-edit')) $('#f-cancel-edit').onclick = () => { form = null; location.hash = '#/jurnal'; };
    $('#f-save').onclick = saveForm;

    const body = $('#f-lines');
    body.addEventListener('input', onLineInput);
    body.addEventListener('change', (e) => {
      if (!e.target.classList.contains('wh')) return;
      const i = +e.target.closest('tr').dataset.i;
      form.lines[i].warehouseId = e.target.value;
      if (e.target.value) form.warehouseId = e.target.value;
      updateComputed();
      focusLine(i, form.lines[i].productId ? 'rolls' : 'text');
    });
    body.addEventListener('keydown', onLineKey);
    body.addEventListener('focusin', (e) => { if (e.target.classList.contains('ac')) acOpen(e.target); });
    body.addEventListener('focusout', (e) => { if (e.target.classList.contains('ac')) { acClose(); markBad(e.target); } });
    body.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      const i = +del.closest('tr').dataset.i;
      const removed = form.lines.splice(i, 1)[0];
      if (!form.lines.length) form.lines.push(newLine(removed.warehouseId || form.warehouseId));
      rerenderLines();
    });
    updateComputed();
    const firstEmpty = form.lines.findIndex((l) => !l.productId);
    if (!editing) focusLine(firstEmpty >= 0 ? firstEmpty : 0, 'text');
  };

  function rowEl(i) { return $(`#f-lines tr[data-i="${i}"]`); }

  function rerenderLines() {
    $('#f-lines').innerHTML = form.lines.map(lineRow).join('');
    updateComputed();
  }

  function addLine() {
    const prev = form.lines[form.lines.length - 1];
    form.lines.push(newLine((prev && prev.warehouseId) || form.warehouseId));
    $('#f-lines').insertAdjacentHTML('beforeend', lineRow(form.lines[form.lines.length - 1], form.lines.length - 1));
    updateComputed();
  }

  function focusLine(i, k) {
    const row = rowEl(i);
    const el = row && $(`input[data-k="${k}"]`, row);
    if (el) { el.focus(); el.select(); }
  }

  function markBad(input) {
    const l = form.lines[+input.closest('tr').dataset.i];
    if (l) input.classList.toggle('bad', !!l.text.trim() && !l.productId);
  }

  function onLineInput(e) {
    const input = e.target;
    const k = input.dataset.k;
    if (!k) return;
    const i = +input.closest('tr').dataset.i;
    const l = form.lines[i];
    l[k] = input.value;
    if (k === 'price') l.priceTouched = true;
    if (k === 'rollM') l.rollMTouched = true;
    if (k === 'text') {
      const exact = db.products.find((p) => !p.archived && C.normName(p.name) === C.normName(input.value));
      const allowed = exact && (!onlyInStock() || C.getStock(C.computeStock(db, { excludeDocId: form.editingId }), lineWh(l), exact.id).metr > 0.004);
      if (allowed) applyProduct(i, exact, true);
      else l.productId = '';
      input.classList.remove('bad');
      acRefresh();
    }
    updateComputed();
  }

  function onLineKey(e) {
    const input = e.target;
    if (input.tagName !== 'INPUT') return;
    if (input.classList.contains('ac') && ac.input === input && !ac.el.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Escape') { e.preventDefault(); acClose(); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && ac.items.length && input.value.trim()) {
        const l = form.lines[+input.closest('tr').dataset.i];
        const hiItem = ac.items[ac.hi];
        const alreadyChosen = l.productId && hiItem && hiItem.p && hiItem.p.id === l.productId;
        if (!alreadyChosen || e.key === 'Enter') { e.preventDefault(); acPick(ac.hi); return; }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); focusNext(input); }
  }

  function focusNext(input) {
    const row = input.closest('tr');
    const inputs = $$('input', row);
    const idx = inputs.indexOf(input);
    if (idx < inputs.length - 1) { inputs[idx + 1].focus(); inputs[idx + 1].select(); return; }
    const i = +row.dataset.i;
    if (i === form.lines.length - 1) addLine();
    focusLine(i + 1, 'text');
  }

  function applyProduct(i, p, silent) {
    const l = form.lines[i];
    l.productId = p.id;
    if (!silent) l.text = p.name;
    if (!l.rollMTouched) l.rollM = str(p.rollM);
    if (!l.priceTouched) l.price = defaultPrice(form.type, p.id, form.personId);
    const row = rowEl(i);
    if (row) {
      const set = (k) => { const el = $(`input[data-k="${k}"]`, row); if (el && (k === 'text' || el !== document.activeElement)) el.value = l[k]; };
      ['text', 'rollM', 'price'].forEach(set);
      $('input[data-k="text"]', row).classList.remove('bad');
    }
    if (i === form.lines.length - 1) addLine();
    updateComputed();
  }

  function updateComputed() {
    if (!$('#f-lines')) return;
    const stock = C.computeStock(db, { excludeDocId: form.editingId });
    const tz = form.type === 'tuzatish';
    const checkOver = form.type === 'chiqim' || form.type === 'kochirish';
    const need = new Map();
    const key = (l) => lineWh(l) + '|' + l.productId;
    form.lines.forEach((l) => {
      if (!l.productId) return;
      const n = need.get(key(l)) || { metr: 0, rolls: 0 };
      n.metr += C.lineMetr(l);
      n.rolls += C.num(l.rolls) + C.parseExpr(l.linto).pieces;
      need.set(key(l), n);
    });
    let tr = 0, tm = 0, ts = 0, td = 0;
    form.lines.forEach((l, i) => {
      const row = rowEl(i);
      if (!row) return;
      const metr = C.lineMetr(l);
      const lp = C.parseExpr(l.linto);
      const rolls = C.r2(C.num(l.rolls) + lp.pieces);
      // Ifoda yozilgan kataklar ostida natija: "= 135 · 3 r"
      for (const k of NUM_KEYS) {
        const input = $(`input[data-k="${k}"]`, row);
        if (!input) continue;
        const pe = k === 'linto' ? lp : C.parseExpr(l[k]);
        input.classList.toggle('bad', !pe.ok);
        input.nextElementSibling.textContent = !pe.ok ? 'xato' : pe.isExpr ? `= ${C.fmtNum(pe.value)}${k === 'linto' ? ` · ${C.fmtNum(pe.pieces)} r` : ''}` : '';
      }
      const w = lineWh(l);
      const st = l.productId && w ? C.getStock(stock, w, l.productId) : null;
      $('.c-stock', row).innerHTML = st ? stockHtml(st) : '';
      $('.c-metr', row).innerHTML = l.productId || metr ? `${C.fmtNum(metr)}${lp.pieces ? `<div class="calc">${C.fmtNum(rolls)} rulon</div>` : ''}` : '';
      const n = need.get(key(l));
      // Rulon — asosiy o'lchov; metr taxminiy. Rulon to'g'ri bo'lsa, metrdagi kichik farqqa yo'l qo'yamiz.
      const perRoll = st && st.rolls > 0.0001 ? st.metr / st.rolls : 0;
      const metrTol = Math.max(perRoll, 5);
      const over = checkOver && st && n && (n.rolls > st.rolls + 0.0001 || n.metr > st.metr + metrTol);
      row.classList.toggle('over', !!over);
      row.title = over ? `Skladda faqat ${C.fmtNum(st.rolls)} rulon (${C.fmtNum(st.metr)} m) bor — buncha ayirib bo'lmaydi` : '';
      if (tz) {
        const diff = st ? C.r2(metr - st.metr) : 0;
        const diffR = st ? C.r2(rolls - st.rolls) : 0;
        const cell = $('.c-diff', row);
        const sg = (x) => (x > 0 ? '+' : '') + C.fmtNum(x);
        cell.innerHTML = st ? `${sg(diffR)} r <span class="sub">· ${sg(diff)} m</span>` : '';
        cell.className = 'num c-diff ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : '');
        td += diff;
      }
      if (hasMoney(form.type)) {
        const s = C.r2(metr * C.num(l.price));
        $('.c-sum', row).innerHTML = metr && C.num(l.price) ? money(s) : '';
        ts += s;
        const cc = $('.c-cost', row);
        if (cc) { const p = find(db.products, l.productId); cc.innerHTML = p && p.cost ? `${cur() ? `<span class="cur">${esc(cur())}</span> ` : ''}${C.fmtNum(p.cost, 4)}` : (l.productId ? '<span class="zero">—</span>' : ''); }
      }
      tr += rolls;
      tm += metr;
    });
    $('#t-rolls').textContent = tr ? C.fmtNum(tr) : '';
    $('#t-metr').textContent = tm ? C.fmtNum(tm) : '';
    if ($('#t-diff')) $('#t-diff').textContent = td ? (td > 0 ? '+' : '') + C.fmtNum(td) : '';
    if ($('#t-sum')) $('#t-sum').innerHTML = ts ? money(ts) : '';
  }

  async function saveForm() {
    acClose();
    const tz = form.type === 'tuzatish';
    const t = C.TYPES[form.type];
    const stock = C.computeStock(db, { excludeDocId: form.editingId });
    const lines = form.lines.filter((l) => l.productId || l.text.trim() || C.num(l.rolls) || C.num(l.linto));
    const exprErrors = [];
    lines.forEach((l, i) => {
      for (const k of NUM_KEYS) if (!C.parseExpr(l[k]).ok) exprErrors.push(`${i + 1}-qator: «${l[k]}» noto'g'ri yozilgan`);
    });
    const items = lines.map((l) => {
      const p = find(db.products, l.productId);
      const lp = C.parseExpr(l.linto);
      const it = { productId: l.productId, warehouseId: lineWh(l), rolls: C.num(l.rolls), rollM: C.num(l.rollM), linto: lp.value, lintoRolls: lp.pieces };
      // Yozilgan ifodani saqlab qo'yamiz — tahrirlaganda Numbers dagidek qaytib chiqadi
      const exprs = {};
      for (const k of NUM_KEYS) if (C.parseExpr(l[k]).isExpr) exprs[k] = String(l[k]).trim();
      if (Object.keys(exprs).length) it.exprs = exprs;
      const metr = C.lineMetr(it);
      if (tz) {
        const before = C.getStock(stock, it.warehouseId, l.productId);
        it.before = { rolls: before.rolls, metr: before.metr };
        it.counted = { rolls: it.rolls, lintoRolls: it.lintoRolls, metr };
        it.rolls = C.r2(it.rolls + it.lintoRolls - before.rolls);
        it.lintoRolls = 0;
        it.metr = C.r2(metr - before.metr);
        it.price = p ? p.cost || 0 : 0;
      } else {
        it.metr = metr;
        it.price = t.needsPrice ? C.num(l.price) : (p ? p.cost || 0 : 0);
        if (isDualPrice()) it.cost = p ? p.cost || 0 : 0;
      }
      it.sum = C.lineSum(it);
      return it;
    });
    const doc = {
      id: C.uid(), no: 0, type: form.type, date: form.date, warehouseId: t.perLine ? null : form.warehouseId,
      note: form.note.trim(), items, createdAt: new Date().toISOString(),
    };
    if (t.needsPerson) doc.personId = form.personId;
    if (form.type === 'kochirish') doc.toWarehouseId = form.toWarehouseId;

    const { errors, warnings } = C.validateDoc(db, doc, { excludeDocId: form.editingId });
    errors.unshift(...exprErrors);
    const box = $('#f-msgs');
    if (errors.length) {
      box.innerHTML = `<div class="msg err"><b>Saqlanmadi:</b><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    box.innerHTML = '';
    if (warnings.length) {
      const ok = await confirmModal('Diqqat',
        `<ul class="warn-list">${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>Baribir saqlaysizmi?</p>`, 'Ha, saqlash');
      if (!ok) return;
    }
    doc.no = ++db.seq;
    const editingId = form.editingId;
    if (editingId) {
      const old = find(db.docs, editingId);
      old.cancelled = { at: new Date().toISOString(), reason: `Tahrirlandi → №${doc.no}` };
      doc.editedFrom = old.id;
    }
    db.docs.push(doc);
    // Tushgan narx bazada yo'q bo'lsa va user kiritgan bo'lsa — tovarga saqlab qo'yamiz (keyingi safar o'zi keladi)
    if (isCostField()) {
      for (const it of items) {
        const p = find(db.products, it.productId);
        if (p && !(p.cost > 0) && C.num(it.price) > 0) p.cost = C.num(it.price);
      }
    }
    saveDb();
    toast(`№${doc.no} saqlandi`);
    if (editingId) { form = null; location.hash = '#/jurnal'; return; }
    form = newForm(doc.type, { date: doc.date, warehouseId: doc.warehouseId || items[items.length - 1].warehouseId, personId: doc.personId });
    routes.yangi();
  }

  // ---------- Tovar qidirish (autocomplete) ----------
  const ac = { el: null, input: null, i: -1, wh: '', items: [], hi: 0, stock: null };

  // Chiqim va ko'chirishda faqat o'sha skladda bor tovarlar tanlanadi
  function onlyInStock() { return form.type === 'chiqim' || form.type === 'kochirish'; }

  function acOpen(input) {
    if (!ac.el) {
      ac.el = document.createElement('div');
      ac.el.className = 'ac-list';
      ac.el.hidden = true;
      document.body.appendChild(ac.el);
      ac.el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const o = e.target.closest('[data-n]');
        if (o) acPick(+o.dataset.n);
      });
    }
    ac.input = input;
    ac.i = +input.closest('tr').dataset.i;
    ac.stock = C.computeStock(db, { excludeDocId: form.editingId });
    acRefresh();
  }

  function acRefresh() {
    if (!ac.input) return;
    const l = form.lines[ac.i];
    ac.wh = l ? lineWh(l) : '';
    const raw = ac.input.value.trim();
    const q = C.normName(raw);
    const toks = tokens(raw);
    const stockOf = (p) => (ac.wh ? C.getStock(ac.stock, ac.wh, p.id) : { rolls: 0, metr: 0 });
    const inWh = (p) => stockOf(p).metr;
    const found = db.products.filter((p) => !p.archived && (!toks.length || matches(p.name, toks)));
    const list = onlyInStock() ? found.filter((p) => inWh(p) > 0.004) : found;
    list.sort((a, b) => {
      const as = q && C.normName(a.name).startsWith(q) ? 0 : 1;
      const bs = q && C.normName(b.name).startsWith(q) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name, 'uz');
    });
    ac.items = list.slice(0, 50).map((p) => ({ p }));
    if (!onlyInStock() && q && !db.products.some((p) => C.normName(p.name) === q)) ac.items.push({ create: raw });
    const sel = l && l.productId ? ac.items.findIndex((x) => x.p && x.p.id === l.productId) : -1;
    ac.hi = sel >= 0 ? sel : 0;
    let empty = 'Tovar yo\'q. Ma\'lumotnomadan qo\'shing.';
    if (!ac.wh) empty = 'Avval skladni tanlang';
    else if (onlyInStock()) {
      // Boshqa skladlarda bormi — faqat ma'lumot uchun, tanlab bo'lmaydi
      const elsewhere = db.warehouses.filter((w) => w.id !== ac.wh && found.some((p) => C.getStock(ac.stock, w.id, p.id).metr > 0.004));
      empty = `«${esc(whName(ac.wh))}» skladida ${toks.length ? 'bunday tovar' : 'tovar'} yo'q` +
        (elsewhere.length ? `<br><span class="muted">Bor skladlar: ${elsewhere.map((w) => esc(w.name)).join(', ')}</span>` : '');
    }
    ac.el.innerHTML = ac.items.length ? ac.items.map((it, n) => {
      if (it.create !== undefined) return `<div class="ac-opt create${n === ac.hi ? ' hi' : ''}" data-n="${n}">+ Yangi tovar qo'shish: «${esc(it.create)}»</div>`;
      const s = stockOf(it.p);
      return `<div class="ac-opt${n === ac.hi ? ' hi' : ''}" data-n="${n}"><span>${esc(it.p.name)}</span><span class="${s.metr > 0 ? 'muted' : 'zero'}">${C.fmtNum(s.rolls)} r · ${C.fmtNum(s.metr)} m</span></div>`;
    }).join('') : `<div class="ac-empty">${empty}</div>`;
    const r = ac.input.getBoundingClientRect();
    ac.el.style.left = (r.left + window.scrollX) + 'px';
    ac.el.style.top = (r.bottom + window.scrollY + 2) + 'px';
    ac.el.style.minWidth = Math.max(r.width, 340) + 'px';
    ac.el.hidden = false;
  }

  function acClose() {
    if (ac.el) ac.el.hidden = true;
    ac.input = null;
  }

  function acMove(d) {
    if (!ac.items.length) return;
    ac.hi = (ac.hi + d + ac.items.length) % ac.items.length;
    $$('.ac-opt', ac.el).forEach((o, n) => o.classList.toggle('hi', n === ac.hi));
    const hi = $('.ac-opt.hi', ac.el);
    if (hi) hi.scrollIntoView({ block: 'nearest' });
  }

  async function acPick(n) {
    const it = ac.items[n];
    const i = ac.i;
    const input = ac.input;
    acClose();
    if (!it) return;
    let p = it.p;
    if (it.create !== undefined) {
      p = await productModal(null, it.create);
      if (!p) { if (input) input.focus(); return; }
    }
    applyProduct(i, p);
    focusLine(i, 'rolls');
  }

  window.addEventListener('resize', acClose);
  document.addEventListener('scroll', (e) => { if (ac.el && e.target !== ac.el) acClose(); }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') && currentRoute === 'yangi' && !$('.modal-wrap')) {
      e.preventDefault();
      saveForm();
    }
  });

  // ---------- Hujjatni ko'rish ----------
  function docItemsTable(doc) {
    const tz = doc.type === 'tuzatish';
    const showMoney = hasMoney(doc.type);
    const tot = C.docTotals(doc);
    if (tz) {
      return `<div class="table-wrap"><table class="grid"><thead><tr><th>Tovar</th><th class="num">Hisobda edi</th><th class="num">Sanaldi</th><th class="num">Farq</th></tr></thead><tbody>
        ${doc.items.map((it) => {
          const cr = C.r2(C.num(it.counted.rolls) + C.num(it.counted.lintoRolls));
          const sg = (x) => (x > 0 ? '+' : '') + C.fmtNum(x);
          return `<tr><td>${esc(prodName(it.productId))}</td><td class="num">${stockHtml(it.before)}</td><td class="num">${stockHtml({ rolls: cr, metr: it.counted.metr })}</td>
          <td class="num ${it.metr > 0 ? 'pos' : it.metr < 0 ? 'neg' : ''}">${sg(it.rolls)} r <span class="sub">· ${sg(it.metr)} m</span></td></tr>`;
        }).join('')}
        </tbody><tfoot><tr><td class="strong">Jami farq</td><td></td><td></td><td class="num strong">${C.fmtNum(tot.rolls)} r · ${C.fmtNum(tot.metr)} m</td></tr></tfoot></table></div>`;
    }
    const perLine = isPerLine(doc.type);
    return `<div class="table-wrap"><table class="grid"><thead><tr>${perLine ? '<th>Sklad</th>' : ''}<th>Tovar</th><th class="num">Rulon</th><th class="num">1 rulon, m</th><th class="num">Linto, m</th><th class="num">Jami metr</th>
      ${showMoney ? `<th class="num">Narx</th><th class="num">Summa</th>` : ''}</tr></thead><tbody>
      ${doc.items.map((it) => `<tr>${perLine ? `<td>${esc(whName(C.itemWh(doc, it)))}</td>` : ''}<td>${esc(prodName(it.productId))}</td><td class="num">${rollsCell(it)}</td><td class="num">${C.fmtNum(it.rollM)}</td>
        <td class="num">${lintoCell(it)}</td><td class="num strong">${C.fmtNum(it.metr)}</td>
        ${showMoney ? `<td class="num">${C.fmtNum(it.price, 4)}</td><td class="num">${money(it.sum)}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot><tr>${perLine ? '<td></td>' : ''}<td class="strong">Jami</td><td class="num strong">${C.fmtNum(tot.rolls)}</td><td></td><td></td><td class="num strong">${C.fmtNum(tot.metr)}</td>
      ${showMoney ? `<td></td><td class="num strong">${money(tot.sum)}</td>` : ''}</tr></tfoot></table></div>`;
  }

  function openDocModal(doc) {
    if (!doc) return;
    const old = doc.editedFrom ? find(db.docs, doc.editedFrom) : null;
    const meta = [
      ['Sana', C.fmtDate(doc.date)],
      ['Turi', typeBadge(doc.type), true],
      [doc.type === 'kochirish' ? 'Qaysi skladdan' : (C.docWarehouses(doc).length > 1 ? 'Skladlar' : 'Sklad'), docWhNames(doc)],
    ];
    if (doc.type === 'kochirish') meta.push(['Qaysi skladga', whName(doc.toWarehouseId)]);
    if (doc.personId) meta.push([doc.type === 'qaytish' ? "Qaytargan do'kon" : "Do'kon", personName(doc.personId)]);
    if (doc.note) meta.push(['Izoh', doc.note]);
    const body = `
      <div class="doc-meta">${meta.map(([k, v, raw]) => `<div><span class="muted">${k}</span><b>${raw ? v : esc(v)}</b></div>`).join('')}</div>
      ${doc.cancelled ? `<div class="msg err">Bekor qilingan (${C.fmtDate(doc.cancelled.at.slice(0, 10))}): ${esc(doc.cancelled.reason)}</div>` : ''}
      ${old ? `<p class="muted small">№${old.no} ning tahrirlangan nusxasi</p>` : ''}
      ${docItemsTable(doc)}`;
    const buttons = [{ label: 'Chop etish', kind: 'ghost', onClick: () => printDoc(doc) }];
    if (!doc.cancelled) {
      buttons.push({ label: 'Bekor qilish', kind: 'danger-ghost', onClick: (close) => cancelDocFlow(doc, close) });
      buttons.push({ label: 'Tahrirlash', kind: '', onClick: (close) => { close(); startEdit(doc); } });
    }
    buttons.push({ label: 'Yopish', kind: 'primary' });
    openModal({ title: `${C.TYPES[doc.type].label} №${doc.no}`, body, buttons, wide: true });
  }

  function cancelDocFlow(doc, closeParent) {
    openModal({
      title: `№${doc.no} ni bekor qilish`,
      body: `<p>Hujjat o'chib ketmaydi: jurnalda «bekor qilingan» bo'lib qoladi va qoldiqqa ta'sir qilmaydi.</p>
        <label class="f">Sabab<input id="c-reason" placeholder="masalan: xato kiritilgan"></label><div id="c-err"></div>`,
      focus: '#c-reason',
      enterButton: 1,
      buttons: [
        { label: 'Orqaga', kind: 'ghost' },
        {
          label: 'Bekor qilish', kind: 'danger', onClick: (close, el) => {
            const reason = $('#c-reason', el).value.trim();
            if (!reason) { $('#c-err', el).innerHTML = '<div class="msg err">Sababini yozing</div>'; return; }
            // Kirim bekor qilinsa, undan chiqarilgan tovar qoldig'i minusga tushmasin
            const problems = C.stockProblems(db, null, doc.id);
            if (problems.length) {
              $('#c-err', el).innerHTML = `<div class="msg err"><b>Bekor qilib bo'lmaydi</b> — qoldiq minusga tushadi:<ul>${problems.map((pr) =>
                `<li>${esc(prodName(pr.productId))} («${esc(whName(pr.warehouseId))}»): ${C.fmtNum(pr.after.rolls)} rulon, ${C.fmtNum(pr.after.metr)} m</li>`).join('')}</ul>
                Avval shu tovardan qilingan chiqimlarni bekor qiling.</div>`;
              return;
            }
            doc.cancelled = { at: new Date().toISOString(), reason };
            saveDb();
            close();
            closeParent();
            toast(`№${doc.no} bekor qilindi`);
            route();
          },
        },
      ],
    });
  }

  function printDoc(doc) {
    const meta = [`Sana: <b>${C.fmtDate(doc.date)}</b>`, `${doc.type === 'kochirish' ? 'Qaysi skladdan' : 'Sklad'}: <b>${esc(docWhNames(doc))}</b>`];
    if (doc.type === 'kochirish') meta.push(`Qaysi skladga: <b>${esc(whName(doc.toWarehouseId))}</b>`);
    if (doc.personId) meta.push(`${doc.type === 'qaytish' ? 'Qaytardi' : 'Oluvchi'}: <b>${esc(personName(doc.personId))}</b>`);
    $('#print-area').innerHTML = `<h1>${C.TYPES[doc.type].label} № ${doc.no}${doc.cancelled ? ' (BEKOR QILINGAN)' : ''}</h1>
      <p>${meta.join(' &nbsp;·&nbsp; ')}</p>${doc.note ? `<p>Izoh: ${esc(doc.note)}</p>` : ''}
      ${docItemsTable(doc)}
      <div class="sign"><span>Topshirdi: ____________________</span><span>Qabul qildi: ____________________</span></div>`;
    window.print();
  }

  // ---------- Jurnal ----------
  const jf = { from: '', to: '', type: '', wh: '', person: '', q: '', showCancelled: false };

  routes.jurnal = function renderJournal() {
    main.innerHTML = `
      <div class="page-head"><h1>Jurnal</h1><div class="head-actions"><button class="btn" id="j-export">Excelga yuklash</button></div></div>
      <div class="card fields">
        <label class="f">Sanadan<input type="date" id="j-from" value="${jf.from}"></label>
        <label class="f">Sanagacha<input type="date" id="j-to" value="${jf.to}"></label>
        <label class="f">Turi<select id="j-type"><option value="">Hammasi</option>${Object.keys(C.TYPES).map((k) => `<option value="${k}"${jf.type === k ? ' selected' : ''}>${C.TYPES[k].label}</option>`).join('')}</select></label>
        <label class="f">Sklad<select id="j-wh">${options(db.warehouses, jf.wh, 'Hammasi')}</select></label>
        <label class="f">Do'kon<select id="j-person">${options(sortByName(db.people), jf.person, 'Hammasi')}</select></label>
        <label class="f grow">Tovar<input id="j-q" value="${esc(jf.q)}" placeholder="nomi bo'yicha qidirish"></label>
        <label class="chk"><input type="checkbox" id="j-cancel"${jf.showCancelled ? ' checked' : ''}> Bekor qilinganlarni ko'rsatish</label>
      </div>
      <div id="j-result"></div>`;
    const bind = (id, key, ev, get) => { $(id).addEventListener(ev || 'change', (e) => { jf[key] = get ? get(e.target) : e.target.value; drawJournal(); }); };
    bind('#j-from', 'from'); bind('#j-to', 'to'); bind('#j-type', 'type'); bind('#j-wh', 'wh'); bind('#j-person', 'person');
    bind('#j-q', 'q', 'input');
    bind('#j-cancel', 'showCancelled', 'change', (el) => el.checked);
    $('#j-export').onclick = exportJournal;
    drawJournal();
  };

  function journalDocs() {
    const toks = tokens(jf.q);
    return db.docs.filter((d) =>
      (jf.showCancelled || !d.cancelled) &&
      (!jf.from || d.date >= jf.from) && (!jf.to || d.date <= jf.to) &&
      (!jf.type || d.type === jf.type) &&
      (!jf.wh || d.toWarehouseId === jf.wh || d.items.some((it) => C.itemWh(d, it) === jf.wh)) &&
      (!jf.person || d.personId === jf.person) &&
      (!toks.length || d.items.some((it) => matches(prodName(it.productId), toks))))
      .sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
  }

  function drawJournal() {
    const docs = journalDocs();
    const LIMIT = 300;
    const shown = docs.slice(0, LIMIT);
    $('#j-result').innerHTML = `<div class="card flush">
      <div class="card-title-row"><span class="muted">${docs.length} ta hujjat${docs.length > LIMIT ? `, birinchi ${LIMIT} tasi ko'rsatilgan — filtrni toraytiring` : ''}</span></div>
      ${docTableHtml(shown, 'Filtrga mos hujjat topilmadi')}</div>`;
    bindDocClicks($('#j-result'));
  }

  function exportJournal() {
    const rows = [];
    for (const d of journalDocs().slice().reverse()) {
      for (const it of d.items) {
        rows.push([d.no, C.fmtDate(d.date), C.TYPES[d.type].label, whName(C.itemWh(d, it)), docTarget(d), prodName(it.productId),
          C.itemRolls(it), it.rollM, it.linto || '', it.metr, hasMoney(d.type) ? it.price : '', hasMoney(d.type) ? it.sum : '', d.note || '',
          d.cancelled ? 'Bekor: ' + d.cancelled.reason : '']);
      }
    }
    downloadCSV(`jurnal-${C.today()}.csv`, ['№', 'Sana', 'Turi', 'Sklad', "Do'kon/qayerga", 'Tovar', 'Rulon', '1 rulon m', 'Linto', 'Jami metr', 'Narx', 'Summa', 'Izoh', 'Holat'], rows);
  }

  // ---------- Qoldiq ----------
  const sf = { wh: '', q: '', hideZero: true, archived: false };

  routes.qoldiq = function renderStock() {
    main.innerHTML = `
      <div class="page-head"><h1>Qoldiq / Tovarlar</h1><div class="head-actions">
        <button class="btn" id="s-inv">Inventarizatsiya</button><button class="btn" id="s-export">Excelga yuklash</button>
        <button class="btn primary" id="s-add">+ Yangi tovar</button></div></div>
      <div class="card fields">
        <label class="f">Sklad<select id="s-wh">${options(db.warehouses, sf.wh, 'Hamma skladlar')}</select></label>
        <label class="f grow">Tovar<input id="s-q" value="${esc(sf.q)}" placeholder="nomi bo'yicha qidirish"></label>
        <label class="chk"><input type="checkbox" id="s-zero"${sf.hideZero ? ' checked' : ''}> Qoldig'i yo'qlarni yashirish</label>
        <label class="chk"><input type="checkbox" id="s-arch"${sf.archived ? ' checked' : ''}> Arxivdagilarni ko'rsatish</label>
      </div>
      <div id="s-result"></div>`;
    $('#s-wh').onchange = (e) => { sf.wh = e.target.value; drawStock(); };
    $('#s-q').oninput = (e) => { sf.q = e.target.value; drawStock(); };
    $('#s-zero').onchange = (e) => { sf.hideZero = e.target.checked; drawStock(); };
    $('#s-arch').onchange = (e) => { sf.archived = e.target.checked; drawStock(); };
    $('#s-export').onclick = exportStock;
    $('#s-inv').onclick = () => startNew('tuzatish', sf.wh ? { warehouseId: sf.wh } : {});
    $('#s-add').onclick = async () => { await productModal(null, sf.q); drawStock(); };
    drawStock();
  };

  function stockRows() {
    const stock = C.computeStock(db);
    const whs = sf.wh ? [find(db.warehouses, sf.wh)] : db.warehouses.filter((w) => !w.archived);
    const toks = tokens(sf.q);
    const rows = [];
    for (const p of sortByName(db.products)) {
      if (!sf.archived && p.archived) continue;
      if (toks.length && !matches(p.name, toks)) continue;
      const per = whs.map((w) => C.getStock(stock, w.id, p.id));
      const metr = C.r2(per.reduce((a, s) => a + s.metr, 0));
      const rolls = C.r2(per.reduce((a, s) => a + s.rolls, 0));
      if (sf.hideZero && per.every((s) => Math.abs(s.metr) < 0.005)) continue;
      rows.push({ p, per, metr, rolls, value: C.r2(metr * (p.cost || 0)) });
    }
    return { whs, rows };
  }

  function drawStock() {
    const { whs, rows } = stockRows();
    const single = !!sf.wh;
    let tm = 0, tv = 0, tr = 0;
    rows.forEach((r) => { tm += r.metr; tv += r.value; tr += r.rolls; });
    const neg = (x) => (x < -0.004 ? ' neg' : '');
    const nameCell = (p) => `<td>${esc(p.name)}${p.archived ? ' <span class="badge">arxiv</span>' : ''}</td>`;
    const rowCls = (p) => `click${p.archived ? ' cancelled' : ''}`;
    const priceCell = (p) => `<td class="num">${p.price ? C.fmtNum(p.price, 4) : '<span class="warn-text">—</span>'}</td>`;
    const head = single
      ? `<th>Tovar</th><th class="num">Rulon</th><th class="num">Metr</th><th class="num">Tushgan narx</th><th class="num">Sotish narxi</th><th class="num">Summa</th>`
      : `<th>Tovar</th>${whs.map((w) => `<th class="num">${esc(w.name)}</th>`).join('')}<th class="num">Jami</th><th class="num">Summa</th>`;
    const cell = (s) => (Math.abs(s.metr) < 0.005 ? '<span class="zero">—</span>' : stockHtml(s));
    const body = rows.map((r) => single
      ? `<tr class="${rowCls(r.p)}" data-p="${r.p.id}">${nameCell(r.p)}<td class="num strong${neg(r.metr)}">${C.fmtNum(r.rolls)}</td><td class="num${neg(r.metr)}">${C.fmtNum(r.metr)}</td><td class="num">${C.fmtNum(r.p.cost || 0, 4)}</td>${priceCell(r.p)}<td class="num">${money(r.value)}</td></tr>`
      : `<tr class="${rowCls(r.p)}" data-p="${r.p.id}">${nameCell(r.p)}${r.per.map((s) => `<td class="num nowrap${neg(s.metr)}">${cell(s)}</td>`).join('')}<td class="num nowrap${neg(r.metr)}">${stockHtml(r)}</td><td class="num">${money(r.value)}</td></tr>`).join('');
    const sumOf = (n) => ({ rolls: C.r2(rows.reduce((a, r) => a + r.per[n].rolls, 0)), metr: C.r2(rows.reduce((a, r) => a + r.per[n].metr, 0)) });
    const foot = single
      ? `<td class="strong">Jami (${rows.length} xil)</td><td class="num strong">${C.fmtNum(tr)}</td><td class="num strong">${C.fmtNum(tm)}</td><td></td><td></td><td class="num strong">${money(tv)}</td>`
      : `<td class="strong">Jami (${rows.length} xil)</td>${whs.map((w, n) => `<td class="num nowrap">${stockHtml(sumOf(n))}</td>`).join('')}<td class="num nowrap">${stockHtml({ rolls: C.r2(tr), metr: C.r2(tm) })}</td><td class="num strong">${money(tv)}</td>`;
    const noPrice = rows.filter((r) => !r.p.price).length;
    const info = `<div class="card-title-row"><span class="muted">${rows.length} ta tovar${noPrice ? ` · <span class="warn-text">${noPrice} tasida sotish narxi yo'q</span>` : ''}</span></div>`;
    $('#s-result').innerHTML = rows.length
      ? `<div class="card flush">${info}<div class="table-wrap tall"><table class="grid sticky"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table></div></div>`
      : '<div class="card"><div class="empty">Tovar topilmadi</div></div>';
    $$('#s-result tr[data-p]').forEach((tr) => { tr.onclick = () => productHistoryModal(find(db.products, tr.dataset.p)); });
  }

  function exportStock() {
    const { whs, rows } = stockRows();
    const header = sf.wh ? ['Tovar', 'Rulon', 'Metr', 'Tushgan narx', 'Sotish narxi', 'Summa']
      : ['Tovar'].concat(...whs.map((w) => [`${w.name} rulon`, `${w.name} m`]), ['Jami rulon', 'Jami metr', 'Summa']);
    const data = rows.map((r) => (sf.wh ? [r.p.name, r.rolls, r.metr, r.p.cost || 0, r.p.price || 0, r.value]
      : [r.p.name].concat(...r.per.map((s) => [s.rolls, s.metr]), [r.rolls, r.metr, r.value])));
    downloadCSV(`qoldiq-${sf.wh ? whName(sf.wh) + '-' : ''}${C.today()}.csv`, header, data);
  }

  function productHistoryModal(p) {
    const stock = C.computeStock(db);
    const hist = C.productHistory(db, p.id).reverse();
    const per = db.warehouses.map((w) => ({ w, s: C.getStock(stock, w.id, p.id) })).filter((x) => Math.abs(x.s.metr) >= 0.005);
    const body = `
      <div class="doc-meta">${per.length ? per.map((x) => `<div><span class="muted">${esc(x.w.name)}</span><b>${C.fmtNum(x.s.rolls)} rulon · ${C.fmtNum(x.s.metr)} m</b></div>`).join('') : '<div><span class="muted">Qoldiq</span><b>0 rulon</b></div>'}</div>
      ${hist.length ? `<div class="table-wrap tall"><table class="grid"><thead><tr><th>Sana</th><th class="num">№</th><th>Turi</th><th>Sklad</th><th>Do'kon / qayerga</th><th class="num">Rulon</th><th class="num">Metr</th></tr></thead><tbody>
        ${hist.map((h) => `<tr class="click" data-doc="${h.doc.id}"><td class="nowrap">${C.fmtDate(h.doc.date)}</td><td class="num muted">${h.doc.no}</td><td>${typeBadge(h.doc.type)}</td>
          <td>${esc(whName(h.warehouseId))}</td><td>${esc(docTarget(h.doc))}</td><td class="num">${h.rolls > 0 ? '+' : ''}${C.fmtNum(h.rolls)}</td>
          <td class="num strong ${h.metr > 0 ? 'pos' : 'neg'}">${h.metr > 0 ? '+' : ''}${C.fmtNum(h.metr)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Harakat yo\'q</div>'}`;
    const m = openModal({ title: p.name, body, wide: true, buttons: [
      { label: 'Tovarni tahrirlash', kind: 'ghost', onClick: async (close) => { close(); await productModal(p); route(); } },
      { label: 'Yopish', kind: 'primary' },
    ] });
    $$('tr[data-doc]', m.el).forEach((tr) => { tr.onclick = () => openDocModal(find(db.docs, tr.dataset.doc)); });
  }

  // Skladdagi bitta tovar bo'yicha: shu skladdan kimga / qachon / qancha chiqqani
  function whProductHistoryModal(p, whId) {
    const stock = C.computeStock(db);
    const st = C.getStock(stock, whId, p.id);
    const hist = C.productHistory(db, p.id).filter((h) => h.warehouseId === whId).reverse();
    let outRolls = 0, outMetr = 0;
    for (const h of hist) { if (h.metr < 0) { outRolls += -h.rolls; outMetr += -h.metr; } }
    const body = `
      <div class="doc-meta">
        <div><span class="muted">${esc(whName(whId))} — qoldiq</span><b>${C.fmtNum(st.rolls)} rulon · ${C.fmtNum(st.metr)} m</b></div>
        <div><span class="muted">Jami chiqqan</span><b>${C.fmtNum(outRolls)} rulon · ${C.fmtNum(outMetr)} m</b></div>
      </div>
      ${hist.length ? `<div class="table-wrap tall"><table class="grid"><thead><tr><th>Turi</th><th>Sana</th><th>Do'kon / qayerga</th><th class="num">Rulon</th><th class="num">Metr</th></tr></thead><tbody>
        ${hist.map((h) => `<tr class="click" data-doc="${h.doc.id}"><td>${typeBadge(h.doc.type)}</td><td class="nowrap">${C.fmtDate(h.doc.date)}</td>
          <td>${esc(docTarget(h.doc)) || '<span class="muted">—</span>'}</td><td class="num">${h.rolls > 0 ? '+' : ''}${C.fmtNum(h.rolls)}</td>
          <td class="num strong ${h.metr > 0 ? 'pos' : 'neg'}">${h.metr > 0 ? '+' : ''}${C.fmtNum(h.metr)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Bu skladda bu tovar bo\'yicha harakat yo\'q</div>'}`;
    const m = openModal({ title: `${p.name} — ${whName(whId)}`, body, wide: true, buttons: [
      { label: 'Barcha skladlar', kind: 'ghost', onClick: (close) => { close(); productHistoryModal(p); } },
      { label: 'Yopish', kind: 'primary' },
    ] });
    $$('tr[data-doc]', m.el).forEach((tr) => { tr.onclick = () => openDocModal(find(db.docs, tr.dataset.doc)); });
  }

  // ---------- Skladlar ----------
  const wf = { wh: '', q: '', hideZero: true, showArchived: false };

  routes.skladlar = function renderWarehouses() {
    const all = db.warehouses;
    const archivedCount = all.filter((w) => w.archived).length;
    const list = all.filter((w) => wf.showArchived || !w.archived);
    if (!list.some((w) => w.id === wf.wh)) wf.wh = list.length ? list[0].id : '';
    const stock = C.computeStock(db);
    const chips = list.map((w) => {
      let rolls = 0, metr = 0;
      for (const p of db.products) { const st = C.getStock(stock, w.id, p.id); rolls += st.rolls; metr += st.metr; }
      return `<button class="shop${w.id === wf.wh ? ' on' : ''}${w.archived ? ' archived' : ''}" data-wh="${w.id}">
        <b>${esc(w.name)}</b><span>${C.fmtNum(rolls, 0)} rulon · ${C.fmtNum(metr, 0)} m</span></button>`;
    }).join('');
    main.innerHTML = `
      <div class="page-head"><h1>Skladlar</h1><div class="head-actions">
        ${archivedCount ? `<label class="chk"><input type="checkbox" id="w-arch"${wf.showArchived ? ' checked' : ''}> Arxivdagilar (${archivedCount})</label>` : ''}
        <button class="btn primary" id="w-add">+ Yangi sklad</button></div></div>
      ${list.length ? `<div class="shops">${chips}</div>` : '<div class="card"><div class="empty">Hali sklad qo\'shilmagan — «+ Yangi sklad» tugmasini bosing.</div></div>'}
      <div id="w-body"></div>`;
    $('#w-add').onclick = async () => {
      const w = await entityModal('wh', null);
      if (w) { wf.wh = w.id; wf.q = ''; routes.skladlar(); }
    };
    if ($('#w-arch')) $('#w-arch').onchange = (e) => { wf.showArchived = e.target.checked; routes.skladlar(); };
    $$('[data-wh]', main).forEach((b) => { b.onclick = () => { if (wf.wh !== b.dataset.wh) wf.q = ''; wf.wh = b.dataset.wh; routes.skladlar(); }; });
    if (wf.wh) drawWarehouse();
  };

  // Sentr.numbers dagidek: Nomi, Rulon, Metr (1 rulon), Obshi metr, Narx, Summa. Tartib — tovar qo'shilgan tartibda
  function warehouseRows(whId) {
    const stock = C.computeStock(db);
    const toks = tokens(wf.q);
    const rows = [];
    for (const p of db.products) {
      if (toks.length && !matches(p.name, toks)) continue;
      const st = C.getStock(stock, whId, p.id);
      // Faqat shu skladda haqiqiy qoldig'i bor tovarlar (rulon yoki metr) — bo'shlari ko'rinmaydi
      if (Math.abs(st.metr) < 0.005 && Math.abs(st.rolls) < 0.005) continue;
      // Qiymat = hujjatlardagi haqiqiy summalar yig'indisi (fayldagidek), narx×metr emas
      rows.push({ p, rolls: st.rolls, metr: st.metr, value: C.r2(st.sum != null ? st.sum : st.metr * (p.cost || 0)) });
    }
    return rows;
  }

  function warehouseSheetHtml(rows) {
    let tr = 0, tm = 0, tv = 0;
    const neg = (x) => (x < -0.004 ? ' neg' : '');
    const body = rows.map((r, n) => {
      tr += r.rolls; tm += r.metr; tv += r.value;
      const ttl = ' title="Bosib o\'zgartirish"';
      return `<tr class="click" data-p="${r.p.id}"><td class="num muted">${n + 1}</td><td>${esc(r.p.name)}</td>
        <td class="num strong editable${neg(r.rolls)}" data-p="${r.p.id}" data-k="rolls"${ttl}>${C.fmtNum(r.rolls)}</td>
        <td class="num editable" data-p="${r.p.id}" data-k="rollM"${ttl}>${C.fmtNum(r.p.rollM || 0)}</td>
        <td class="num${neg(r.metr)}">${C.fmtNum(r.metr)}</td>
        <td class="num editable" data-p="${r.p.id}" data-k="cost"${ttl}>${r.p.cost ? C.fmtNum(r.p.cost, 4) : '<span class="zero">—</span>'}</td>
        <td class="num">${money(r.value)}</td></tr>`;
    }).join('');
    return `<table class="grid sheet sticky">
      <thead><tr><th class="num">№</th><th>Nomi</th><th class="num">Rulon</th><th class="num">Metr</th><th class="num">Obshi metr</th><th class="num">Narx</th><th class="num">Summa</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td></td><td class="strong">Jami (${rows.length} xil)</td><td class="num strong">${C.fmtNum(tr)}</td><td></td><td class="num strong">${C.fmtNum(tm)}</td><td></td><td class="num strong">${money(tv)}</td></tr></tfoot></table>`;
  }

  // Jadval yozuvi o'lchami (A− / A+), shu qurilmada eslab qolinadi
  const FONT_KEY = 'sklad-sheet-font';
  function sheetFont() {
    try { const v = +localStorage.getItem(FONT_KEY); if (v >= 11 && v <= 28) return v; } catch (e) { /* standart o'lcham */ }
    return 15;
  }
  function setSheetFont(v) {
    try { localStorage.setItem(FONT_KEY, String(v)); } catch (e) { /* e'tiborsiz */ }
  }

  // To'liq ekran: jadval kartasi butun ekranni egallaydi; brauzer ruxsat bersa, brauzer panellari ham yashirinadi
  function enterSheetFullscreen(card) {
    card.classList.add('fs');
    document.body.classList.add('fs-open');
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => { /* ruxsat bo'lmasa oddiy kattalashtirish qoladi */ });
    updateFsButton(card);
  }
  function exitSheetFullscreen() {
    const card = $('.sheet-card.fs');
    if (card) card.classList.remove('fs');
    document.body.classList.remove('fs-open');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (card) updateFsButton(card);
  }
  function updateFsButton(card) {
    const btn = $('[data-fs]', card);
    if (btn) btn.innerHTML = card.classList.contains('fs') ? '✕ Chiqish' : '⛶ To\'liq ekran';
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('.sheet-card.fs')) exitSheetFullscreen(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.sheet-card.fs') && !$('.modal-wrap')) exitSheetFullscreen(); });

  function drawWarehouse() {
    const w = find(db.warehouses, wf.wh);
    $('#w-body').innerHTML = `
      <section class="card flush sheet-card" id="w-card" style="--sheet-font:${sheetFont()}px">
        <div class="sheet-bar">
          <input id="w-q" class="sheet-search" value="${esc(wf.q)}" placeholder="Tovar qidirish…">
          <span class="grow"></span>
          <button class="btn sm" data-font="-1" title="Kichikroq yozuv">A−</button>
          <button class="btn sm" data-font="1" title="Kattaroq yozuv">A+</button>
          <button class="btn sm" id="w-edit">Tahrirlash</button>
          <label class="btn sm" id="w-import-wrap" title="Fayldan (JSON) qoldiq yuklash — kirim qilinadi">Fayldan yuklash<input type="file" id="w-import" accept=".json,application/json" hidden></label>
          <button class="btn sm primary" data-fs title="To'liq ekran (chiqish: Esc)">⛶ To'liq ekran</button>
        </div>
        <div id="w-sheet" class="sheet-body"></div>
      </section>`;
    const card = $('#w-card');
    const draw = () => {
      const rows = warehouseRows(w.id);
      $('#w-sheet').innerHTML = rows.length
        ? `<div class="table-wrap big">${warehouseSheetHtml(rows)}</div>`
        : `<div class="empty">${wf.q ? 'Tovar topilmadi' : 'Bu skladda hozircha tovar yo\'q — «+ Kirim» yoki «Inventarizatsiya» orqali kiriting.'}</div>`;
      $$('#w-sheet tr[data-p]').forEach((tr) => { tr.onclick = () => whProductHistoryModal(find(db.products, tr.dataset.p), w.id); });
      $$('#w-sheet td.editable').forEach((td) => { td.onclick = (e) => { e.stopPropagation(); beginWhCellEdit(td, w.id, draw); }; });
    };
    $('#w-q').oninput = (e) => { wf.q = e.target.value; draw(); };
    $$('[data-font]', card).forEach((b) => {
      b.onclick = () => {
        const v = Math.min(28, Math.max(11, sheetFont() + (+b.dataset.font)));
        setSheetFont(v);
        card.style.setProperty('--sheet-font', v + 'px');
      };
    });
    $('[data-fs]', card).onclick = () => (card.classList.contains('fs') ? exitSheetFullscreen() : enterSheetFullscreen(card));
    $('#w-edit').onclick = async () => { await entityModal('wh', w); routes.skladlar(); };
    if ($('#w-import')) $('#w-import').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importToWarehouse(w, f); };
    draw();
  }

  // Skladga fayldan qoldiq yuklash — bitta "kirim" hujjati (qoldiqqa qo'shiladi, jurnaldan qaytarsa bo'ladi)
  function importToWarehouse(w, file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      const rows = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : null);
      if (!rows || !rows.length) { toast('Bu fayl mos emas yoki bo\'sh'); return; }
      const ok = await confirmModal('Skladga yuklash',
        `<p><b>${esc(w.name)}</b> skladiga <b>${rows.length}</b> ta tovar <b>kirim</b> qilinadi (qoldiqqa qo'shiladi).</p>
         <p class="muted small">Yangi tovarlar avtomatik yaratiladi. Kerak bo'lsa keyin jurnaldan shu kirimni ortga qaytarsa bo'ladi.</p>`, 'Yuklash');
      if (!ok) return;
      const created = { n: 0 };
      const items = rows.map((r) => {
        const pr = ensureProduct(r.name, r.price, r.rollM, created);
        // Sklad qoldig'i uchun shu fayldagi narx (tushgan narx) ustun bo'lsin — qiymat to'g'ri chiqsin
        if (r.price != null && String(r.price).trim() !== '') pr.cost = C.num(r.price) || 0;
        if ((!pr.rollM || pr.rollM === 0) && C.num(r.rollM)) pr.rollM = C.num(r.rollM);
        const rolls = C.num(r.rolls) || 0;
        const rollM = C.num(r.rollM) || 0;
        const linto = (r.linto == null || r.linto === '') ? '' : (C.num(r.linto) || 0);
        const metr = (r.metr == null || r.metr === '') ? C.r2(rolls * rollM + (C.num(linto) || 0)) : (C.num(r.metr) || 0);
        const price = C.num(r.price) || 0;
        return { productId: pr.id, warehouseId: w.id, rolls, rollM, linto, metr, price, sum: (C.num(r.sum) != null && r.sum !== '') ? C.num(r.sum) : C.r2(metr * price) };
      });
      db.seq = (db.seq || 0) + 1;
      db.docs.push({ id: C.uid(), no: db.seq, type: 'kirim', date: C.today(), warehouseId: w.id, note: 'Fayldan yuklandi (qoldiq)', items, createdAt: new Date().toISOString() });
      saveDb();
      toast(`${items.length} ta tovar kirim qilindi${created.n ? ` · ${created.n} yangi tovar` : ''}`);
      routes.skladlar();
    };
    reader.readAsText(file);
  }

  // Sklad jadvalida katakni bosib tahrirlash. Narx/1-rulon-m — to'g'ridan-to'g'ri tovarga;
  // Rulon/Obshi metr — inventarizatsiya (tuzatish) hujjati sifatida yoziladi (jurnaldan ortga qaytarsa bo'ladi).
  function beginWhCellEdit(td, whId, redraw) {
    if (td.querySelector('input')) return;
    const p = find(db.products, td.dataset.p);
    const k = td.dataset.k;
    if (!p) return;
    const st = C.getStock(C.computeStock(db), whId, p.id);
    const cur = k === 'rolls' ? st.rolls : k === 'metr' ? st.metr : k === 'rollM' ? (p.rollM || 0) : (p.cost || 0);
    td.innerHTML = `<input class="sheet-in" value="${esc(C.num(cur) ? String(cur) : '')}" inputmode="decimal">`;
    const input = td.querySelector('input');
    input.focus(); input.select();
    let handled = false;
    const finish = async (save) => {
      if (handled) return; handled = true;
      if (save) await applyWhCellEdit(whId, p, k, C.num(input.value), st);
      redraw();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.onblur = null; finish(false); }
    };
    input.onblur = () => finish(true);
  }

  async function applyWhCellEdit(whId, p, k, val, st) {
    if (k === 'cost') { if ((p.cost || 0) !== val) { p.cost = val || 0; saveDb(); toast('Narx saqlandi'); } return; }
    if (k === 'rollM') { if ((p.rollM || 0) !== val) { p.rollM = val || 0; saveDb(); toast('Saqlandi'); } return; }
    // Rulon — joriy qoldiqni shu songa tenglaydigan inventarizatsiya yoziladi. Obshi metr o'zi hisoblanadi.
    const targetR = val;
    const targetM = C.r2(val * (p.rollM || 0));
    if (Math.abs(targetR - st.rolls) < 0.0001) return;
    const ok = await confirmModal('Qoldiqni o\'zgartirish',
      `<p>«${esc(p.name)}» — «${esc(whName(whId))}» skladida qoldiq <b>${C.fmtNum(st.rolls)} rulon</b> dan <b>${C.fmtNum(targetR)} rulon</b> (${C.fmtNum(targetM)} m) ga o'zgaradi.</p>
       <p class="muted small">Inventarizatsiya hujjati yoziladi — Jurnaldan ortga qaytarsa bo'ladi.</p><p>Tasdiqlaysizmi?</p>`,
      'Ha, saqlash');
    if (!ok) return;
    const it = {
      productId: p.id, warehouseId: whId, rollM: p.rollM || 0, linto: 0,
      before: { rolls: st.rolls, metr: st.metr },
      counted: { rolls: targetR, lintoRolls: 0, metr: targetM },
      rolls: C.r2(targetR - st.rolls), lintoRolls: 0, metr: C.r2(targetM - st.metr),
    };
    it.price = p.cost || 0; it.sum = C.lineSum(it);
    const doc = { id: C.uid(), no: ++db.seq, type: 'tuzatish', date: C.today(), warehouseId: whId,
      note: 'Qoldiq tahrirlandi (Skladlar)', items: [it], createdAt: new Date().toISOString() };
    db.docs.push(doc); saveDb(); toast('Qoldiq tahrirlandi');
  }

  // ---------- Do'konlar ----------
  const pf = { person: '', from: '', to: '', showArchived: false };

  // ---------- Do'kon to'lovlari (pul berishi) ----------
  function personPayments(personId, from, to) {
    return (db.payments || [])
      .filter((pm) => pm.personId === personId && (!from || pm.date >= from) && (!to || pm.date <= to))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  function personPaidUsd(personId, from, to) {
    return C.r2(personPayments(personId, from, to).reduce((a, pm) => a + (pm.usd || 0), 0));
  }

  // To'lov qo'shish / tahrirlash. So'mda bersa kurs bilan dollarga aylantiradi.
  function paymentModal(person, existing) {
    const isNew = !existing;
    const v = existing || { date: C.today(), som: '', kurs: '', usd: '', note: '', mode: 'som' };
    const mode0 = v.mode || (v.som ? 'som' : 'usd');
    const buttons = [{ label: 'Bekor', kind: 'ghost' }];
    if (!isNew) {
      buttons.unshift({ label: "O'chirish", kind: 'danger-ghost', onClick: async (close) => {
        if (!(await confirmDelete("To'lovni o'chirish", `<p>${C.fmtDate(v.date)} — ${esc(v.note || "to'lov")} o'chiriladi.</p>`))) return;
        db.payments = (db.payments || []).filter((x) => x.id !== existing.id);
        saveDb(); toast("O'chirildi"); close(); drawShop();
      } });
    }
    buttons.push({ label: 'Saqlash', kind: 'primary', onClick: (close, el) => {
      const date = $('#pm-date', el).value || C.today();
      const mode = $('input[name="pm-mode"]:checked', el).value;
      const note = $('#pm-note', el).value.trim();
      const err = $('#pm-err', el);
      let som = 0, kurs = 0, usd = 0;
      if (mode === 'som') {
        som = C.num($('#pm-som', el).value);
        kurs = C.num($('#pm-kurs', el).value);
        if (!som) { err.innerHTML = '<div class="msg err">So\'m summasini yozing</div>'; return; }
        if (!kurs) { err.innerHTML = '<div class="msg err">Kursni yozing</div>'; return; }
        usd = C.r2(som / kurs);
      } else {
        usd = C.num($('#pm-usd', el).value);
        if (!usd) { err.innerHTML = '<div class="msg err">Dollar summasini yozing</div>'; return; }
      }
      if (isNew) {
        (db.payments || (db.payments = [])).push({ id: C.uid(), personId: person.id, date, som, kurs, usd, note, mode, createdAt: new Date().toISOString() });
      } else {
        Object.assign(existing, { date, som, kurs, usd, note, mode });
      }
      saveDb(); toast(isNew ? "To'lov qo'shildi" : 'Saqlandi'); close(); drawShop();
    } });
    const m = openModal({
      title: isNew ? `${person.name} — pul berdi` : "To'lovni tahrirlash",
      focus: '#pm-som',
      buttons,
      body: `<div class="form-grid">
        <label class="f">Sana<input type="date" id="pm-date" value="${esc(v.date)}"></label>
        <div class="f">To'lov turi<span class="inline">
          <label class="chk"><input type="radio" name="pm-mode" value="som"${mode0 !== 'usd' ? ' checked' : ''}> So'mda</label>
          <label class="chk"><input type="radio" name="pm-mode" value="usd"${mode0 === 'usd' ? ' checked' : ''}> Dollarda</label></span></div>
        <div id="pm-som-box" class="span2"><div class="form-grid">
          <label class="f">So'm summasi<input id="pm-som" inputmode="decimal" value="${esc(str(v.som))}" placeholder="masalan 30 000 000"></label>
          <label class="f">Kurs (1$ necha so'm)<input id="pm-kurs" inputmode="decimal" value="${esc(str(v.kurs))}" placeholder="masalan 12 000"></label>
        </div><div class="pm-preview muted" id="pm-prev"></div></div>
        <label class="f span2" id="pm-usd-box" hidden>Dollar summasi<span class="money-field"><span class="cur in">$</span><input id="pm-usd" inputmode="decimal" value="${esc(str(v.usd))}"></span></label>
        <label class="f span2">Izoh<input id="pm-note" value="${esc(v.note || '')}" placeholder="masalan: doniyorga surdi / office da berdi"></label>
        </div><div id="pm-err"></div>`,
    });
    const el = m.el;
    const somBox = $('#pm-som-box', el), usdBox = $('#pm-usd-box', el), prev = $('#pm-prev', el);
    const refresh = () => {
      const mode = $('input[name="pm-mode"]:checked', el).value;
      somBox.hidden = mode !== 'som';
      usdBox.hidden = mode !== 'usd';
      if (mode === 'som') {
        const som = C.num($('#pm-som', el).value), kurs = C.num($('#pm-kurs', el).value);
        prev.innerHTML = som && kurs ? `= <b>$${C.fmtMoney(som / kurs)}</b>` : "So'm va kursni yozing — dollar avtomatik hisoblanadi";
      }
    };
    $$('input[name="pm-mode"]', el).forEach((r) => { r.onchange = refresh; });
    $('#pm-som', el).oninput = refresh;
    $('#pm-kurs', el).oninput = refresh;
    refresh();
  }

  function personTotals(lines) {
    const t = { outM: 0, outS: 0, retM: 0, retS: 0 };
    for (const { item, sign } of lines) {
      if (sign > 0) { t.outM += item.metr; t.outS += item.sum; } else { t.retM += item.metr; t.retS += item.sum; }
    }
    return t;
  }

  function rangeFor(kind) {
    const t = C.today();
    const y = +t.slice(0, 4), mo = +t.slice(5, 7);
    const pad = (n) => String(n).padStart(2, '0');
    if (kind === 'month') return { from: `${y}-${pad(mo)}-01`, to: '' };
    if (kind === 'prev') {
      const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${new Date(py, pm, 0).getDate()}` };
    }
    if (kind === 'year') return { from: `${y}-01-01`, to: '' };
    return { from: '', to: '' };
  }

  // ---------- Mijoz ro'yxati (narxsiz — mijozlarga ko'rsatish uchun) ----------
  const kf = { wh: '', q: '', hideZero: true };

  function klientRows(whId) {
    const stock = C.computeStock(db);
    const toks = tokens(kf.q);
    const rows = [];
    for (const p of db.products) {
      if (p.archived) continue;
      if (toks.length && !matches(p.name, toks)) continue;
      const st = C.getStock(stock, whId, p.id);
      if (kf.hideZero && Math.abs(st.metr) < 0.005) continue;
      rows.push({ p, rolls: st.rolls, metr: st.metr });
    }
    return rows;
  }

  function klientSheetHtml(rows) {
    let tr = 0, tm = 0;
    const neg = (x) => (x < -0.004 ? ' neg' : '');
    const body = rows.map((r, n) => {
      tr += r.rolls; tm += r.metr;
      return `<tr><td class="num muted">${n + 1}</td><td>${esc(r.p.name)}</td>
        <td class="num strong${neg(r.rolls)}">${C.fmtNum(r.rolls)}</td>
        <td class="num">${C.fmtNum(r.p.rollM || 0)}</td>
        <td class="num${neg(r.metr)}">${C.fmtNum(r.metr)}</td></tr>`;
    }).join('');
    return `<table class="grid sheet sticky">
      <thead><tr><th class="num">№</th><th>Nomi</th><th class="num">Rulon</th><th class="num">Metr</th><th class="num">Obshi metr</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td></td><td class="strong">Jami (${rows.length} xil)</td><td class="num strong">${C.fmtNum(tr)}</td><td></td><td class="num strong">${C.fmtNum(tm)}</td></tr></tfoot></table>`;
  }

  routes.klient = function renderKlient() {
    const list = db.warehouses.filter((w) => !w.archived);
    if (!list.some((w) => w.id === kf.wh)) kf.wh = list.length ? list[0].id : '';
    const stock = C.computeStock(db);
    const chips = list.map((w) => {
      let rolls = 0, metr = 0;
      for (const p of db.products) { const st = C.getStock(stock, w.id, p.id); rolls += st.rolls; metr += st.metr; }
      return `<button class="shop${w.id === kf.wh ? ' on' : ''}" data-kwh="${w.id}">
        <b>${esc(w.name)}</b><span>${C.fmtNum(rolls, 0)} rulon · ${C.fmtNum(metr, 0)} m</span></button>`;
    }).join('');
    main.innerHTML = `
      <div class="page-head"><h1>Mijoz ro'yxati</h1><div class="head-actions muted small">Narxsiz ro'yxat — mijozlarga ko'rsatish uchun</div></div>
      ${list.length ? `<div class="shops">${chips}</div>` : '<div class="card"><div class="empty">Hali sklad yo\'q.</div></div>'}
      <div id="k-body"></div>`;
    $$('[data-kwh]', main).forEach((b) => { b.onclick = () => { if (kf.wh !== b.dataset.kwh) kf.q = ''; kf.wh = b.dataset.kwh; routes.klient(); }; });
    if (kf.wh) drawKlient();
  };

  function drawKlient() {
    const w = find(db.warehouses, kf.wh);
    $('#k-body').innerHTML = `
      <section class="card flush sheet-card" id="k-card" style="--sheet-font:${sheetFont()}px">
        <div class="sheet-bar">
          <input id="k-q" class="sheet-search" value="${esc(kf.q)}" placeholder="Tovar qidirish…">
          <label class="chk"><input type="checkbox" id="k-zero"${kf.hideZero ? ' checked' : ''}> Qoldig'i yo'qlarni yashirish</label>
          <span class="grow"></span>
          <button class="btn sm" data-font="-1" title="Kichikroq yozuv">A−</button>
          <button class="btn sm" data-font="1" title="Kattaroq yozuv">A+</button>
          <button class="btn sm primary" data-fs title="To'liq ekran (chiqish: Esc)">⛶ To'liq ekran</button>
        </div>
        <div id="k-sheet" class="sheet-body"></div>
      </section>`;
    const card = $('#k-card');
    const draw = () => {
      const rows = klientRows(w.id);
      $('#k-sheet').innerHTML = rows.length
        ? `<div class="table-wrap big">${klientSheetHtml(rows)}</div>`
        : `<div class="empty">${kf.q ? 'Tovar topilmadi' : 'Bu skladda hozircha tovar yo\'q.'}</div>`;
    };
    $('#k-q').oninput = (e) => { kf.q = e.target.value; draw(); };
    $('#k-zero').onchange = (e) => { kf.hideZero = e.target.checked; draw(); };
    $$('[data-font]', card).forEach((b) => {
      b.onclick = () => {
        const v = Math.min(28, Math.max(11, sheetFont() + (+b.dataset.font)));
        setSheetFont(v); card.style.setProperty('--sheet-font', v + 'px');
      };
    });
    $('[data-fs]', card).onclick = () => (card.classList.contains('fs') ? exitSheetFullscreen() : enterSheetFullscreen(card));
    draw();
  }

  // ---------- Hisob-kitob (har kim o'zi olgan tovari + bergan puli + qarzi) ----------
  const hf = { person: '' };

  function personNet(id) {
    const t = personTotals(C.personLines(db, id, '', ''));
    const goods = C.r2(t.outS - t.retS);
    const paid = personPaidUsd(id, '', '');
    return { goods, paid, debt: C.r2(goods - paid), netM: C.r2(t.outM - t.retM) };
  }

  // Har bir odamning yashirin (hashlangan) tokeni — shaxsiy link uchun. Ismdan bilib bo'lmaydi.
  function personToken(p) {
    if (!p.token) {
      let t;
      do { t = (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(-14); }
      while (db.people.some((x) => x.token === t));
      p.token = t;
      saveDb();
    }
    return p.token;
  }
  function personLink(p) {
    return location.origin + location.pathname + '#/h/' + personToken(p);
  }
  async function copyPersonLink(p) {
    const url = personLink(p);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); toast('Shaxsiy link nusxalandi'); return; }
      throw new Error('no clipboard');
    } catch (e) {
      openModal({ title: `${p.name} — shaxsiy link`, body:
        `<p class="muted small">Linkni belgilab (tanlab) nusxalang va o'sha odamga yuboring:</p>
         <input id="lnk" class="sheet-search" style="width:100%" readonly value="${esc(url)}">`,
        focus: '#lnk', buttons: [{ label: 'Yopish', kind: 'primary' }] });
    }
  }

  function hisobGoodsTable(lines) {
    let tR = 0, tM = 0, tS = 0;
    const rows = lines.map(({ doc, item, sign }) => {
      tR += sign * C.itemRolls(item); tM += sign * item.metr; tS += sign * item.sum;
      return `<tr class="${sign < 0 ? 'ret' : ''}">
        <td class="nowrap">${C.fmtDate(doc.date)}</td><td>${esc(item.src || whName(C.itemWh(doc, item)))}</td>
        <td class="nm" title="${esc(prodName(item.productId))}">${esc(prodName(item.productId))}${sign < 0 ? ' <span class="neg strong">(qaytgan)</span>' : ''}</td>
        <td class="num">${C.fmtNum(sign * C.itemRolls(item))}</td><td class="num">${C.fmtNum(item.rollM)}</td>
        <td class="num">${C.fmtNum(sign * item.metr)}</td><td class="num">${C.fmtNum(item.price, 4)}</td>
        <td class="num strong${sign < 0 ? ' neg' : ''}">${money(sign * item.sum)}</td></tr>`;
    }).join('');
    return `<table class="grid"><thead><tr><th>Sana</th><th>Sklad</th><th>Nomi</th><th class="num">Rulon</th><th class="num">Metr</th><th class="num">Obshi metr</th><th class="num">Narx</th><th class="num">Summa</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">Tovar yo\'q</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" class="strong">Jami</td><td class="num strong">${C.fmtNum(tR)}</td><td></td><td class="num strong">${C.fmtNum(tM)}</td><td></td><td class="num strong">${money(tS)}</td></tr></tfoot></table>`;
  }

  function hisobMoneyTable(pays) {
    let tot = 0;
    const rows = pays.map((pm) => {
      tot += pm.usd || 0;
      return `<tr>
        <td class="nowrap">${C.fmtDate(pm.date)}</td>
        <td class="num">${pm.som ? C.fmtNum(pm.som, 0) : '<span class="muted">—</span>'}</td>
        <td class="num muted">${pm.kurs ? C.fmtNum(pm.kurs, 0) : '—'}</td>
        <td class="num strong">${money(pm.usd)}</td>
        <td class="izoh" title="${esc(pm.note || '')}">${esc(pm.note || '') || '<span class="muted">—</span>'}</td></tr>`;
    }).join('');
    return `<table class="grid"><thead><tr><th>Sana</th><th class="num">So'm</th><th class="num">Kurs</th><th class="num">$</th><th>Izoh</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">To\'lov yo\'q</td></tr>'}</tbody>
      <tfoot><tr><td class="strong">Jami</td><td></td><td></td><td class="num strong">${money(tot)}</td><td></td></tr></tfoot></table>`;
  }

  // 2 ta tugma: faqat bittasi (tovar yoki pul) ko'rinadi
  function hisobTabsHtml(goodsTable, moneyTable, goodsTotal, moneyTotal) {
    return `
      <div class="hisob-tabs">
        <button class="htab on" data-htab="goods"><span>Olgan tovarlar</span><b>${money(goodsTotal)}</b></button>
        <button class="htab" data-htab="money"><span>Bergan pullar</span><b>${money(moneyTotal)}</b></button>
      </div>
      <div class="hisob-panes" data-show="goods">
        <section class="card flush pane" data-pane="goods"><div class="table-wrap">${goodsTable}</div></section>
        <section class="card flush pane" data-pane="money"><div class="table-wrap">${moneyTable}</div></section>
      </div>`;
  }
  function wireHisobTabs(root) {
    const panes = root.querySelector('.hisob-panes');
    if (!panes) return;
    root.querySelectorAll('.htab').forEach((b) => {
      b.onclick = () => {
        panes.dataset.show = b.dataset.htab;
        root.querySelectorAll('.htab').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
  }

  routes.hisob = function renderHisob() {
    const shops = sortByName(db.people).filter((p) => !p.archived);
    if (hf.person && !shops.some((p) => p.id === hf.person)) hf.person = '';
    const chips = `<button class="shop${hf.person === '' ? ' on' : ''}" data-hp=""><b>Hammasi</b><span>umumiy qarzlar</span></button>` +
      shops.map((p) => {
        const n = personNet(p.id);
        const cls = n.debt > 0.005 ? 'neg' : (n.debt < -0.005 ? 'pos' : 'muted');
        return `<button class="shop${p.id === hf.person ? ' on' : ''}" data-hp="${p.id}">
          <b>${esc(p.name)}</b><span class="${cls}">${n.debt > 0.005 ? 'qarz ' : (n.debt < -0.005 ? 'haqdor ' : '')}${money(Math.abs(n.debt))}</span></button>`;
      }).join('');
    main.innerHTML = `
      <div class="page-head"><h1>Hisob-kitob</h1><div class="head-actions muted small">Har kim o'z olgan tovari, bergan puli va qarzini ko'radi</div></div>
      <div class="shops">${chips}</div>
      <div id="h-body"></div>`;
    $$('[data-hp]', main).forEach((b) => { b.onclick = () => { hf.person = b.dataset.hp; routes.hisob(); }; });
    drawHisob();
  };

  function drawHisob() {
    const body = $('#h-body');
    if (!hf.person) {
      const shops = sortByName(db.people).filter((p) => !p.archived);
      const rows = shops.map((p) => ({ p, n: personNet(p.id) }))
        .sort((a, b) => b.n.debt - a.n.debt);
      let tG = 0, tP = 0, tD = 0;
      const trs = rows.map(({ p, n }) => {
        tG += n.goods; tP += n.paid; tD += n.debt;
        const cls = n.debt > 0.005 ? 'neg strong' : (n.debt < -0.005 ? 'pos strong' : 'muted');
        return `<tr class="click" data-hp="${p.id}"><td>${esc(p.name)}</td>
          <td class="num">${money(n.goods)}</td><td class="num">${money(n.paid)}</td>
          <td class="num ${cls}">${money(n.debt)}</td>
          <td><button class="btn sm" data-link="${p.id}" title="Shaxsiy linkni nusxalash">🔗 Link</button></td></tr>`;
      }).join('');
      body.innerHTML = `<section class="card">
        <h2 class="card-title">Umumiy qarzlar — kim qancha qarzdor</h2>
        <div class="table-wrap"><table class="grid"><thead><tr><th>Ism</th><th class="num">Olgan tovar</th><th class="num">Bergan pul</th><th class="num">Qarz</th><th>Link</th></tr></thead>
          <tbody>${trs || '<tr><td colspan="5" class="empty">Do\'kon yo\'q</td></tr>'}</tbody>
          <tfoot><tr><td class="strong">Jami</td><td class="num strong">${money(tG)}</td><td class="num strong">${money(tP)}</td><td class="num strong">${money(tD)}</td><td></td></tr></tfoot></table></div>
        <p class="muted small">Qarz = olgan tovari − bergan puli. <span class="pos">Yashil (+)</span> — AS unga qarzdor. «Link» — o'sha odamga beradigan shaxsiy (yashirin) havola.</p>
      </section>`;
      $$('tr[data-hp]', body).forEach((tr) => {
        tr.onclick = (e) => { if (e.target.closest('[data-link]')) return; hf.person = tr.dataset.hp; routes.hisob(); };
      });
      $$('[data-link]', body).forEach((btn) => { btn.onclick = (e) => { e.stopPropagation(); copyPersonLink(find(db.people, btn.dataset.link)); }; });
      return;
    }
    const p = find(db.people, hf.person);
    const lines = C.personLines(db, p.id, '', '');
    const pays = personPayments(p.id, '', '');
    const n = personNet(p.id);
    body.innerHTML = `
      <section class="card"><div class="shop-head">
        <div><h2>${esc(p.name)}</h2><div class="muted small">To'liq hisob-kitob (hamma vaqt)</div></div>
        <div class="head-actions"><button class="btn" id="h-link">🔗 Shaxsiy link</button></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Olgan tovar</div><div class="stat-value">${money(n.goods)}</div><div class="stat-sub">${C.fmtNum(n.netM)} m</div></div>
        <div class="stat"><div class="stat-label">Bergan pul</div><div class="stat-value">${money(n.paid)}</div><div class="stat-sub">${pays.length} ta to'lov</div></div>
        <div class="stat ${n.debt > 0.005 ? 'accent' : (n.debt < -0.005 ? 'good' : '')}"><div class="stat-label">${n.debt < -0.005 ? 'AS qarzdor' : (n.debt > 0.005 ? esc(p.name) + ' qarzdor' : 'Qarz yo\'q')}</div><div class="stat-value">${money(Math.abs(n.debt))}</div><div class="stat-sub">olgan − bergan</div></div>
      </div></section>
      ${hisobTabsHtml(hisobGoodsTable(lines), hisobMoneyTable(pays), n.goods, n.paid)}`;
    if ($('#h-link')) $('#h-link').onclick = () => copyPersonLink(p);
    wireHisobTabs(body);
  }

  // Shaxsiy link bo'yicha ochiladigan toza sahifa (faqat o'sha odamniki, tahrirsiz)
  routes.h = async function renderShared(parts) {
    const token = (parts[0] || '').trim();
    let p = db.people.find((x) => x.token === token);
    // Mijoz qurilmasida (loginsiz) — Supabase'dan token bo'yicha ochiq o'qib olamiz
    if (!p && window.Sync && window.Sync.configured()) {
      main.innerHTML = '<div class="share-page"><div class="card"><div class="empty">Yuklanmoqda…</div></div></div>';
      try {
        const d = await window.Sync.shareGet(token);
        if (d && d.person) {
          db = Object.assign(C.emptyDb(), {
            settings: d.settings || { currency: '$' },
            products: d.products || [],
            warehouses: d.warehouses || [],
            people: [d.person],
            docs: d.docs || [],
            payments: d.payments || [],
          });
          p = d.person;
        }
      } catch (e) { /* xato bo'lsa pastda "noto'g'ri" chiqadi */ }
    }
    if (!p) {
      main.innerHTML = '<div class="share-page"><div class="card"><div class="empty">Link noto\'g\'ri yoki eskirgan.</div></div></div>';
      return;
    }
    const lines = C.personLines(db, p.id, '', '');
    const pays = personPayments(p.id, '', '');
    const n = personNet(p.id);
    main.innerHTML = `<div class="share-page">
      <div class="share-head"><span class="logo">S</span><div><h1>${esc(p.name)}</h1><div class="muted small">Hisob-kitob · ${C.fmtDate(C.today())}</div></div></div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Olgan tovar</div><div class="stat-value">${money(n.goods)}</div><div class="stat-sub">${C.fmtNum(n.netM)} m</div></div>
        <div class="stat"><div class="stat-label">Bergan pul</div><div class="stat-value">${money(n.paid)}</div><div class="stat-sub">${pays.length} ta to'lov</div></div>
        <div class="stat ${n.debt > 0.005 ? 'accent' : (n.debt < -0.005 ? 'good' : '')}"><div class="stat-label">${n.debt < -0.005 ? 'AS sizga qarzdor' : 'Qarzingiz'}</div><div class="stat-value">${money(Math.abs(n.debt))}</div><div class="stat-sub">olgan − bergan</div></div>
      </div>
      ${hisobTabsHtml(hisobGoodsTable(lines), hisobMoneyTable(pays), n.goods, n.paid)}
    </div>`;
    wireHisobTabs(main);
  };

  routes.dokonlar = function renderShops() {
    const all = sortByName(db.people);
    const archivedCount = all.filter((p) => p.archived).length;
    const shops = all.filter((p) => pf.showArchived || !p.archived);
    if (!shops.some((p) => p.id === pf.person)) pf.person = shops.length ? shops[0].id : '';
    const month = C.today().slice(0, 7);
    const chips = shops.map((p) => {
      const t = personTotals(C.personLines(db, p.id, month + '-01', ''));
      return `<button class="shop${p.id === pf.person ? ' on' : ''}${p.archived ? ' archived' : ''}" data-shop="${p.id}">
        <b>${esc(p.name)} <span class="badge kind-${personKind(p)}">${PERSON_KINDS[personKind(p)]}</span></b><span>${monthLabel(month)}: ${money(t.outS - t.retS)}</span></button>`;
    }).join('');
    main.innerHTML = `
      <div class="page-head"><h1>Do'konlar</h1><div class="head-actions">
        ${archivedCount ? `<label class="chk"><input type="checkbox" id="d-arch"${pf.showArchived ? ' checked' : ''}> Arxivdagilar (${archivedCount})</label>` : ''}
        <button class="btn primary" id="d-add">+ Yangi do'kon</button></div></div>
      ${shops.length ? `<div class="shops">${chips}</div>` : '<div class="card"><div class="empty">Hali do\'kon qo\'shilmagan — «+ Yangi do\'kon» tugmasini bosing.</div></div>'}
      <div id="d-body"></div>`;
    $('#d-add').onclick = async () => {
      const p = await entityModal('person', null);
      if (p) { pf.person = p.id; routes.dokonlar(); }
    };
    if ($('#d-arch')) $('#d-arch').onchange = (e) => { pf.showArchived = e.target.checked; routes.dokonlar(); };
    $$('[data-shop]').forEach((b) => { b.onclick = () => { if (b.dataset.shop !== pf.person) clearShopEdits(); pf.person = b.dataset.shop; routes.dokonlar(); }; });
    if (pf.person) drawShop();
  };

  // Numbers faylidagidek: Sana, Sklad, Nomi, Rulon, Metr, Linto, Obshi metr, Izoh, Narx, Summa — har oy oxirida jami
  // opts.edit — rulon/metr/linto katakchalarini bosib tahrirlash mumkin
  function shopSheetHtml(lines, opts) {
    const edit = opts && opts.edit;
    let html = '', month = '', mR = 0, mM = 0, mS = 0;
    const flush = () => {
      if (month) html += `<tr class="subtotal"><td colspan="3">${monthLabel(month)} jami</td><td class="num">${C.fmtNum(mR)}</td><td></td><td></td><td class="num">${C.fmtNum(mM)}</td><td></td><td></td><td class="num">${money(mS)}</td></tr>`;
    };
    for (const { doc, item, sign } of lines) {
      const m = doc.date.slice(0, 7);
      if (m !== month) { flush(); month = m; mR = 0; mM = 0; mS = 0; }
      mR += sign * C.itemRolls(item);
      mM += sign * item.metr;
      mS += sign * item.sum;
      const i = doc.items.indexOf(item);
      const ec = (k, inner) => edit
        ? `<td class="num editable" data-doc="${doc.id}" data-i="${i}" data-k="${k}" title="Bosib o'zgartirish">${inner}</td>`
        : `<td class="num">${inner}</td>`;
      html += `<tr class="click${sign < 0 ? ' ret' : ''}" data-doc="${doc.id}">
        <td class="nowrap">${C.fmtDate(doc.date)}</td><td>${esc(item.src || whName(C.itemWh(doc, item)))}</td><td>${esc(prodName(item.productId))}</td>
        ${ec('rolls', rollsCell(item))}${ec('rollM', C.fmtNum(item.rollM))}${ec('linto', lintoCell(item) || '<span class="muted">—</span>')}
        ${edit
          ? `<td class="num c-ometr editable${item.metrManual ? ' manual' : ''}" data-doc="${doc.id}" data-i="${i}" data-k="metr" title="Bosib o'zgartirish (tegmasa formula)">${C.fmtNum(item.metr)}</td>`
          : `<td class="num c-ometr" data-doc="${doc.id}" data-i="${i}">${C.fmtNum(item.metr)}</td>`}<td class="${sign < 0 ? 'neg strong' : 'muted'}">${sign < 0 ? 'QAYTGAN' : esc(doc.note || '')}</td>
        <td class="num">${C.fmtNum(item.price, 4)}</td><td class="num c-sum${sign < 0 ? ' neg' : ''}" data-doc="${doc.id}" data-i="${i}">${money(sign * item.sum)}</td></tr>`;
    }
    flush();
    const t = personTotals(lines);
    const netRolls = lines.reduce((a, { item, sign }) => a + sign * C.itemRolls(item), 0);
    return `<table class="grid sheet sticky">
      <thead><tr><th>Sana</th><th>Sklad</th><th>Nomi</th><th class="num">Rulon</th><th class="num">Metr</th><th class="num">Linto</th><th class="num">Obshi metr</th><th>Izoh</th><th class="num">Narx</th><th class="num">Summa</th></tr></thead>
      <tbody>${html}</tbody>
      <tfoot><tr><td colspan="3" class="strong">Umumiy jami</td><td class="num strong">${C.fmtNum(netRolls)}</td><td></td><td></td><td class="num strong">${C.fmtNum(t.outM - t.retM)}</td><td></td><td></td><td class="num strong">${money(t.outS - t.retS)}</td></tr></tfoot></table>`;
  }

  function periodLabel() {
    if (!pf.from && !pf.to) return 'Hamma vaqt';
    return `${pf.from ? C.fmtDate(pf.from) : '…'} — ${pf.to ? C.fmtDate(pf.to) : 'bugun'}`;
  }

  function drawShop() {
    const p = find(db.people, pf.person);
    const lines = C.personLines(db, p.id, pf.from, pf.to);
    const t = personTotals(lines);
    const pays = personPayments(p.id, pf.from, pf.to);
    const paid = personPaidUsd(p.id, pf.from, pf.to);
    const payCount = pays.length;
    const debt = C.r2((t.outS - t.retS) - paid);
    $('#d-body').innerHTML = `
      <section class="card">
        <div class="shop-head">
          <div><h2>${esc(p.name)} <span class="badge kind-${personKind(p)}">${PERSON_KINDS[personKind(p)]}</span>${p.archived ? ' <span class="badge">arxiv</span>' : ''}</h2>
            ${p.phone || p.note ? `<div class="muted small">${esc([p.phone, p.note].filter(Boolean).join(' · '))}</div>` : ''}</div>
          <div class="head-actions">
            <button class="btn primary" id="d-out">+ Chiqim</button>
            <button class="btn" id="d-ret">+ Qaytish</button>
            <button class="btn" id="d-pay">+ To'lov</button>
            <button class="btn" id="d-export">Excelga yuklash</button>
            <label class="btn" id="d-import-wrap" title="Fayldan (JSON) ro\'yxat yuklash — skladga tegmaydi">Fayldan yuklash<input type="file" id="d-import" accept=".json,application/json" hidden></label>
            <button class="btn" id="d-print">Chop etish</button>
            <button class="btn ghost" id="d-edit">Tahrirlash</button>
          </div>
        </div>
        <div class="fields plain">
          <label class="f">Sanadan<input type="date" id="d-from" value="${pf.from}"></label>
          <label class="f">Sanagacha<input type="date" id="d-to" value="${pf.to}"></label>
          <div class="f">Tez tanlash<span class="inline">
            <button class="btn sm" data-range="month">Shu oy</button><button class="btn sm" data-range="prev">O'tgan oy</button>
            <button class="btn sm" data-range="year">Shu yil</button><button class="btn sm" data-range="all">Hammasi</button></span></div>
        </div>
      </section>
      <div class="stats">
        <div class="stat"><div class="stat-label">Olgan</div><div class="stat-value">${money(t.outS)}</div><div class="stat-sub">${C.fmtNum(t.outM)} m</div></div>
        <div class="stat"><div class="stat-label">Qaytargan</div><div class="stat-value">${money(t.retS)}</div><div class="stat-sub">${C.fmtNum(t.retM)} m</div></div>
        <div class="stat"><div class="stat-label">To'lagan (pul)</div><div class="stat-value">${money(paid)}</div><div class="stat-sub">${payCount} ta to'lov</div></div>
        <div class="stat ${debt > 0.005 ? 'accent' : (debt < -0.005 ? 'good' : '')}"><div class="stat-label">${debt < -0.005 ? 'AS qarzdor' : (debt > 0.005 ? esc(p.name) + ' qarzdor' : 'Qarz yo\'q')} · ${esc(periodLabel())}</div><div class="stat-value">${money(Math.abs(debt))}</div><div class="stat-sub">Olgan − qaytargan − to'lagan</div></div>
      </div>
      <section class="card flush sheet-card" id="d-card" style="--sheet-font:${sheetFont()}px">
        <div class="sheet-bar">
          <span class="sheet-title">${esc(p.name)}</span>
          <span class="muted small edit-hint">Rulon · Metr · Linto · Obshi metr katakchasini bosib o'zgartiring (Obshi metr tegilmasa — formula)</span>
          <span class="grow"></span>
          <button class="btn sm" data-font="-1" title="Kichikroq yozuv">A−</button>
          <button class="btn sm" data-font="1" title="Kattaroq yozuv">A+</button>
          <button class="btn sm primary" data-fs title="To'liq ekran (chiqish: Esc)">⛶ To'liq ekran</button>
        </div>
        <div class="sheet-body">
          ${lines.length ? `<div class="table-wrap big" id="d-sheet">${shopSheetHtml(lines, { edit: true })}</div>` : '<div class="empty">Bu davrda chiqim yo\'q</div>'}
        </div>
      </section>
      <section class="card">
        <div class="shop-head">
          <div><h2>To'lovlar (pul bergani)</h2><div class="muted small">Jami to'lagan: <b>${money(paid)}</b> · ${payCount} ta</div></div>
          <div class="head-actions"><button class="btn primary" id="d-pay2">+ To'lov</button></div>
        </div>
        ${pays.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Sana</th><th class="num">So'm</th><th class="num">Kurs</th><th class="num">$</th><th>Izoh</th></tr></thead><tbody>
          ${pays.slice().reverse().map((pm) => `<tr class="click" data-pay="${pm.id}">
            <td class="nowrap">${C.fmtDate(pm.date)}</td>
            <td class="num">${pm.som ? C.fmtNum(pm.som, 0) : '<span class="muted">—</span>'}</td>
            <td class="num muted">${pm.kurs ? C.fmtNum(pm.kurs, 0) : '—'}</td>
            <td class="num strong">$${C.fmtMoney(pm.usd)}</td>
            <td>${esc(pm.note || '') || '<span class="muted">—</span>'}</td></tr>`).join('')}
          </tbody><tfoot><tr><td class="strong">Jami</td><td></td><td></td><td class="num strong">$${C.fmtMoney(paid)}</td><td></td></tr></tfoot></table></div>`
          : '<div class="empty">Hali to\'lov yo\'q — «+ To\'lov» tugmasini bosing.</div>'}
      </section>`;

    const card = $('#d-card');
    const sheet = $('#d-sheet');
    if (sheet) sheet.scrollTop = sheet.scrollHeight; // Numbers dagidek eng yangisi pastda
    $('#d-from').onchange = (e) => { pf.from = e.target.value; drawShop(); };
    $('#d-to').onchange = (e) => { pf.to = e.target.value; drawShop(); };
    $$('#d-body [data-range]').forEach((b) => { b.onclick = () => { Object.assign(pf, rangeFor(b.dataset.range)); drawShop(); }; });
    $('#d-out').onclick = () => startNew('chiqim', { personId: p.id });
    $('#d-ret').onclick = () => startNew('qaytish', { personId: p.id });
    $('#d-pay').onclick = () => paymentModal(p);
    if ($('#d-pay2')) $('#d-pay2').onclick = () => paymentModal(p);
    $$('#d-body tr[data-pay]').forEach((tr) => { tr.onclick = () => paymentModal(p, (db.payments || []).find((x) => x.id === tr.dataset.pay)); });
    $('#d-edit').onclick = async () => { await entityModal('person', p); routes.dokonlar(); };
    $('#d-export').onclick = () => exportShop(p, lines);
    if ($('#d-import')) $('#d-import').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importToShop(p, f); };
    $('#d-print').onclick = () => {
      $('#print-area').innerHTML = `<h1>${esc(p.name)}</h1><p>${esc(periodLabel())}</p>${lines.length ? shopSheetHtml(lines) : '<p>Chiqim yo\'q</p>'}`;
      window.print();
    };
    $$('[data-font]', card).forEach((b) => {
      b.onclick = () => {
        const v = Math.min(28, Math.max(11, sheetFont() + (+b.dataset.font)));
        setSheetFont(v); card.style.setProperty('--sheet-font', v + 'px');
      };
    });
    $('[data-fs]', card).onclick = () => (card.classList.contains('fs') ? exitSheetFullscreen() : enterSheetFullscreen(card));
    // Do'konlarda qator ustiga bosilsa hech narsa ochilmaydi (modal yo'q) — faqat kataklar tahrirlanadi
    wireShopEdit(card, p);
  }

  // ---------- Ro'yxatda rulon/metr/linto'ni bosib tahrirlash (oxirida bitta tasdiq) ----------
  let shopEdits = {};

  function clearShopEdits() {
    shopEdits = {};
    const bar = $('#shop-edit-bar');
    if (bar) bar.remove();
  }

  function fmtField(k, val) {
    const n = C.num(val);
    if (k === 'linto' && (String(val).trim() === '' || n === 0)) return '<span class="muted">—</span>';
    return C.fmtNum(n);
  }

  function effItem(docId, i) {
    const doc = find(db.docs, docId);
    const it = doc && doc.items[i];
    const e = Object.assign({}, it);
    for (const k of ['rolls', 'rollM', 'linto', 'metr']) {
      const key = `${docId}:${i}:${k}`;
      if (key in shopEdits) e[k] = C.num(shopEdits[key]);
    }
    return { doc, it, e };
  }

  function rowHasPending(docId, i) {
    return ['rolls', 'rollM', 'linto', 'metr'].some((k) => (`${docId}:${i}:${k}`) in shopEdits);
  }

  // Qator metri: qo'lda kiritilsa — o'sha; aks holda formula (rulon×metr+linto) yoki saqlangan qiymat
  function effMetr(docId, i, it, e) {
    const mk = `${docId}:${i}:metr`;
    if (mk in shopEdits) return C.num(shopEdits[mk]);
    if (['rolls', 'rollM', 'linto'].some((k) => (`${docId}:${i}:${k}`) in shopEdits)) return C.lineMetr(e);
    return (it && it.metrManual) ? C.num(it.metr) : C.num(e.metr);
  }

  function recalcRow(card, docId, i) {
    const { doc, it, e } = effItem(docId, i);
    if (!doc) return;
    e.metr = effMetr(docId, i, it, e);
    const sum = C.lineSum(e);
    const sign = doc.type === 'qaytish' ? -1 : 1;
    const pend = rowHasPending(docId, i);
    const om = card.querySelector(`.c-ometr[data-doc="${docId}"][data-i="${i}"]`);
    const sm = card.querySelector(`.c-sum[data-doc="${docId}"][data-i="${i}"]`);
    if (om && !om.querySelector('input')) { om.textContent = C.fmtNum(e.metr); om.classList.toggle('pending', pend); }
    if (sm) { sm.innerHTML = money(sign * sum); sm.classList.toggle('pending', pend); }
  }

  function wireShopEdit(card, p) {
    $$('.editable', card).forEach((td) => {
      td.onclick = (e) => { e.stopPropagation(); beginCellEdit(card, td, p); };
    });
    // re-render yoki sahifa qayta chizilganda kutayotgan o'zgarishlarni qayta ko'rsatish
    const rows = new Set();
    for (const key of Object.keys(shopEdits)) {
      const [docId, iStr, k] = key.split(':');
      const td = card.querySelector(`.editable[data-doc="${docId}"][data-i="${iStr}"][data-k="${k}"]`);
      if (td) { td.innerHTML = fmtField(k, shopEdits[key]); td.classList.add('pending'); }
      rows.add(docId + '\u0000' + iStr);
    }
    for (const r of rows) { const [docId, iStr] = r.split('\u0000'); recalcRow(card, docId, +iStr); }
    updateShopPendingBar(p);
  }

  function beginCellEdit(card, td, p) {
    if (td.querySelector('input')) return;
    const docId = td.dataset.doc, i = td.dataset.i, k = td.dataset.k;
    const key = `${docId}:${i}:${k}`;
    const { it } = effItem(docId, +i);
    const cur = key in shopEdits ? shopEdits[key]
      : (it == null || it[k] === '' || it[k] == null || (k === 'linto' && C.num(it[k]) === 0) ? '' : it[k]);
    td.innerHTML = `<input class="sheet-in" value="${esc(String(cur))}" inputmode="decimal">`;
    const input = td.querySelector('input');
    input.focus(); input.select();
    const finish = (commit) => {
      if (commit) commitCell(card, td, input, p);
      else { td.innerHTML = fmtField(k, key in shopEdits ? shopEdits[key] : (it ? it[k] : '')); td.classList.toggle('pending', key in shopEdits); }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.onblur = null; finish(false); }
    };
    input.onblur = () => finish(true);
  }

  function commitCell(card, td, input, p) {
    const docId = td.dataset.doc, i = +td.dataset.i, k = td.dataset.k;
    const key = `${docId}:${i}:${k}`;
    const raw = input.value.trim();
    const doc = find(db.docs, docId);
    const it = doc && doc.items[i];
    const orig = it ? it[k] : '';
    // asl qiymatdan farq qilsa — kutilayotgan o'zgarish sifatida saqlanadi, aks holda olib tashlanadi
    if (C.num(raw) !== C.num(orig)) shopEdits[key] = raw;
    else delete shopEdits[key];
    td.innerHTML = fmtField(k, key in shopEdits ? shopEdits[key] : orig);
    td.classList.toggle('pending', key in shopEdits);
    recalcRow(card, docId, i);
    updateShopPendingBar(p);
  }

  function updateShopPendingBar(p) {
    let bar = $('#shop-edit-bar');
    const n = Object.keys(shopEdits).length;
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'shop-edit-bar'; document.body.appendChild(bar); }
    bar.innerHTML = `<span class="se-count"><b>${n}</b> ta o'zgarish</span>
      <button class="btn sm ghost" id="se-cancel">Bekor qilish</button>
      <button class="btn sm primary" id="se-save">Saqlash</button>`;
    $('#se-cancel').onclick = () => { shopEdits = {}; updateShopPendingBar(p); drawShop(); };
    $('#se-save').onclick = () => saveShopEdits(p);
  }

  async function saveShopEdits(p) {
    const keys = Object.keys(shopEdits);
    if (!keys.length) return;
    const ok = await confirmModal("O'zgarishlarni saqlash",
      `<p><b>${keys.length}</b> ta katakcha o'zgartirildi. Saqlansinmi?</p>
       <p class="muted small">Obshi metr va summa qayta hisoblanadi.</p>`, 'Saqlash');
    if (!ok) return;
    // Har hujjat-qator bo'yicha guruhlaymiz
    const byRow = new Map();
    for (const key of keys) {
      const [docId, iStr, k] = key.split(':');
      const rk = docId + ':' + iStr;
      if (!byRow.has(rk)) byRow.set(rk, { docId, i: +iStr, f: {} });
      byRow.get(rk).f[k] = shopEdits[key];
    }
    for (const { docId, i, f } of byRow.values()) {
      const doc = find(db.docs, docId); if (!doc) continue;
      const it = doc.items[i]; if (!it) continue;
      for (const k of ['rolls', 'rollM', 'linto']) {
        if (k in f) it[k] = (k === 'linto' && String(f[k]).trim() === '') ? '' : (C.num(f[k]) || 0);
      }
      if ('metr' in f) {
        it.metr = C.num(f.metr) || 0;   // qo'lda kiritildi — o'zgarmaydi
        it.metrManual = true;
      } else if (!it.metrManual) {
        it.metr = C.lineMetr(it);        // tegmagan — formula
      }
      it.sum = C.lineSum(it);
    }
    shopEdits = {};
    saveDb();
    updateShopPendingBar(p);
    toast('Saqlandi');
    drawShop();
  }

  function exportShop(p, lines) {
    const rows = lines.map(({ doc, item, sign }) => [C.fmtDate(doc.date), item.src || whName(C.itemWh(doc, item)), prodName(item.productId), C.itemRolls(item), item.rollM,
      item.linto || '', item.metr, sign < 0 ? 'QAYTGAN' : (doc.note || ''), item.price, sign * item.sum]);
    downloadCSV(`${p.name.replace(/[\\/:*?"<>|]/g, '')}-${C.today()}.csv`,
      ['Sana', 'Sklad', 'Nomi', 'Rulon', 'Metr', 'Linto', 'Obshi metr', 'Izoh', 'Narx', 'Summa'], rows);
  }

  // ---------- Fayldan do'konga yuklash (skladga tegmaydi) ----------
  // Fayl: yozuvlar ro'yxati [{date, src, name, rolls, rollM, linto, metr, price, sum}] yoki {rows:[...]}
  function importToShop(shop, file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      const rows = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : null);
      const pays = (data && Array.isArray(data.payments)) ? data.payments : null;
      if ((!rows || !rows.length) && (!pays || !pays.length)) { toast('Bu fayl mos emas yoki bo\'sh'); return; }
      const parts = [];
      if (rows && rows.length) parts.push(`<b>${rows.length}</b> ta tovar`);
      if (pays && pays.length) parts.push(`<b>${pays.length}</b> ta to'lov`);
      const ok = await confirmModal('Fayldan yuklash',
        `<p><b>${esc(shop.name)}</b> do'koniga ${parts.join(' va ')} qo'shiladi.</p>
         <p class="muted">Skladga tegilmaydi — faqat shu do'kon ro'yxatiga qo'shiladi. Narx = tushgan narx.</p>`, 'Yuklash');
      if (!ok) return;
      const msg = [];
      if (rows && rows.length) { const { added, newProducts } = addRowsToShop(shop, rows); msg.push(`${added} ta yozuv${newProducts ? ` · ${newProducts} yangi tovar` : ''}`); }
      if (pays && pays.length) { const np = addPaymentsToShop(shop, pays); msg.push(`${np} ta to'lov`); }
      saveDb();
      toast(msg.join(' · ') + ' qo\'shildi');
      routes.dokonlar();
    };
    reader.readAsText(file);
  }

  // Fayldan to'lovlar: [{date, usd|summa, note|comment, som?, kurs?, mode?}]
  function addPaymentsToShop(shop, pays) {
    let n = 0;
    for (const p of pays) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : C.today();
      const usd = C.r2(C.num(p.usd != null ? p.usd : p.summa) || 0);
      const som = C.num(p.som) || 0;
      const kurs = C.num(p.kurs) || 0;
      const note = p.note != null ? String(p.note) : (p.comment != null ? String(p.comment) : '');
      (db.payments || (db.payments = [])).push({
        id: C.uid(), personId: shop.id, date, som, kurs, usd, note,
        mode: p.mode || 'usd', createdAt: new Date().toISOString(),
      });
      n++;
    }
    return n;
  }

  function ensureProduct(name, cost, rollM, created) {
    const nn = C.normName(name);
    let pr = nn && db.products.find((x) => C.normName(x.name) === nn);
    if (!pr) {
      pr = { id: C.uid(), name: String(name == null ? '' : name).trim() || '(nomsiz)', rollM: C.num(rollM) || 0, cost: C.num(cost) || 0, price: 0 };
      db.products.push(pr); created.n++;
    }
    return pr;
  }

  function addRowsToShop(shop, rows) {
    const byDate = new Map();
    for (const r of rows) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : C.today();
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(r);
    }
    const created = { n: 0 };
    let added = 0;
    for (const date of Array.from(byDate.keys()).sort()) {
      const items = byDate.get(date).map((r) => {
        const pr = ensureProduct(r.name, r.price, r.rollM, created);
        added++;
        return {
          productId: pr.id,
          src: r.src ? String(r.src) : '',
          rolls: C.num(r.rolls) || 0,
          rollM: C.num(r.rollM) || 0,
          linto: (r.linto == null || r.linto === '') ? '' : (C.num(r.linto) || 0),
          metr: C.num(r.metr) || 0,
          price: C.num(r.price) || 0,
          sum: C.num(r.sum) || 0,
        };
      });
      db.seq = (db.seq || 0) + 1;
      db.docs.push({
        id: C.uid(), no: db.seq, type: 'chiqim', date,
        personId: shop.id, skipStock: true, note: '',
        items, createdAt: new Date().toISOString(),
      });
    }
    return { added, newProducts: created.n };
  }

  // ---------- Statistika ----------
  const xf = { range: 'month', wh: '', person: '', metric: 'sum' };
  const RANGES = [['month', 'Shu oy'], ['prev', "O'tgan oy"], ['3m', 'Oxirgi 3 oy'], ['year', 'Shu yil'], ['all', 'Hammasi']];

  function isoOf(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

  // Raqamni ixcham yozish: 12 500 → 12,5K
  function compact(x) {
    const a = Math.abs(x);
    if (a >= 1e6) return C.fmtNum(x / 1e6, 1) + 'M';
    if (a >= 1e4) return C.fmtNum(x / 1e3, 1) + 'K';
    return C.fmtNum(x, 0);
  }

  function statPeriod() {
    const today = C.today();
    let r;
    if (xf.range === '3m') { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2); r = { from: isoOf(d), to: '' }; }
    else r = rangeFor(xf.range);
    const first = db.docs.reduce((m, d) => (!d.cancelled && (!m || d.date < m) ? d.date : m), '') || today;
    const from = r.from || first;
    const to = r.to && r.to < today ? r.to : today;
    const days = Math.max(1, dayDiff(from, to) + 1);
    const prev = xf.range === 'all' ? null : { from: addDays(from, -days), to: addDays(from, -1) };
    return { from, to, days, prev };
  }

  // Tanlangan davr, sklad va do'kon bo'yicha sotuv (chiqim − qaytish)
  function salesIn(from, to) {
    const res = { sum: 0, metr: 0, rolls: 0, docs: new Set(), shops: new Set(), byProduct: new Map(), byPerson: new Map(), byDay: new Map() };
    for (const d of db.docs) {
      if (d.cancelled || (d.type !== 'chiqim' && d.type !== 'qaytish') || d.date < from || d.date > to) continue;
      if (xf.person && d.personId !== xf.person) continue;
      const sign = d.type === 'qaytish' ? -1 : 1;
      for (const it of d.items) {
        if (xf.wh && C.itemWh(d, it) !== xf.wh) continue;
        const m = sign * C.num(it.metr), sm = sign * C.num(it.sum), r = sign * C.itemRolls(it);
        res.sum += sm; res.metr += m; res.rolls += r;
        if (sign > 0) { res.docs.add(d.id); res.shops.add(d.personId); }
        const bp = res.byProduct.get(it.productId) || { sum: 0, metr: 0, rolls: 0 };
        bp.sum += sm; bp.metr += m; bp.rolls += r;
        res.byProduct.set(it.productId, bp);
        const bh = res.byPerson.get(d.personId) || { sum: 0, metr: 0 };
        bh.sum += sm; bh.metr += m;
        res.byPerson.set(d.personId, bh);
        res.byDay.set(d.date, (res.byDay.get(d.date) || 0) + sm);
      }
    }
    return res;
  }

  function lastSoldDates() {
    const last = new Map();
    for (const d of db.docs) {
      if (d.cancelled || d.type !== 'chiqim' || (xf.person && d.personId !== xf.person)) continue;
      for (const it of d.items) {
        if (xf.wh && C.itemWh(d, it) !== xf.wh) continue;
        if (!last.has(it.productId) || last.get(it.productId) < d.date) last.set(it.productId, d.date);
      }
    }
    return last;
  }

  // Gorizontal ustunlar (eng kattasi tepada, bitta rang)
  function hbars(rows, valueText, tipText) {
    const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
    return `<div class="hbars">${rows.map((r, i) => `
      <div class="hb-row${r.pid ? ' click' : ''}" tabindex="0" data-tip="${esc(tipText(r))}"${r.pid ? ` data-p="${r.pid}"` : ''}>
        <div class="hb-label"><span class="hb-rank">${i + 1}</span>${esc(r.label)}</div>
        <div class="hb-track"><div class="hb-bar" style="width:${Math.max(0.6, (r.value / max) * 72)}%"></div><span class="hb-val">${valueText(r)}</span></div>
      </div>`).join('')}</div>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
    return 10 * p;
  }

  // Sotuv dinamikasi: kunlar (2 oygacha) yoki oylar bo'yicha ustunlar
  function trendHtml(period, byDay) {
    const daily = period.days <= 62;
    const buckets = [];
    if (daily) {
      for (let d = period.from; d <= period.to; d = addDays(d, 1)) buckets.push({ key: d, label: d.slice(8, 10) + '.' + d.slice(5, 7), full: C.fmtDate(d), value: byDay.get(d) || 0 });
    } else {
      const map = new Map();
      for (let m = period.from.slice(0, 7); m <= period.to.slice(0, 7);) {
        map.set(m, 0);
        const [y, mo] = m.split('-').map(Number);
        m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
      }
      for (const [d, v] of byDay) { const k = d.slice(0, 7); if (map.has(k)) map.set(k, map.get(k) + v); }
      for (const [k, v] of map) buckets.push({ key: k, label: MONTHS[+k.slice(5) - 1].slice(0, 3), full: monthLabel(k), value: v });
    }
    const top = niceMax(Math.max(0, ...buckets.map((b) => b.value)));
    const maxIdx = buckets.reduce((bi, b, i) => (b.value > buckets[bi].value ? i : bi), 0);
    const every = Math.ceil(buckets.length / 8);
    const ticks = [top, top / 2, 0];
    return `<div class="cols" role="img" aria-label="Sotuv dinamikasi">
      <div class="cols-plot">
        ${ticks.map((t) => `<div class="cols-grid" style="bottom:${(t / top) * 100}%"><span>${compact(t)}</span></div>`).join('')}
        <div class="cols-bars">${buckets.map((b, i) => `
          <div class="col" tabindex="0" data-tip="${esc(b.full)}\n${esc(cur())}${C.fmtMoney(b.value)}">
            <div class="col-bar" style="height:${Math.max(0, (b.value / top) * 100)}%">${i === maxIdx && b.value > 0 ? `<span class="col-cap">${compact(b.value)}</span>` : ''}</div>
          </div>`).join('')}</div>
      </div>
      <div class="cols-x">${buckets.map((b, i) => `<span>${i % every === 0 ? esc(b.label) : ''}</span>`).join('')}</div>
    </div>`;
  }

  function coverText(days) {
    if (!isFinite(days)) return 'sotilmagan';
    if (days > 365) return '1 yildan ko\'p';
    if (days > 60) return `~${Math.round(days / 30)} oy`;
    return `~${Math.max(1, Math.round(days))} kun`;
  }

  function statusChip(level, text) {
    const icon = { critical: '!', serious: '▲', warning: '●', idle: '–' }[level];
    return `<span class="st-chip st-${level}"><i>${icon}</i>${esc(text)}</span>`;
  }

  routes.statistika = function renderStats() {
    main.innerHTML = `
      <div class="page-head"><h1>Statistika</h1></div>
      <div class="card fields stat-filters">
        <div class="seg" id="x-range">${RANGES.map(([k, l]) => `<button data-range="${k}" class="${xf.range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="f">Sklad<select id="x-wh">${options(db.warehouses, xf.wh, 'Hamma skladlar')}</select></label>
        <label class="f">Do'kon<select id="x-person">${options(sortByName(db.people), xf.person, "Hamma do'konlar")}</select></label>
      </div>
      <div id="x-body"></div>`;
    $$('#x-range button').forEach((b) => { b.onclick = () => { xf.range = b.dataset.range; routes.statistika(); }; });
    $('#x-wh').onchange = (e) => { xf.wh = e.target.value; drawStats(); };
    $('#x-person').onchange = (e) => { xf.person = e.target.value; drawStats(); };
    drawStats();
  };

  function drawStats() {
    const per = statPeriod();
    const S = salesIn(per.from, per.to);
    const P = per.prev ? salesIn(per.prev.from, per.prev.to) : null;
    const stock = C.computeStock(db);
    const whs = xf.wh ? [find(db.warehouses, xf.wh)] : db.warehouses.filter((w) => !w.archived);
    const last = lastSoldDates();

    // Har bir tovar: qoldiq (tanlangan skladlarda), davrdagi sotuv, kunlik o'rtacha, necha kunga yetadi
    const items = db.products.map((p) => {
      let rolls = 0, metr = 0;
      for (const w of whs) { const st = C.getStock(stock, w.id, p.id); rolls += st.rolls; metr += st.metr; }
      const sold = S.byProduct.get(p.id) || { sum: 0, metr: 0, rolls: 0 };
      const daily = sold.metr > 0 ? sold.metr / per.days : 0;
      return { p, rolls: C.r2(rolls), metr: C.r2(metr), value: C.r2(metr * (p.cost || 0)), sold, cover: daily > 0 ? metr / daily : Infinity, last: last.get(p.id) || '' };
    });
    const inStock = items.filter((x) => x.metr > 0.004);
    const stockValue = inStock.reduce((a, x) => a + x.value, 0);
    const stockRolls = inStock.reduce((a, x) => a + x.rolls, 0);

    const delta = (cur, prev) => {
      if (!P || !prev) return '';
      const pct = ((cur - prev) / Math.abs(prev)) * 100;
      const up = pct >= 0;
      return `<div class="stat-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${C.fmtNum(Math.abs(pct), 0)}% <span class="muted">o'tgan davrga nisbatan</span></div>`;
    };
    const periodText = `${C.fmtDate(per.from)} — ${C.fmtDate(per.to)} · ${per.days} kun`;

    const topRows = Array.from(S.byProduct.entries()).map(([pid, v]) => ({ pid, label: prodName(pid), ...v }))
      .filter((r) => r[xf.metric] > 0.004).sort((a, b) => b[xf.metric] - a[xf.metric]).slice(0, 10)
      .map((r) => ({ ...r, value: r[xf.metric] }));
    const shopRows = Array.from(S.byPerson.entries()).map(([id, v]) => ({ label: personName(id), ...v, value: v.sum }))
      .filter((r) => r.sum > 0.004).sort((a, b) => b.sum - a.sum).slice(0, 10);
    const fast = inStock.filter((x) => isFinite(x.cover) && x.cover <= 30).sort((a, b) => a.cover - b.cover).slice(0, 12);
    const slow = inStock.filter((x) => !isFinite(x.cover) || x.cover > 90).sort((a, b) => b.value - a.value || b.metr - a.metr).slice(0, 12);
    const biggest = inStock.slice().sort((a, b) => b.value - a.value || b.metr - a.metr).slice(0, 10)
      .map((x) => ({ pid: x.p.id, label: x.p.name, value: x.value || x.metr, x }));
    const metricText = { sum: (r) => money(r.sum), metr: (r) => `${C.fmtNum(r.metr)} m`, rolls: (r) => `${C.fmtNum(r.rolls)} rulon` };

    const whRows = whs.map((w) => {
      let rolls = 0, metr = 0, value = 0;
      for (const p of db.products) { const st = C.getStock(stock, w.id, p.id); if (st.metr > 0.004) { rolls += st.rolls; metr += st.metr; value += st.metr * (p.cost || 0); } }
      let sold = 0;
      for (const d of db.docs) {
        if (d.cancelled || (d.type !== 'chiqim' && d.type !== 'qaytish') || d.date < per.from || d.date > per.to || (xf.person && d.personId !== xf.person)) continue;
        for (const it of d.items) if (C.itemWh(d, it) === w.id) sold += (d.type === 'qaytish' ? -1 : 1) * C.num(it.sum);
      }
      return { w, rolls, metr, value, sold };
    });

    const empty = (t) => `<div class="empty small">${t}</div>`;
    $('#x-body').innerHTML = `
      <p class="muted small period-line">${esc(periodText)}${xf.wh ? ` · ${esc(whName(xf.wh))}` : ''}${xf.person ? ` · ${esc(personName(xf.person))}` : ''}</p>
      <div class="stats kpis">
        <div class="stat"><div class="stat-label">Sotuv</div><div class="stat-value">${money(S.sum)}</div>${delta(S.sum, P && P.sum)}</div>
        <div class="stat"><div class="stat-label">Sotilgan</div><div class="stat-value">${C.fmtNum(S.rolls)} rulon</div><div class="stat-sub">${C.fmtNum(S.metr)} m</div>${delta(S.metr, P && P.metr)}</div>
        <div class="stat"><div class="stat-label">Chiqimlar</div><div class="stat-value">${S.docs.size} ta</div><div class="stat-sub">${S.shops.size} ta do'konga</div></div>
        <div class="stat"><div class="stat-label">Skladdagi qoldiq (tannarxda)</div><div class="stat-value">${money(stockValue)}</div><div class="stat-sub">${C.fmtNum(stockRolls, 0)} rulon · ${inStock.length} xil tovar</div></div>
      </div>

      <section class="card">
        <h2 class="card-title">Sotuv dinamikasi <span class="muted small">— ${per.days <= 62 ? 'kunlar' : 'oylar'} bo'yicha, ${esc(cur())}</span></h2>
        ${S.docs.size ? trendHtml(per, S.byDay) : empty("Bu davrda sotuv yo'q")}
      </section>

      <div class="two-col even">
        <section class="card">
          <div class="card-head"><h2 class="card-title">Eng ko'p sotilayotgan tovarlar</h2>
            <div class="seg sm" id="x-metric">${[['sum', 'Summa'], ['metr', 'Metr'], ['rolls', 'Rulon']].map(([k, l]) => `<button data-m="${k}" class="${xf.metric === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          ${topRows.length ? hbars(topRows, metricText[xf.metric], (r) => `${r.label}\n${cur()}${C.fmtMoney(r.sum)} · ${C.fmtNum(r.metr)} m · ${C.fmtNum(r.rolls)} rulon\nUlushi: ${C.fmtNum(S.sum ? (r.sum / S.sum) * 100 : 0, 1)}%`) : empty("Bu davrda sotuv yo'q")}
        </section>
        <section class="card">
          <h2 class="card-title">Do'konlar reytingi</h2>
          ${shopRows.length ? hbars(shopRows, (r) => money(r.sum), (r) => `${r.label}\n${cur()}${C.fmtMoney(r.sum)} · ${C.fmtNum(r.metr)} m\nUlushi: ${C.fmtNum(S.sum ? (r.sum / S.sum) * 100 : 0, 1)}%`) : empty("Bu davrda sotuv yo'q")}
        </section>
      </div>

      <div class="two-col even">
        <section class="card flush">
          <h2 class="card-title pad">Tez tugayotgan tovarlar <span class="muted small">— hozirgi sotuv tezligida 30 kundan kam yetadi</span></h2>
          ${fast.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Tovar</th><th class="num">Qoldiq</th><th class="num">Kuniga</th><th>Yetadi</th></tr></thead><tbody>
            ${fast.map((x) => `<tr class="click" data-p="${x.p.id}"><td>${esc(x.p.name)}</td><td class="num nowrap">${stockHtml(x)}</td>
              <td class="num nowrap">${C.fmtNum(x.sold.metr / per.days, 1)} m</td>
              <td>${statusChip(x.cover < 7 ? 'critical' : x.cover < 14 ? 'serious' : 'warning', coverText(x.cover))}</td></tr>`).join('')}
          </tbody></table></div>` : empty("Tez tugayotgan tovar yo'q")}
        </section>
        <section class="card flush">
          <h2 class="card-title pad">Sotilmayotgan tovarlar <span class="muted small">— 3 oydan ko'pga yetadi yoki umuman sotilmagan</span></h2>
          ${slow.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Tovar</th><th class="num">Qoldiq</th><th class="num">Turib qolgan pul</th><th>Oxirgi sotuv</th></tr></thead><tbody>
            ${slow.map((x) => `<tr class="click" data-p="${x.p.id}"><td>${esc(x.p.name)}<div class="sub">${statusChip('idle', isFinite(x.cover) ? coverText(x.cover) + 'ga yetadi' : 'bu davrda sotilmagan')}</div></td>
              <td class="num nowrap">${stockHtml(x)}</td><td class="num">${x.value ? money(x.value) : '<span class="zero">—</span>'}</td>
              <td class="nowrap">${x.last ? C.fmtDate(x.last) : '<span class="muted">hech qachon</span>'}</td></tr>`).join('')}
          </tbody></table></div>` : empty("Hamma tovar sotilyapti")}
        </section>
      </div>

      <div class="two-col even">
        <section class="card">
          <h2 class="card-title">Eng ko'p qoldiq <span class="muted small">— pul bo'yicha (tannarxda)</span></h2>
          ${biggest.length ? hbars(biggest, (r) => (r.x.value ? money(r.x.value) : `${C.fmtNum(r.x.metr)} m`), (r) => `${r.label}\n${C.fmtNum(r.x.rolls)} rulon · ${C.fmtNum(r.x.metr)} m\n${cur()}${C.fmtMoney(r.x.value)}`) : empty("Skladda tovar yo'q")}
        </section>
        <section class="card flush">
          <h2 class="card-title pad">Skladlar</h2>
          <div class="table-wrap"><table class="grid"><thead><tr><th>Sklad</th><th class="num">Qoldiq</th><th class="num">Qiymati</th><th class="num">Davrdagi sotuv</th></tr></thead><tbody>
            ${whRows.map((r) => `<tr class="click" data-wh="${r.w.id}"><td>${esc(r.w.name)}</td><td class="num nowrap">${stockHtml({ rolls: C.r2(r.rolls), metr: C.r2(r.metr) })}</td>
              <td class="num">${money(r.value)}</td><td class="num">${money(r.sold)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
      </div>`;

    $$('#x-metric button').forEach((b) => { b.onclick = () => { xf.metric = b.dataset.m; drawStats(); }; });
    $$('#x-body [data-p]').forEach((el) => {
      el.onclick = () => productHistoryModal(find(db.products, el.dataset.p));
      el.onkeydown = (e) => { if (e.key === 'Enter') el.click(); };
    });
    $$('#x-body tr[data-wh]').forEach((tr) => { tr.onclick = () => { wf.wh = tr.dataset.wh; wf.q = ''; location.hash = '#/skladlar'; }; });
    bindTips($('#x-body'));
  }

  // Grafik ustiga sichqoncha yoki klaviatura bilan kelganda chiqadigan yozuv
  function bindTips(root) {
    let tip = $('#chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'chart-tip'; tip.className = 'chart-tip'; tip.hidden = true; document.body.appendChild(tip); }
    const show = (el) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
      const top = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
      tip.style.left = left + window.scrollX + 'px';
      tip.style.top = top + window.scrollY + 'px';
    };
    const hide = () => { tip.hidden = true; };
    root.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
    root.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) hide(); });
    root.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
    root.addEventListener('focusout', hide);
  }

  function isUsed(kind, id) {
    return db.docs.some((d) => {
      if (kind === 'wh') return d.warehouseId === id || d.toWarehouseId === id || d.items.some((it) => it.warehouseId === id);
      if (kind === 'person') return d.personId === id;
      return d.items.some((it) => it.productId === id);
    });
  }

  function productModal(p, presetName) {
    return new Promise((resolve) => {
      let result = null;
      const isNew = !p;
      const v = p || { name: presetName || '', rollM: '', cost: '', price: '' };
      const buttons = [{ label: 'Bekor', kind: 'ghost' }];
      if (!isNew && !isUsed('product', p.id)) {
        buttons.unshift({ label: "O'chirish", kind: 'danger-ghost', onClick: async (close) => {
          if (!(await confirmDelete("Tovarni o'chirish", `<p>«${esc(p.name)}» tovari o'chiriladi.</p>`))) return;
          db.products = db.products.filter((x) => x.id !== p.id); saveDb(); toast("Tovar o'chirildi"); close();
        } });
      }
      buttons.push({
        label: 'Saqlash', kind: 'primary', onClick: (close, el) => {
          const name = $('#m-name', el).value.trim().replace(/\s+/g, ' ');
          const err = $('#m-err', el);
          if (!name) { err.innerHTML = '<div class="msg err">Nomini yozing</div>'; return; }
          const dup = db.products.find((x) => x.id !== (p && p.id) && C.normName(x.name) === C.normName(name));
          if (dup) { err.innerHTML = `<div class="msg err">«${esc(dup.name)}» degan tovar allaqachon bor</div>`; return; }
          const data = { name, rollM: C.num($('#m-rollm', el).value), cost: C.num($('#m-cost', el).value), price: C.num($('#m-price', el).value) };
          if (isNew) { result = { id: C.uid(), ...data }; db.products.push(result); }
          else { Object.assign(p, data); p.archived = $('#m-arch', el).checked; result = p; }
          saveDb();
          toast(isNew ? "Tovar qo'shildi" : 'Saqlandi');
          close();
        },
      });
      openModal({
        title: isNew ? 'Yangi tovar' : 'Tovarni tahrirlash',
        focus: isNew ? (presetName ? '#m-rollm' : '#m-name') : '#m-name',
        enterButton: buttons.length - 1,
        onClose: () => resolve(result),
        buttons,
        body: `<div class="form-grid">
          <label class="f span2">Nomi<input id="m-name" value="${esc(v.name)}"></label>
          <label class="f">1 rulondagi metr<input id="m-rollm" inputmode="decimal" value="${esc(str(v.rollM))}" placeholder="masalan 50"></label>
          <span></span>
          <label class="f">Tushgan narx (tannarx)<span class="money-field">${cur() ? `<span class="cur in">${esc(cur())}</span>` : ''}<input id="m-cost" inputmode="decimal" value="${esc(str(v.cost))}"></span></label>
          <label class="f">Sotish narxi<span class="money-field">${cur() ? `<span class="cur in">${esc(cur())}</span>` : ''}<input id="m-price" inputmode="decimal" value="${esc(str(v.price))}"></span></label>
          ${isNew ? '' : `<label class="chk span2"><input type="checkbox" id="m-arch"${p.archived ? ' checked' : ''}> Arxivga olish (ro'yxatlarda ko'rinmaydi)</label>`}
          </div><div id="m-err"></div>
          ${!isNew && isUsed('product', p.id) ? '<p class="muted small">Bu tovar hujjatlarda ishlatilgan, shuning uchun o\'chirib bo\'lmaydi — faqat arxivga olish mumkin.</p>' : ''}`,
      });
    });
  }

  function entityModal(kind, item) {
    const isWh = kind === 'wh';
    const arr = () => (isWh ? db.warehouses : db.people);
    return new Promise((resolve) => {
      let result = null;
      const isNew = !item;
      const v = item || { name: '', phone: '', note: '' };
      const buttons = [{ label: 'Bekor', kind: 'ghost' }];
      if (!isNew) {
        buttons.unshift({ label: "O'chirish", kind: 'danger-ghost', onClick: async (close) => {
          if (isWh) {
            const refs = db.docs.filter((d) => d.warehouseId === item.id || d.toWarehouseId === item.id || d.items.some((it) => it.warehouseId === item.id));
            close();
            const warn = refs.length
              ? `<p>«${esc(item.name)}» skladida <b>${refs.length} ta hujjat</b> bor. Skladni o'chirsangiz, <b>shu hujjatlar ham butunlay o'chadi</b> va ularning qoldiqqa ta'siri yo'qoladi.</p>`
              : `<p>«${esc(item.name)}» skladi o'chiriladi.</p>`;
            const ok = await confirmDelete("Skladni o'chirish", warn);
            if (!ok) { routes.skladlar(); return; }
            if (refs.length) {
              const ids = new Set(refs.map((d) => d.id));
              db.docs = db.docs.filter((d) => !ids.has(d.id));
            }
            db.warehouses = db.warehouses.filter((x) => x.id !== item.id);
            saveDb(); toast("Sklad o'chirildi"); routes.skladlar();
            return;
          }
          const pDocs = db.docs.filter((d) => d.personId === item.id);
          const pPays = (db.payments || []).filter((pm) => pm.personId === item.id);
          const extra = (pDocs.length || pPays.length)
            ? `<p>Shu bilan birga <b>${pDocs.length} ta hujjat (tovar)</b> va <b>${pPays.length} ta to'lov</b> ham o'chadi.</p>` : '';
          if (!(await confirmDelete("Do'konni o'chirish", `<p>«${esc(item.name)}» do'koni o'chiriladi.</p>${extra}`))) return;
          const did = new Set(pDocs.map((d) => d.id));
          db.docs = db.docs.filter((d) => !did.has(d.id));
          db.payments = (db.payments || []).filter((pm) => pm.personId !== item.id);
          db.people = db.people.filter((x) => x.id !== item.id);
          saveDb(); toast("O'chirildi"); close();
        } });
      }
      buttons.push({
        label: 'Saqlash', kind: 'primary', onClick: (close, el) => {
          const name = $('#e-name', el).value.trim().replace(/\s+/g, ' ');
          const err = $('#e-err', el);
          if (!name) { err.innerHTML = '<div class="msg err">Nomini yozing</div>'; return; }
          if (arr().some((x) => x.id !== (item && item.id) && C.normName(x.name) === C.normName(name))) {
            err.innerHTML = '<div class="msg err">Bu nom allaqachon bor</div>'; return;
          }
          const data = { name };
          if (!isWh) {
            data.phone = $('#e-phone', el).value.trim(); data.note = $('#e-note', el).value.trim();
            const kEl = el.querySelector('input[name="e-kind"]:checked');
            data.kind = kEl && kEl.value === 'own' ? 'own' : 'other';
          }
          if (isNew) { result = { id: C.uid(), ...data }; arr().push(result); }
          else { Object.assign(item, data); item.archived = $('#e-arch', el).checked; result = item; }
          saveDb();
          close();
        },
      });
      openModal({
        title: isNew ? (isWh ? 'Yangi sklad' : "Yangi do'kon") : (isWh ? 'Skladni tahrirlash' : "Do'konni tahrirlash"),
        focus: '#e-name', enterButton: buttons.length - 1, onClose: () => resolve(result), buttons,
        body: `<div class="form-grid">
          <label class="f span2">${isWh ? 'Sklad nomi' : "Do'kon nomi"}<input id="e-name" value="${esc(v.name)}"></label>
          ${isWh ? '' : `<div class="f span2">Do'kon turi
            <div class="kindseg" id="e-kind">
              <label class="kindseg-opt"><input type="radio" name="e-kind" value="other"${personKind(v) !== 'own' ? ' checked' : ''}><span class="seg-t">Birovniki</span><span class="seg-s">narx + bizning foyda</span></label>
              <label class="kindseg-opt"><input type="radio" name="e-kind" value="own"${personKind(v) === 'own' ? ' checked' : ''}><span class="seg-t">O'zimizniki</span><span class="seg-s">faqat tushgan narx</span></label>
            </div></div>
          <label class="f">Telefon<input id="e-phone" value="${esc(v.phone || '')}"></label><label class="f">Izoh<input id="e-note" value="${esc(v.note || '')}"></label>`}
          ${isNew ? '' : `<label class="chk span2"><input type="checkbox" id="e-arch"${item.archived ? ' checked' : ''}> Arxivga olish</label>`}
          </div><div id="e-err"></div>`,
      });
    });
  }

  // ---------- Sozlamalar ----------
  routes.sozlamalar = function renderSettings() {
    const active = db.docs.filter((d) => !d.cancelled).length;
    main.innerHTML = `
      <div class="page-head"><h1>Sozlamalar</h1></div>
      <section class="card">
        <h2 class="card-title">Umumiy</h2>
        <div class="fields plain"><label class="f">Pul belgisi<input id="st-cur" value="${esc(cur())}" style="width:90px"></label></div>
      </section>
      <section class="card">
        <h2 class="card-title">Zaxira nusxa</h2>
        <p class="muted">Hozircha ma'lumotlar shu brauzerning o'zida saqlanadi (${active} ta hujjat, ${db.products.length} ta tovar).
          Brauzer tozalansa yo'qolishi mumkin — vaqti-vaqti bilan zaxira faylini yuklab oling.</p>
        <div class="actions left">
          <button class="btn primary" id="st-backup">Zaxira faylini yuklab olish</button>
          <label class="btn">Zaxiradan tiklash<input type="file" id="st-restore" accept=".json,application/json" hidden></label>
        </div>
      </section>
      <section class="card danger-zone">
        <h2 class="card-title">Xavfli amallar</h2>
        <div class="actions left">
          <button class="btn danger-ghost" id="st-demo">Sentr qoldig'ini qaytadan yuklash</button>
          <button class="btn danger-ghost" id="st-wipe">Hamma ma'lumotni o'chirish</button>
        </div>
        <p class="muted small">Ikkala amal ham hozirgi hamma ma'lumotni o'chiradi${cloud ? ' — <b>bulutdan ham</b>' : ''}. Avval zaxira oling.</p>
      </section>`;
    if (cloud) {
      main.querySelector('section.card').insertAdjacentHTML('afterend', `
        <section class="card">
          <h2 class="card-title">Bulut (Supabase)</h2>
          <p>Kirgan akkaunt: <b>${esc(window.Sync.info().email)}</b></p>
          <p id="st-sync" class="muted"></p>
          <p class="muted small">Har bir akkauntning ma'lumoti alohida. Boshqa akkauntga o'tish uchun «Chiqish» qilib, o'sha email bilan kiring.</p>
          <div class="actions left">
            <button class="btn" id="st-syncnow">Hozir sinxronlash</button>
            <button class="btn danger-ghost" id="st-logout">Chiqish / boshqa akkauntga o'tish</button>
          </div>
        </section>`);
      renderSyncStatus(window.Sync.info());
      $('#st-syncnow').onclick = () => window.Sync.syncNow();
      $('#st-logout').onclick = logout;
    }
    $('#st-cur').onchange = (e) => { db.settings.currency = e.target.value.trim(); saveDb(); toast('Saqlandi'); };
    $('#st-backup').onclick = () => download(`sklad-zaxira-${C.today()}.json`, JSON.stringify(db, null, 1), 'application/json');
    $('#st-restore').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (err) { data = null; }
        if (!data || !Array.isArray(data.docs) || !Array.isArray(data.products) || !Array.isArray(data.warehouses)) {
          toast("Bu fayl zaxira fayli emas"); return;
        }
        const ok = await confirmModal('Zaxiradan tiklash',
          `<p>Fayldagi ma'lumot: ${data.docs.length} ta hujjat, ${data.products.length} ta tovar.</p><p>Hozirgi ma'lumotlar <b>shu fayldagisi bilan almashtiriladi</b>. Davom etasizmi?</p>`, 'Tiklash', 'danger');
        if (!ok) return;
        db = data;
        db.settings = db.settings || { currency: '$' };
        form = null;
        saveDb();
        toast('Tiklandi');
        route();
      };
      reader.readAsText(file);
    };
    $('#st-demo').onclick = () => typedConfirm("Sentr qoldig'ini qaytadan yuklash", () => {
      db = C.buildDemoDb(window.SEED);
      form = null; saveDb(); toast('Yuklandi'); location.hash = '#/qoldiq';
    });
    $('#st-wipe').onclick = () => typedConfirm("Hamma ma'lumotni o'chirish", () => {
      db = C.emptyDb();
      db.warehouses = DEFAULT_WAREHOUSES.map((name) => ({ id: C.uid(), name }));
      form = null; saveDb(); toast("O'chirildi"); location.hash = '#/yangi';
    });
  };

  function typedConfirm(title, onOk) {
    const WORD = 'TASDIQLAYMAN';
    openModal({
      title,
      body: `<p>Hozirgi barcha hujjatlar, tovarlar va do'konlar o'chadi. Buni ortga qaytarib bo'lmaydi.</p>
        <label class="f">Davom etish uchun <b>${WORD}</b> deb yozing<input id="tc-in" autocomplete="off"></label><div id="tc-err"></div>`,
      focus: '#tc-in', enterButton: 1,
      buttons: [{ label: 'Bekor', kind: 'ghost' }, {
        label: 'Bajarish', kind: 'danger', onClick: (close, el) => {
          if ($('#tc-in', el).value.trim().toUpperCase() !== WORD) { $('#tc-err', el).innerHTML = `<div class="msg err">${WORD} deb yozing</div>`; return; }
          close(); onOk();
        },
      }],
    });
  }

  // ---------- Bulut: kirish, chiqish, holat ----------
  const SYNC_TEXT = {
    idle: '',
    syncing: 'Saqlanmoqda…',
    ok: 'Bulutga saqlandi ✓',
    offline: "Internet yo'q — ma'lumot shu qurilmada, internet kelganda yuboriladi",
    error: 'Bulutga yuborib bo\'lmadi',
  };

  function renderSyncStatus(info) {
    let text = SYNC_TEXT[info.status] || '';
    if ((info.status === 'offline' || info.status === 'error') && info.pending) text += ` (${info.pending} ta o'zgarish kutmoqda)`;
    const foot = $('#side-foot');
    if (foot) {
      foot.hidden = !cloud;
      foot.innerHTML = `<div class="sync s-${info.status}">${esc(text)}</div><div class="muted small ell">${esc(info.email || '')}</div>`;
    }
    $('#side-toggle').dataset.sync = info.status;
    const stEl = $('#st-sync');
    if (stEl) {
      stEl.textContent = text + (info.status === 'error' && info.error ? ` — ${info.error}` : '') +
        (info.lastOk ? ` · oxirgi marta: ${info.lastOk.toLocaleTimeString('ru-RU')}` : '');
    }
  }

  function loginError(err) {
    const m = String((err && err.message) || err || '');
    if (/invalid login credentials/i.test(m)) return "Email yoki parol noto'g'ri";
    if (/email not confirmed/i.test(m)) return 'Email tasdiqlanmagan — Supabase\'da foydalanuvchini tasdiqlang';
    if (/already registered|already exists|user_already/i.test(m)) return 'Bu email allaqachon ro\'yxatdan o\'tgan — «Orqaga — kirish» qiling';
    if (/password.*(6|at least|short|weak)/i.test(m)) return 'Parol kamida 6 ta belgidan bo\'lsin';
    if (/signups? (not allowed|disabled)/i.test(m)) return 'Yangi akkaunt ochish o\'chirilgan — Supabase sozlamasidan yoqing';
    if (/fetch|network|failed/i.test(m)) return "Internet yo'q yoki Supabase'ga ulanib bo'lmadi";
    return m || 'Kirib bo\'lmadi';
  }

  function showLogin(msg) {
    document.body.classList.add('logged-out');
    main.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'login-wrap';
    wrap.id = 'login';
    let mode = 'in'; // 'in' = kirish, 'up' = yangi akkaunt
    wrap.innerHTML = `<form class="login card">
      <div class="login-brand"><span class="logo">S</span>Sklad hisobi</div>
      <p class="muted" id="l-note">Email va parol bilan kiring.</p>
      <label class="f">Email<input type="email" id="l-email" autocomplete="username" required></label>
      <label class="f">Parol<input type="password" id="l-pass" autocomplete="current-password" required></label>
      <div id="l-err">${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}</div>
      <button class="btn primary" type="submit" id="l-btn">Kirish</button>
      <button type="button" class="btn ghost" id="l-switch">Yangi akkaunt ochish</button>
    </form>`;
    document.body.appendChild(wrap);
    $('#l-email', wrap).focus();
    const applyMode = () => {
      $('#l-note', wrap).textContent = mode === 'in'
        ? 'Email va parol bilan kiring.'
        : "Yangi akkaunt uchun email va parol o'ylab toping (akangiz alohida akkaunt ochadi).";
      $('#l-btn', wrap).textContent = mode === 'in' ? 'Kirish' : 'Ochish';
      $('#l-pass', wrap).setAttribute('autocomplete', mode === 'in' ? 'current-password' : 'new-password');
      $('#l-switch', wrap).textContent = mode === 'in' ? 'Yangi akkaunt ochish' : "Orqaga — kirish";
      $('#l-err', wrap).innerHTML = '';
    };
    $('#l-switch', wrap).onclick = () => { mode = mode === 'in' ? 'up' : 'in'; applyMode(); };
    $('form', wrap).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#l-btn', wrap);
      const email = $('#l-email', wrap).value.trim();
      const pass = $('#l-pass', wrap).value;
      btn.disabled = true;
      btn.textContent = mode === 'in' ? 'Kirilmoqda…' : 'Ochilmoqda…';
      try {
        if (mode === 'up') {
          const r = await window.Sync.signUp(email, pass);
          if (r.needsConfirm) {
            $('#l-err', wrap).innerHTML = '<div class="msg ok">Akkaunt ochildi. Emailingizga tasdiqlash xati keldi — tasdiqlab, keyin «Kirish» qiling.</div>';
            mode = 'in'; applyMode();
            btn.disabled = false; btn.textContent = 'Kirish';
            return;
          }
        } else {
          await window.Sync.signIn(email, pass);
        }
        wrap.remove();
        document.body.classList.remove('logged-out');
        await startCloud();
      } catch (err) {
        $('#l-err', wrap).innerHTML = `<div class="msg err">${esc(loginError(err))}</div>`;
        btn.disabled = false;
        btn.textContent = mode === 'in' ? 'Kirish' : 'Ochish';
      }
    };
  }

  async function startCloud() {
    main.innerHTML = '<div class="empty">Bulut bilan bog\'lanmoqda…</div>';
    let plan;
    try {
      plan = await window.Sync.prepare();
    } catch (e) {
      main.innerHTML = `<div class="card"><div class="msg err">Bulutga ulanib bo'lmadi: ${esc(loginError(e))}</div>
        <button class="btn primary" id="cloud-retry">Qayta urinish</button></div>`;
      $('#cloud-retry').onclick = startCloud;
      return;
    }
    if (plan === 'upload') {
      const ok = await confirmModal("Bulut bo'sh",
        `<p>Sizning bulutdagi bazangiz hali bo'sh.</p><p>Shu qurilmadagi ma'lumot — <b>${db.products.length} ta tovar, ${db.docs.length} ta hujjat</b> — bulutga yuklansinmi?</p>
         <p class="muted small">«Bekor» bossangiz, bo'sh baza bilan boshlanadi.</p>`, 'Ha, yuklash');
      if (!ok) {
        db = C.emptyDb();
        db.warehouses = DEFAULT_WAREHOUSES.map((name) => ({ id: C.uid(), name }));
        writeLocal();
      }
      main.innerHTML = '<div class="empty">Bulutga yuklanmoqda…</div>';
      try { await window.Sync.upload(); } catch (e) { toast("Hammasi yuklanmadi — internet kelganda o'zi davom etadi"); }
    } else if (plan === 'download') {
      // Shu qurilmadagi eski ma'lumot nusxasi saqlanib qoladi (ehtiyot uchun)
      try { localStorage.setItem(STORE_KEY + '-oldin', JSON.stringify(db)); } catch (e) { /* joy yetmasa ham davom etamiz */ }
      main.innerHTML = '<div class="empty">Bulutdan yuklanmoqda…</div>';
      try {
        await window.Sync.download();
      } catch (e) {
        main.innerHTML = `<div class="card"><div class="msg err">Bulutdan yuklab bo'lmadi: ${esc(loginError(e))}</div>
          <button class="btn primary" id="cloud-retry">Qayta urinish</button></div>`;
        $('#cloud-retry').onclick = startCloud;
        return;
      }
      db.settings = db.settings || { currency: '$' };
      form = null;
    } else {
      window.Sync.syncNow();
    }
    start();
    setInterval(() => window.Sync.syncNow(), 30000);
    window.addEventListener('online', () => window.Sync.syncNow());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) window.Sync.syncNow(); });
  }

  async function logout() {
    await window.Sync.syncNow();
    const pending = window.Sync.info().pending;
    const ok = await confirmModal('Chiqish', pending
      ? `<p><b>${pending} ta o'zgarish hali bulutga yuborilmagan.</b> Chiqsangiz ular yo'qoladi.</p><p>Baribir chiqasizmi?</p>`
      : '<p>Hisobdan chiqasizmi? Ma\'lumot bulutda saqlanib qoladi.</p>', 'Chiqish', pending ? 'danger' : 'primary');
    if (!ok) return;
    await window.Sync.signOut();
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* e'tiborsiz */ }
    location.hash = '';
    location.reload();
  }

  // ---------- Ishga tushirish ----------
  let cloud = false;
  let started = false;

  function start() {
    if (!started) { started = true; window.addEventListener('hashchange', route); }
    route();
  }

  async function init() {
    db = loadDb();
    let firstRun = false;
    if (!db || !Array.isArray(db.docs)) {
      if (window.SEED) db = C.buildDemoDb(window.SEED);
      else { db = C.emptyDb(); db.warehouses = DEFAULT_WAREHOUSES.map((name) => ({ id: C.uid(), name })); }
      firstRun = true;
      writeLocal();
    }
    db.settings = db.settings || { currency: '$' };
    buildNav();
    setupSide();
    updateStorageBanner();
    cloud = !!(window.Sync && window.Sync.configured());
    if (!cloud) {
      start();
      if (firstRun && window.SEED) toast("Sentr qoldig'i boshlang'ich kirim sifatida yuklandi");
      return;
    }
    window.Sync.init({
      getDb: () => db,
      setDb: (x) => { db = x; },
      emptyDb: () => C.emptyDb(),
      persist: writeLocal,
      onRemoteChange: refreshAfterRemote,
    }, window.SKLAD_TEST_CLIENT);
    window.Sync.onStatus(renderSyncStatus);
    let user = null;
    try { user = await window.Sync.currentUser(); } catch (e) { user = null; }
    if (!user) { showLogin(); return; }
    await startCloud();
  }

  init();
})();
