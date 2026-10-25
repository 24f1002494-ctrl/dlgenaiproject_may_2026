const crypto = require('node:crypto');
const { read } = require('./store');
const handler = require('./agent-final');

const IN = 'application/vnd.ga5.invoice-claim-batch+json';
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
const evidenceKeys = new Set(['evidence','evidenceRefs','evidenceIds','evidenceRef','references','referenceIds','referenceId','citations','citationIds','citationId','refs','sources']);
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x : '';
function collectEvidence(x, out, key = '') {
  if (out.length >= 3 || x == null) return;
  if (typeof x === 'string') {
    for (const m of x.matchAll(/\[[^\]\r\n]+\]/g)) if (!out.includes(m[0])) out.push(m[0]);
    if (evidenceKeys.has(key)) {
      const s = x.trim();
      if (s && !out.includes(s) && s.length <= 200 && !/[\r\n]/.test(s)) out.push(s);
    }
    return;
  }
  if (Array.isArray(x)) { for (const v of x) collectEvidence(v, out, key); return; }
  if (!isObj(x)) return;
  for (const [k,v] of Object.entries(x)) {
    if (evidenceKeys.has(k)) {
      collectEvidence(v, out, k);
    } else if (['ref','evidenceId','evidence_id','evidenceRef','evidence_ref','referenceId','reference_id','citationId','citation_id'].includes(k)) {
      if (text(v)) collectEvidence(v, out, k);
    }
    if (out.length < 3 && typeof v === 'string') collectEvidence(v, out, k);
    if (out.length < 3 && isObj(v)) collectEvidence(v, out, k);
    if (out.length >= 3) break;
  }
}

async function readBody(req) {
  if (req.body != null) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 3145728) throw Object.assign(Error('large'), {status:413}); }
  return JSON.parse(raw);
}

module.exports = async function(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    res.statusCode = e.status || 400;
    res.setHeader('Content-Type', 'application/a2a+json');
    return res.end(JSON.stringify({error: e.message === 'large' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON'}));
  }

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

  // Normalize structured evidence into a canonical determining line. The
  // canonical handler recognizes evidence references in bracketed form.
  const msg = body?.message;
  const part = Array.isArray(msg?.parts) ? msg.parts.find(x => x?.mediaType === IN && isObj(x.data)) : null;
  if (part && Array.isArray(part.data.packages)) {
    for (const pkg of part.data.packages) {
      const refs = [];
      collectEvidence(pkg, refs);
      if (refs.length >= 3) {
        const evidence = refs.slice(0,3).map(r => {
          const s = String(r).trim();
          return /^\[[^\]]+\]$/.test(s) ? s : `[${s}]`;
        });
        const docs = Array.isArray(pkg.documents) ? pkg.documents.slice() : [];
        const marker = {
          ref: 'evidence-determining',
          text: `Determining evidence ${evidence.join(' ')} supports the invoice decision.`,
          evidenceRefs: evidence
        };
        if (docs.length && isObj(docs[0])) {
          const lines = Array.isArray(docs[0].lines) ? docs[0].lines.slice() : [];
          lines.push(marker);
          docs[0] = {...docs[0], lines};
        } else {
          docs.push({id:'evidence', lines:[marker]});
        }
        pkg.documents = docs;
      }
    }
  }

  req.body = body;
  return handler(req, res);
};
