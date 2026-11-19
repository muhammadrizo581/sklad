// Hisob-kitob mantiqi: UI dan alohida, keyinchalik exe versiyasida ham shu fayl ishlatiladi.
(function (root) {
  'use strict';

  const TYPES = {
    // perLine: har bir qatorning o'z skladi bor
    chiqim:    { label: 'Chiqim',           short: 'Chiqim',   needsPerson: true,  needsPrice: true,  perLine: true },
    kirim:     { label: 'Kirim',            short: 'Kirim',    needsPerson: false, needsPrice: true,  perLine: true },
    qaytish:   { label: 'Qaytish',          short: 'Qaytish',  needsPerson: true,  needsPrice: true,  perLine: true },
    kochirish: { label: "Ko'chirish",       short: "Ko'chir.", needsPerson: false, needsPrice: false, perLine: false },
    tuzatish:  { label: 'Inventarizatsiya', short: 'Inventar', needsPerson: false, needsPrice: false, perLine: false },
  };

  const EPS = 0.0001;

  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function r4(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }

  // Numbers dagidek yozuvni hisoblaydi: "45+44+46", "45*4+44*5", "35,8+35,7", "137-10".
  // pieces — nechta rulon: har bir son bitta rulon, "45*4" esa 45 metrdan 4 ta rulon.
  function parseExpr(input) {
    const s = String(input == null ? '' : input).replace(/\s/g, '').replace(/,/g, '.')
      .replace(/[×xXхХ]/g, '*').replace(/^=/, '').replace(/[+\-*]+$/, '');
    if (!s) return { ok: true, value: 0, pieces: 0, isExpr: false };
    if (!/^[-+]?[\d.]+(\*[\d.]+)*([+-][\d.]+(\*[\d.]+)*)*$/.test(s)) return { ok: false, value: 0, pieces: 0, isExpr: true };
    let value = 0, pieces = 0, terms = 0;
    for (const m of s.matchAll(/([+-]?)([\d.*]+)/g)) {
      const sign = m[1] === '-' ? -1 : 1;
      const f = m[2].split('*').map(Number);
      if (f.some((x) => !isFinite(x))) return { ok: false, value: 0, pieces: 0, isExpr: true };
      value += sign * f.reduce((a, b) => a * b, 1);
      let count = 1;
      if (f.length === 2) {
        const ints = f.filter((x) => Number.isInteger(x));
        if (ints.length) count = Math.min(...ints);
      }
      pieces += sign * count;
      terms++;
    }
    return { ok: true, value: r4(value), pieces, isExpr: terms > 1 || /\*/.test(s) };
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    return parseExpr(v).value;
  }

  // Qatordagi jami rulon: butun rulonlar + lintodagi rulonlar
  function itemRolls(it) {
    return r2(num(it.rolls) + num(it.lintoRolls));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function normName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function emptyDb() {
    return {
      version: 1,
      seq: 0,
      settings: { currency: '$' },
      products: [],
      warehouses: [],
      people: [],
      docs: [],
      payments: [],
    };
  }

  function lineMetr(it) {
    return r2(num(it.rolls) * num(it.rollM) + num(it.linto));
  }

  function lineSum(it) {
    return r2(num(it.metr) * num(it.price));
  }

  // Qatorning skladi (eski yozuvlarda sklad faqat hujjatda turadi)
  function itemWh(doc, it) {
    return it.warehouseId || doc.warehouseId;
  }

  // Hujjatdagi skladlar ro'yxati (takrorlanmasdan)
  function docWarehouses(doc) {
    return Array.from(new Set(doc.items.map((it) => itemWh(doc, it)).filter(Boolean)));
  }

  // Hujjatning qoldiqqa ta'siri: [{warehouseId, productId, rolls, metr}]
  function docEffects(doc) {
    // skipStock: faqat do'kon hisobiga yoziladi, sklad qoldig'iga tegmaydi (masalan fayldan yuklangan o'z do'koni ro'yxati)
    if (doc.skipStock) return [];
    const out = [];
    const push = (w, it, sign) => out.push({
      warehouseId: w, productId: it.productId,
      rolls: sign * itemRolls(it), metr: sign * num(it.metr), sum: sign * num(it.sum),
    });
    for (const it of doc.items) {
      switch (doc.type) {
        case 'kirim':
        case 'qaytish':
          push(itemWh(doc, it), it, +1); break;
        case 'chiqim':
          push(itemWh(doc, it), it, -1); break;
        case 'kochirish':
          push(itemWh(doc, it), it, -1);
          push(doc.toWarehouseId, it, +1); break;
        case 'tuzatish':
          push(itemWh(doc, it), it, +1); break; // item.metr bu yerda farq (+/-)
      }
    }
    return out;
  }

  function stockKey(w, p) { return w + '|' + p; }

  function computeStock(db, opts) {
    const excludeDocId = opts && opts.excludeDocId;
    const map = new Map();
    for (const doc of db.docs) {
      if (doc.cancelled || doc.id === excludeDocId) continue;
      for (const e of docEffects(doc)) {
        const k = stockKey(e.warehouseId, e.productId);
        const cur = map.get(k) || { rolls: 0, metr: 0, sum: 0 };
        cur.rolls += e.rolls;
        cur.metr += e.metr;
        cur.sum += e.sum || 0;
        map.set(k, cur);
      }
    }
    for (const v of map.values()) { v.rolls = r2(v.rolls); v.metr = r2(v.metr); v.sum = r2(v.sum); }
    return map;
  }

  function getStock(stock, w, p) {
    return stock.get(stockKey(w, p)) || { rolls: 0, metr: 0, sum: 0 };
  }

  function docTotals(doc) {
    let metr = 0, sum = 0, rolls = 0;
    for (const it of doc.items) {
      metr += num(it.metr); sum += num(it.sum); rolls += itemRolls(it);
    }
    return { metr: r2(metr), sum: r2(sum), rolls: r2(rolls) };
  }

  // Saqlashdan oldin tekshirish. errors bo'lsa saqlanmaydi, warnings bo'lsa tasdiq so'raladi.
  function validateDoc(db, doc, opts) {
    const errors = [], warnings = [];
    const t = TYPES[doc.type];
    if (!t) { errors.push("Harakat turi noto'g'ri"); return { errors, warnings }; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date || '')) errors.push('Sana kiritilmagan');
    else if (doc.date > today()) warnings.push(`Sana kelajakda: ${fmtDate(doc.date)}`);
    if (!t.perLine && !doc.warehouseId) errors.push('Sklad tanlanmagan');
    if (t.needsPerson && !doc.personId) errors.push("Do'kon tanlanmagan");
    if (doc.type === 'kochirish') {
      if (!doc.toWarehouseId) errors.push('Qaysi skladga ko\'chirilishi tanlanmagan');
      else if (doc.toWarehouseId === doc.warehouseId) errors.push('Bir skladdan o\'sha skladga ko\'chirib bo\'lmaydi');
    }
    if (!doc.items.length) errors.push('Birorta ham tovar kiritilmagan');

    const pName = (id) => (db.products.find((p) => p.id === id) || {}).name || '?';
    const wName = (id) => (db.warehouses.find((w) => w.id === id) || {}).name || '?';
    doc.items.forEach((it, i) => {
      const n = `${i + 1}-qator`;
      if (t.perLine && !itemWh(doc, it)) errors.push(`${n}: sklad tanlanmagan`);
      if (!it.productId) { errors.push(`${n}: tovar tanlanmagan`); return; }
      if (doc.type === 'tuzatish') {
        if (Math.abs(num(it.metr)) < EPS) warnings.push(`${n} (${pName(it.productId)}): farq yo'q`);
        return;
      }
      if (num(it.metr) <= 0) errors.push(`${n} (${pName(it.productId)}): metr 0 yoki manfiy`);
      if (num(it.rolls) < 0 || num(it.linto) < 0) errors.push(`${n} (${pName(it.productId)}): manfiy son`);
      if (t.needsPrice && !(num(it.price) > 0)) errors.push(`${n} (${pName(it.productId)}): narx kiritilmagan`);
    });

    // Skladda yo'q narsani yoki borinidan ko'pini ayirib bo'lmaydi (rulon ham, metr ham)
    const adds = doc.type === 'kirim' || doc.type === 'qaytish' || doc.type === 'tuzatish';
    for (const pr of stockProblems(db, doc, opts && opts.excludeDocId)) {
      const name = `${pName(pr.productId)}: «${wName(pr.warehouseId)}» skladida`;
      const h = pr.have, a = pr.after;
      if (adds || h.metr < -EPS || h.rolls < -EPS) {
        errors.push(`${name} qoldiq minusga tushadi (${fmtNum(a.rolls)} rulon, ${fmtNum(a.metr)} m) — undan allaqachon chiqim qilingan`);
      } else if (h.metr <= EPS && h.rolls <= EPS) {
        errors.push(`${name} bu tovar yo'q`);
      } else {
        errors.push(`${name} ${fmtNum(h.rolls)} rulon (${fmtNum(h.metr)} m) bor — ${fmtNum(r2(h.rolls - a.rolls))} rulon (${fmtNum(r2(h.metr - a.metr))} m) ayirib bo'lmaydi`);
      }
    }
    return { errors, warnings };
  }

  // Hujjat saqlansa (yoki excludeId bekor qilinsa) qoldig'i minusga tushadigan tovarlar.
  // have — shu hujjatsiz qoldiq, after — hujjatdan keyingi qoldiq. Avvaldan minus bo'lganlar, agar yomonlashmasa, hisobga olinmaydi.
  function stockProblems(db, newDoc, excludeId) {
    const base = db.docs.filter((d) => d.id !== excludeId);
    const before = computeStock({ docs: base });
    const after = newDoc ? computeStock({ docs: base.concat(newDoc) }) : before;
    const current = computeStock(db);
    const old = excludeId ? db.docs.find((d) => d.id === excludeId) : null;
    const keys = new Set();
    for (const d of [newDoc, old]) {
      if (!d || d.cancelled) continue;
      for (const e of docEffects(d)) if (e.warehouseId && e.productId) keys.add(stockKey(e.warehouseId, e.productId));
    }
    const out = [];
    for (const k of keys) {
      const [w, p] = k.split('|');
      const a = getStock(after, w, p), c = getStock(current, w, p), b = getStock(before, w, p);
      // Rulon — asosiy o'lchov; metr taxminiy (har rulon ~ perRoll). Rulon to'g'ri bo'lsa,
      // metrdagi kichik farqga (taxminan bitta rulon uzunligicha) yo'l qo'yamiz.
      const perRoll = b.rolls > EPS ? b.metr / b.rolls : 0;
      const metrTol = Math.max(perRoll, 5);
      const rollBad = a.rolls < -EPS && a.rolls < c.rolls - EPS;
      const metrBad = a.metr < -metrTol && a.metr < c.metr - EPS;
      if (rollBad || metrBad) {
        out.push({ warehouseId: w, productId: p, have: b, after: a });
      }
    }
    return out;
  }

  // Odamning hisobi (AR faylidagi kabi): chiqim musbat, qaytish manfiy
  function personLines(db, personId, from, to) {
    const rows = [];
    for (const doc of db.docs) {
      if (doc.cancelled) continue;
      if (doc.personId !== personId) continue;
      if (doc.type !== 'chiqim' && doc.type !== 'qaytish') continue;
      if (from && doc.date < from) continue;
      if (to && doc.date > to) continue;
      const sign = doc.type === 'qaytish' ? -1 : 1;
      for (const it of doc.items) rows.push({ doc, item: it, sign });
    }
    rows.sort((a, b) => a.doc.date.localeCompare(b.doc.date) || a.doc.no - b.doc.no);
    return rows;
  }

  function productHistory(db, productId) {
    const rows = [];
    for (const doc of db.docs) {
      if (doc.cancelled) continue;
      for (const e of docEffects({ ...doc, items: doc.items.filter((it) => it.productId === productId) })) {
        rows.push({ doc, warehouseId: e.warehouseId, rolls: r2(e.rolls), metr: r2(e.metr) });
      }
    }
    rows.sort((a, b) => a.doc.date.localeCompare(b.doc.date) || a.doc.no - b.doc.no);
    return rows;
  }

  // Sentr.numbers dan olingan boshlang'ich ma'lumot
  function buildDemoDb(seed) {
    const db = emptyDb();
    const wh = ['Sentr', 'XBK', 'Orzu', 'Yangi yol', '80 metr', 'Uy'].map((name) => ({ id: uid(), name }));
    db.warehouses = wh;
    db.people = [{ id: uid(), name: 'Abdurahim aka', phone: '', note: '' }];
    const byKey = new Map();
    for (const p of seed.products) {
      const prod = { id: uid(), name: p.name, rollM: p.rollM, cost: p.cost, price: p.price || 0 };
      db.products.push(prod);
      byKey.set(normName(p.name), prod);
    }
    const items = seed.items.map((s) => {
      const it = { productId: byKey.get(s.key).id, warehouseId: wh[0].id, rolls: s.rolls, rollM: s.rollM, linto: 0, price: s.cost };
      it.metr = lineMetr(it);
      it.sum = lineSum(it);
      return it;
    });
    db.seq = 1;
    db.docs.push({
      id: uid(), no: 1, type: 'kirim', date: today(), warehouseId: wh[0].id,
      note: "Boshlang'ich qoldiq (Sentr.numbers dan)", items, createdAt: new Date().toISOString(),
    });
    return db;
  }

  function fmtNum(x, digits) {
    const d = digits === undefined ? 2 : digits;
    const n = Number(x) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/ /g, ' ');
  }

  function fmtMoney(x) {
    const n = Number(x) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  root.Core = {
    TYPES, r2, r4, num, parseExpr, itemRolls, stockProblems, uid, today, normName, emptyDb, lineMetr, lineSum, itemWh, docWarehouses, docEffects,
    computeStock, getStock, docTotals, validateDoc, personLines, productHistory,
    buildDemoDb, fmtNum, fmtMoney, fmtDate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
