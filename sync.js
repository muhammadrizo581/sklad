// Supabase bilan sinxronlash. Ma'lumot avval shu qurilmada saqlanadi, keyin bulutga yuboriladi:
// internet bo'lmasa ham ishlayveradi, internet kelganda o'zgarishlar yuboriladi.
(function (root) {
  'use strict';

  const TABLES = ['warehouses', 'products', 'people', 'docs', 'payments'];
  const META_KEY = 'sklad-sync-v1';
  const CHUNK = 400;
  const PAGE = 1000;

  // Bulutda bu jadval hali ochilmagan bo'lsa — sinxron buzilmasin, o'sha jadvalni o'tkazib yuboramiz
  function missingTable(err) {
    if (!err) return false;
    if (err.code === '42P01' || err.code === 'PGRST205') return true;
    return /does not exist|could not find the table|schema cache/i.test(err.message || '');
  }

  // Kalitlar tartibidan qat'i nazar bir xil matn (Postgres jsonb kalitlarni o'zicha tartiblaydi)
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  const hashOf = (o) => hash(stable(o));
  const settingsData = (db) => Object.assign({}, db.settings, { seq: db.seq || 0 });

  const st = {
    client: null, user: null, meta: null, hooks: null,
    timer: null, running: false, again: false,
    status: 'idle', error: '', pending: 0, lastOk: null, listeners: [],
  };

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)); } catch (e) { return null; }
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(st.meta)); } catch (e) { /* keyingi safar qayta yuboriladi */ }
  }
  function freshMeta(userId) {
    return { userId, lastPull: null, snap: { warehouses: {}, products: {}, people: {}, docs: {}, payments: {}, settings: null } };
  }

  function setStatus(status, error) {
    st.status = status;
    st.error = error || '';
    if (status === 'ok') st.lastOk = new Date();
    st.listeners.forEach((f) => f(Sync.info()));
  }

  // Bulutdagidan farq qiladigan yozuvlar soni (yuborilmaganlar)
  function countPending() {
    const db = st.hooks.getDb(), snap = st.meta.snap;
    let n = 0;
    for (const t of TABLES) {
      const s = snap[t] || (snap[t] = {});
      const ids = new Set();
      for (const o of db[t] || []) { ids.add(o.id); if (s[o.id] !== hashOf(o)) n++; }
      for (const id of Object.keys(s)) if (!ids.has(id)) n++;
    }
    if (snap.settings !== hashOf(settingsData(db))) n++;
    return n;
  }

  async function check(res) {
    if (res.error) throw res.error;
    return res;
  }

  // Bir vaqtda ikki qurilmada yangi hujjat yozilsa raqam to'qnashadi — yangilarini bulutdagi eng katta raqamdan keyinga suramiz
  async function renumberNewDocs(newDocs) {
    const res = await check(await st.client.from('docs').select('no').eq('owner_id', st.user.id).order('no', { ascending: false }).limit(1));
    const db = st.hooks.getDb();
    let max = Math.max(db.seq || 0, res.data.length ? res.data[0].no || 0 : 0);
    newDocs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const d of newDocs) d.no = ++max;
    db.seq = max;
    st.hooks.persist();
    st.hooks.onRemoteChange();
  }

  async function push(attempt) {
    const db = st.hooks.getDb(), snap = st.meta.snap, uid = st.user.id;
    for (const t of TABLES) {
      if (!snap[t]) snap[t] = {};
      let skip = false;
      const ids = new Set();
      const changed = [];
      for (const o of db[t] || []) {
        ids.add(o.id);
        const h = hashOf(o);
        if (snap[t][o.id] !== h) changed.push({ o, h });
      }
      for (let i = 0; i < changed.length && !skip; i += CHUNK) {
        const part = changed.slice(i, i + CHUNK);
        const res = await st.client.from(t).upsert(part.map(({ o }) => ({ owner_id: uid, id: o.id, data: o, deleted: false })), { onConflict: 'owner_id,id' });
        if (res.error) {
          if (missingTable(res.error)) { skip = true; break; }
          if (t === 'docs' && res.error.code === '23505' && (attempt || 0) < 3) {
            await renumberNewDocs(part.map((x) => x.o).filter((o) => snap.docs[o.id] === undefined));
            return push((attempt || 0) + 1);
          }
          throw res.error;
        }
        for (const { o, h } of part) snap[t][o.id] = h;
        saveMeta();
      }
      if (skip) continue;
      const removed = Object.keys(snap[t]).filter((id) => !ids.has(id));
      for (let i = 0; i < removed.length; i += CHUNK) {
        const part = removed.slice(i, i + CHUNK);
        const res = await st.client.from(t).update({ deleted: true }).eq('owner_id', uid).in('id', part);
        if (res.error) { if (missingTable(res.error)) break; throw res.error; }
        for (const id of part) delete snap[t][id];
        saveMeta();
      }
    }
    const s = settingsData(db);
    const sh = hashOf(s);
    if (snap.settings !== sh) {
      await check(await st.client.from('settings').upsert({ owner_id: uid, id: 'main', data: s, deleted: false }, { onConflict: 'owner_id,id' }));
      snap.settings = sh;
      saveMeta();
    }
  }

  // Bulutdagi o'zgarishlarni olib, shu qurilmadagiga qo'shadi. Qaytaradi: nechta yozuv o'zgardi
  async function pull() {
    const db = st.hooks.getDb(), snap = st.meta.snap, uid = st.user.id;
    const since = st.meta.lastPull;
    let newest = since, changed = 0;
    for (const t of TABLES.concat('settings')) {
      if (t !== 'settings' && !snap[t]) snap[t] = {};
      let tableGone = false;
      for (let from = 0; !tableGone; from += PAGE) {
        let q = st.client.from(t).select('id,data,deleted,updated_at').eq('owner_id', uid)
          .order('updated_at', { ascending: true }).range(from, from + PAGE - 1);
        // 5 soniya ustma-ust olamiz: bir paytda yozilgan yozuvlar tushib qolmasin
        if (since) q = q.gte('updated_at', new Date(new Date(since).getTime() - 5000).toISOString());
        const res = await q;
        if (res.error) { if (missingTable(res.error)) { tableGone = true; break; } throw res.error; }
        const data = res.data;
        for (const row of data) {
          if (!newest || row.updated_at > newest) newest = row.updated_at;
          if (t === 'settings') {
            const s = row.data || {};
            const before = hashOf(settingsData(db));
            db.seq = Math.max(db.seq || 0, s.seq || 0);
            const rest = Object.assign({}, s);
            delete rest.seq;
            // Shu qurilmada yuborilmagan sozlama o'zgarishi bo'lsa, o'shanisi qoladi
            if (snap.settings === null || snap.settings === before) db.settings = Object.assign({}, db.settings, rest);
            snap.settings = hashOf(s);
            if (hashOf(settingsData(db)) !== before) changed++;
            continue;
          }
          const list = db[t] || (db[t] = []);
          const idx = list.findIndex((x) => x.id === row.id);
          const localHash = idx >= 0 ? hashOf(list[idx]) : null;
          const localDirty = idx >= 0 && snap[t][row.id] !== undefined && localHash !== snap[t][row.id];
          if (row.deleted) {
            if (idx >= 0) { list.splice(idx, 1); changed++; }
            delete snap[t][row.id];
            continue;
          }
          const remoteHash = hashOf(row.data);
          if (localDirty) { snap[t][row.id] = remoteHash; continue; } // shu qurilmadagi tahrir yuboriladi
          if (localHash === remoteHash) { snap[t][row.id] = remoteHash; continue; }
          if (idx >= 0) list[idx] = row.data; else list.push(row.data);
          snap[t][row.id] = remoteHash;
          changed++;
        }
        if (data.length < PAGE) break;
      }
    }
    st.meta.lastPull = newest;
    saveMeta();
    return changed;
  }

  async function syncNow() {
    if (!st.user || !st.meta) return;
    if (st.running) { st.again = true; return; }
    st.running = true;
    setStatus('syncing');
    try {
      await push();
      const changed = await pull();
      st.pending = countPending();
      st.hooks.persist();
      setStatus('ok');
      if (changed) st.hooks.onRemoteChange();
    } catch (e) {
      st.pending = countPending();
      const msg = String((e && e.message) || '');
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|network|load failed/i.test(msg);
      setStatus(offline ? 'offline' : 'error', (e && (e.message || e.error_description)) || String(e));
    } finally {
      st.running = false;
      if (st.again) { st.again = false; Sync.schedule(200); }
    }
  }

  async function remoteIsEmpty() {
    for (const t of TABLES) {
      const res = await st.client.from(t).select('id', { count: 'exact', head: true }).eq('owner_id', st.user.id).eq('deleted', false);
      if (res.error) { if (missingTable(res.error)) continue; throw res.error; }
      if (res.count) return false;
    }
    return true;
  }

  const Sync = {
    configured() {
      const c = root.SKLAD_CONFIG || {};
      return !!(c.supabaseUrl && c.supabaseAnonKey && root.supabase && root.supabase.createClient);
    },

    // hooks: getDb, setDb, emptyDb, persist (faqat shu qurilmaga yozish), onRemoteChange
    init(hooks, client) {
      st.hooks = hooks;
      const c = root.SKLAD_CONFIG || {};
      st.client = client || root.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sklad-auth' },
      });
    },

    async currentUser() {
      const { data } = await st.client.auth.getSession();
      st.user = data && data.session ? data.session.user : null;
      return st.user;
    },

    async signIn(email, password) {
      const { data, error } = await st.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      st.user = data.user;
      return st.user;
    },

    // Yangi akkaunt ochish. session qaytsa — darhol kirdi; qaytmasa — email tasdiqlash kerak
    async signUp(email, password) {
      const { data, error } = await st.client.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session) { st.user = data.user; return { user: st.user, needsConfirm: false }; }
      return { user: null, needsConfirm: true };
    },

    async signOut() {
      try { await st.client.auth.signOut(); } catch (e) { /* internet bo'lmasa ham chiqamiz */ }
      st.user = null;
      st.meta = null;
      try { localStorage.removeItem(META_KEY); } catch (e) { /* e'tiborsiz */ }
      setStatus('idle');
    },

    // Kirgandan keyin: 'ready' — davom etamiz; 'upload' — bulut bo'sh; 'download' — bulutda ma'lumot bor, shu qurilmada yo'q
    async prepare() {
      const meta = loadMeta();
      if (meta && meta.userId === st.user.id && meta.snap) {
        st.meta = meta;
        for (const t of TABLES) if (!st.meta.snap[t]) st.meta.snap[t] = {};
        return 'ready';
      }
      const empty = await remoteIsEmpty();
      st.meta = freshMeta(st.user.id);
      return empty ? 'upload' : 'download';
    },

    // Shu qurilmadagi hamma ma'lumotni bulutga yuborish
    async upload() {
      saveMeta();
      await syncNow();
      if (st.status !== 'ok') throw new Error(st.error || 'Yuklab bo\'lmadi');
    },

    // Shu qurilmadagini tashlab, bulutdagini olish
    async download() {
      st.hooks.setDb(st.hooks.emptyDb());
      st.meta = freshMeta(st.user.id);
      await pull();
      st.pending = 0;
      st.hooks.persist();
      setStatus('ok');
    },

    schedule(delay) {
      if (!st.meta) return;
      clearTimeout(st.timer);
      st.timer = setTimeout(syncNow, delay === undefined ? 800 : delay);
    },

    // Shaxsiy link uchun: loginsiz, token bo'yicha ochiq o'qish (Supabase RPC)
    async shareGet(token) {
      const c = root.SKLAD_CONFIG || {};
      if (!st.client) {
        if (!(c.supabaseUrl && c.supabaseAnonKey && root.supabase && root.supabase.createClient)) return null;
        st.client = root.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false } });
      }
      const { data, error } = await st.client.rpc('share_get', { p_token: token });
      if (error) throw error;
      return data || null;
    },

    syncNow,
    onStatus(f) { st.listeners.push(f); },
    info() { return { status: st.status, error: st.error, pending: st.pending, lastOk: st.lastOk, email: st.user ? st.user.email : '' }; },
    get user() { return st.user; },
    _stable: stable,
  };

  root.Sync = Sync;
})(typeof window !== 'undefined' ? window : globalThis);
