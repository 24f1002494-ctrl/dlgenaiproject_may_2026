const { put, get, list, del } = require('@vercel/blob');
const mem = globalThis.__invoiceA2AStoreCache || (globalThis.__invoiceA2AStoreCache = new Map());
function key(path) { return `a2a/v3/${path}`; }
async function read(path) {
  const p = key(path);
  try {
    const r = await get(p, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
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
  await put(p, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
  return value;
}
async function claim(path, value) {
  const p = key(`locks/${path}`);
  try {
    await put(p, JSON.stringify(value), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
    return true;
  } catch (e) {
    return false;
  }
}
async function release(path) {
  const p = key(`locks/${path}`);
  try { await del(p, { access: 'private' }); } catch (e) {}
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
module.exports = { read, write, claim, release, listJson };
