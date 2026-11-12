// 테스트용 메모리 supabase mock (실DB 미사용)
// opts.unique: { table: [['col1','col2'], ...] }  opts.cascade: { parentTable: [[childTable, fkCol], ...] }
function makeDb(seed, opts) {
  opts = opts || {};
  const tables = Object.assign({}, seed);
  const seq = {};
  const clone = o => JSON.parse(JSON.stringify(o));
  const uniq = opts.unique || {};
  const cascade = opts.cascade || {};
  function violates(table, row, ignoreRow) {
    return (uniq[table] || []).some(cols => (tables[table] || []).some(r => r !== ignoreRow && cols.every(c => String(r[c]) === String(row[c]))));
  }
  function removeRows(table, rows) {
    tables[table] = (tables[table] || []).filter(r => !rows.includes(r));
    (cascade[table] || []).forEach(([child, fk]) => {
      const kids = (tables[child] || []).filter(k => rows.some(p => String(p.id) === String(k[fk])));
      if (kids.length) removeRows(child, kids);
    });
  }
  function q(table) {
    if (!tables[table]) tables[table] = [];
    const st = { conds: [], op: 'select', payload: null, single: false, maybe: false, order: null, limit: null, onConflict: null };
    const match = r => st.conds.every(fn => fn(r));
    const run = async () => {
      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const staged = [];
        for (const p of arr) {
          const row = Object.assign({ id: (seq[table] = (seq[table] || 0) + 1) }, clone(p));
          if (violates(table, row) || staged.some(s => (uniq[table] || []).some(cols => cols.every(c => String(s[c]) === String(row[c])))))
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          staged.push(row);
        }
        tables[table].push(...staged);
        return { data: clone(staged), error: null };
      }
      if (st.op === 'upsert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const keys = String(st.onConflict || 'id').split(',');
        for (const p of arr) {
          const ex = tables[table].find(r => keys.every(k => String(r[k]) === String(p[k])));
          if (ex) Object.assign(ex, clone(p)); else tables[table].push(Object.assign({ id: (seq[table] = (seq[table] || 0) + 1) }, clone(p)));
        }
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        const rows = tables[table].filter(match);
        for (const r of rows) { const nr = Object.assign({}, r, st.payload); if (violates(table, nr, r)) return { data: null, error: { code: '23505', message: 'duplicate key' } }; }
        rows.forEach(r => Object.assign(r, clone(st.payload)));
        return { data: null, error: null };
      }
      if (st.op === 'delete') { const rows = tables[table].filter(match); removeRows(table, rows); return { data: null, error: null, count: rows.length }; }
      let out = tables[table].filter(match).map(clone);
      if (st.order) { const [k, asc] = st.order; out.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1)); }
      if (st.limit != null) out = out.slice(0, st.limit);
      if (st.single || st.maybe) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      eq(k, v) { st.conds.push(r => String(r[k]) === String(v)); return b; },
      neq(k, v) { st.conds.push(r => String(r[k]) !== String(v)); return b; },
      in(k, vs) { const s = vs.map(String); st.conds.push(r => s.includes(String(r[k]))); return b; },
      like(k, p) { st.conds.push(r => String(r[k]).startsWith(p.replace(/%$/, ''))); return b; },
      is(k, v) { st.conds.push(r => (r[k] === undefined ? null : r[k]) === v); return b; },
      order(k, o) { st.order = [k, !o || o.ascending !== false]; return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; }, maybeSingle() { st.maybe = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      upsert(p, o) { st.op = 'upsert'; st.payload = p; st.onConflict = o && o.onConflict; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    return b;
  }
  const removed = [];
  return { from: q, tables, removed, storage: { from: () => ({ remove: async (paths) => { removed.push(...paths); return { error: null }; } }) } };
}
module.exports = { makeDb };
