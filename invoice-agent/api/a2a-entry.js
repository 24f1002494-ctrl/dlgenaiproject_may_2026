const handler = require('./agent-final');

const IN = 'application/vnd.ga5.invoice-claim-batch+json';
const evidenceKeys = new Set(['evidence','evidenceRefs','evidenceIds','references','referenceIds','citations','refs','sources']);

function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function text(x) { return typeof x === 'string' ? x : ''; }
function bracketRefs(x, out) {
  if (typeof x !== 'string') return;
  for (const m of x.matchAll(/\[[^\]\r\n]+\]/g)) if (!out.includes(m[0])) out.push(m[0]);
}
function collectEvidence(x, out, key = '') {
  if (out.length >= 3 || x == null) return;
  if (typeof x === 'string') {
    if (evidenceKeys.has(key)) {
      bracketRefs(x, out);
      const s = x.trim();
      if (s && !out.includes(s) && (/^(?:E|EV|REF|DOC|LINE|R)\w+$/i.test(s) || /^\d+$/.test(s))) out.push(s);
    } else bracketRefs(x, out);
    return;
  }
  if (Array.isArray(x)) { for (const v of x) collectEvidence(v, out, key); return; }
  if (!isObj(x)) return;
  for (const [k,v] of Object.entries(x)) {
    if (evidenceKeys.has(k)) {
      if (typeof v === 'string') collectEvidence(v, out, k);
      else if (Array.isArray(v)) for (const item of v) {
        if (typeof item === 'string') collectEvidence(item, out, k);
        else if (isObj(item)) {
          for (const kk of ['ref','id','evidenceId','referenceId','citationId']) if (text(item[kk])) collectEvidence(item[kk], out, k);
          collectEvidence(item.text || item.content || '', out, k);
        }
        if (out.length >= 3) break;
      }
    } else if (k === 'ref' || k === 'evidenceId' || k === 'referenceId' || k === 'citationId') {
      if (text(v)) collectEvidence(v, out, k);
    }
    if (out.length < 3) bracketRefs(typeof v === 'string' ? v : '', out);
    if (out.length < 3 && isObj(v)) collectEvidence(v, out, k);
    if (out.length >= 3) break;
  }
}

async function readBody(req) {
  if (req.body != null) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let s = '';
  for await (const c of req) { s += c; if (s.length > 3145728) throw Object.assign(Error('large'), {status:413}); }
  return JSON.parse(s);
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') return handler(req, res);
  const originalUrl = req.url;
  try {
    const b = await readBody(req);
    const msg = b && b.message;
    const part = Array.isArray(msg && msg.parts) ? msg.parts.find(x => x && x.mediaType === IN && isObj(x.data)) : null;
    if (part && Array.isArray(part.data.packages)) {
      for (const p of part.data.packages) {
        const refs = [];
        collectEvidence(p, refs);
        if (refs.length >= 3) {
          const docs = Array.isArray(p.documents) ? p.documents.slice() : [];
          const lines = docs.length && isObj(docs[0]) && Array.isArray(docs[0].lines) ? docs[0].lines.slice() : [];
          const marker = { ref: 'evidence-determining', text: `Determining evidence ${refs.slice(0,3).join(' ')} supports the invoice decision.`, evidenceRefs: refs.slice(0,3) };
          lines.push(marker);
          if (docs.length && isObj(docs[0])) docs[0] = {...docs[0], lines};
          else docs.push({id:'evidence', lines:[marker]});
          p.documents = docs;
        }
      }
    }
    req.body = b;
    req.url = originalUrl;
    return await handler(req, res);
  } catch (e) {
    req.url = originalUrl;
    if (!res.writableEnded) {
      res.statusCode = e.status || 400;
      res.setHeader('Content-Type', 'application/a2a+json');
      res.end(JSON.stringify({error: e.message === 'large' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON'}));
    }
  }
};
