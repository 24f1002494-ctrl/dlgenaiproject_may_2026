const crypto = require('node:crypto');
const { read } = require('./store');
const handler = require('./agent-final');

const canon = v => Array.isArray(v)
  ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object'
    ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
    : JSON.stringify(v);
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : canon(v)).digest('hex');
const principal = req => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([^\s]+)$/);
  return m ? hash(m[1]) : null;
};
const idemPath = (p, id) => `principals/${p}/idem/${encodeURIComponent(id)}`;

module.exports = async function(req, res) {
  let body = req.body;
  if (body == null && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    try { body = JSON.parse(raw); } catch (_) { body = null; }
    req.body = body;
  }

  // A duplicate messageId is an idempotent replay. Return the already-created
  // task even if a client retries with a byte-different wrapper/configuration.
  const p = principal(req);
  const mid = body?.message?.messageId;
  if (p && mid) {
    const existing = await read(idemPath(p, mid));
    if (existing?.task) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/a2a+json');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify(existing.task));
    }
  }

  // Restore the body for agent-final, which normally consumes req as its body.
  req.body = body;
  return handler(req, res);
};
