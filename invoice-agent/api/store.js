const { put, get, list } = require('@vercel/blob');
const mem = globalThis.__invoiceA2AStoreCache || (globalThis.__invoiceA2AStoreCache = new Map());
function key(path) { return `a2a/v3/${path}`; }
async function read(path) {
  const p = key(path);
  try {
    const r = await get(p, { access: 'private' });
    if (!r || r.statusCode !== 200) return null;
    const value = JSON.parse(await new Response(r.stream).text());
    mem.set(p, value);
    return value;
  } catch (e) {
    return mem.has(p) ? mem.get(p) : null;
  }
}
async function write(path, value) {
  const p = key(path);
  mem.set(p, value);
  await put(p, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 0 });
  return value;
}
async function listJson(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: key(prefix), limit: 1000, cursor });
    for (const b of (r.blobs || [])) {
      const x = await read(b.pathname.slice('a2a/v3/'.length));
      if (x) out.push(x);
    }
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
module.exports = { read, write, listJson };
