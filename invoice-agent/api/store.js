const { put, get, list, del } = require('@vercel/blob');
const mem = globalThis.__invoiceA2AStoreCache || (globalThis.__invoiceA2AStoreCache = new Map());
const NAMESPACE = 'a2a/v5';
function key(path) { return `${NAMESPACE}/${path}`; }
async function read(path) {
  const p = key(path);
  try {
    const r = await get(p, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const value = JSON.parse(await new Response(r.stream).text());
    mem.set(p, value);
    return value;
  } catch (e) { return mem.has(p) ? mem.get(p) : null; }
}
async function write(path, value) {
  const p = key(path);
  await put(p, JSON.stringify(value), { access:'private', addRandomSuffix:false, allowOverwrite:true, contentType:'application/json', cacheControlMaxAge:60 });
  mem.set(p, value); return value;
}
async function claim(path, value) {
  const p = key(`locks/${path}`);
  try {
    await put(p, JSON.stringify({ ...value, at:Date.now() }), { access:'private', addRandomSuffix:false, allowOverwrite:false, contentType:'application/json', cacheControlMaxAge:60 });
    return true;
  } catch (e) {
    try {
      const r = await get(p,{access:'private',useCache:false});
      if (r && r.statusCode===200 && r.stream) {
        const held=JSON.parse(await new Response(r.stream).text());
        const at=Number(held && (held.at ?? held.t))||0;
        if (at && Date.now()-at>60000) {
          await del(p,{access:'private'});
          await put(p,JSON.stringify({...value,at:Date.now()}),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',cacheControlMaxAge:60});
          return true;
        }
      }
    } catch (_) {}
    return false;
  }
}
async function release(path) { try { await del(key(`locks/${path}`),{access:'private'}); } catch(e) {} }
async function listJson(prefix) {
  const out=[]; let cursor;
  do {
    const r=await list({prefix:key(prefix),limit:1000,cursor});
    for(const b of (r.blobs||[])) { const x=await read(b.pathname.slice(`${NAMESPACE}/`.length)); if(x) out.push(x); }
    cursor=r.hasMore?r.cursor:undefined;
  } while(cursor);
  return out;
}
globalThis.saveTask=async(principal,task)=>write(`principals/${principal}/tasks/${task.id}`,task);
module.exports={read,write,claim,release,listJson};
