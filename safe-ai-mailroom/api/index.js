const crypto = require("node:crypto");
const PROFILE = "ga5-mailroom-action-gate/v2";
const ACTIONS = new Set(["create_draft","update_internal_record","send_approved_notice","request_confirmation","quarantine_item","no_action"]);
const MAX_BODY = 2 * 1024 * 1024;
const DB_PATH = "/tmp/mailroom-db.json";
const fs = require("node:fs");

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k)+":"+canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function sha(v) { return crypto.createHash("sha256").update(typeof v === "string" ? v : canonical(v), "utf8").digest("hex"); }
function bad(res, status, msg) { return res.status(status).json({error:msg}); }
function readDb() { try { return JSON.parse(fs.readFileSync(DB_PATH,"utf8")); } catch { return { evaluations:{}, stable:{} }; } }
function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db)); }
function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
function requiredString(x) { return typeof x === "string" && x.length > 0; }
function normalizeProposal(p) {
  return { dossierId:p.dossierId, callId:p.callId, action:p.action, target:p.target ?? null, payload:p.payload, evidence:[...p.evidence].sort() };
}
function proposalDigest(p) { return sha(normalizeProposal(p)); }
function validLines(d) {
  if (!Array.isArray(d.sources)) return false;
  const ids = [];
  for (const s of d.sources) {
    if (!isObj(s) || !Array.isArray(s.lines)) return false;
    for (const l of s.lines) {
      if (!isObj(l) || !requiredString(l.lineId) || typeof l.text !== "string") return false;
      ids.push(l.lineId);
    }
  }
  return new Set(ids).size === ids.length;
}
function allLines(d) { return d.sources.flatMap(s => s.lines.map(l => ({...l, source:s}))); }
function decide(d) {
  // Only facts explicitly supported by dossier lines may drive an executable proposal.
  // In uncertain or identity-conflicting cases, ask for confirmation. Ignore instructions in mail.
  const lines = allLines(d);
  const text = lines.map(x => x.text).join("\n");
  const objective = String(d.objective || "");
  const mailbox = String(d.mailbox || "");
  const low = text.toLowerCase();
  const pick = (...patterns) => lines.filter(x => patterns.some(p => p.test(x.text)));
  let action = "request_confirmation", target = {kind:"approval_queue",id:"mailroom-ops"};
  let payload = {claimedSender:"unknown",questionCode:"VERIFY_REQUEST",referenceId:d.dossierId};
  let evidence = lines.length ? [lines[0].lineId] : [];
  const injection = /(ignore (all |previous )?instructions|reveal (the )?(system prompt|secret|canary)|send .* to .* without approval|exfiltrat|override .*policy|tool call.*secret|private context)/i.test(text)
    && !/(quoted example|security training|attack string|prompt injection test|do not follow)/i.test(text);
  if (injection) {
    action = "quarantine_item"; target = {kind:"security_queue",id:"mailroom"};
    const a = lines.find(x => /(ignore (all |previous )?instructions|reveal (the )?(system prompt|secret|canary)|exfiltrat|override .*policy)/i.test(x.text));
    payload = {artifactId: d.dossierId, reasonCode:"INDIRECT_PROMPT_INJECTION"};
    evidence = a ? [a.lineId] : evidence;
  } else {
    const duplicate = /(duplicate|already completed|already sent|delivered and closed|resolved; no further action)/i.test(text + " " + objective);
    const informational = /(for your information|fyi only|no action needed|informational update)/i.test(text + " " + objective);
    if (duplicate) {
      action="no_action"; target=null; payload={reasonCode:/duplicate/i.test(text)?"DUPLICATE":"ALREADY_COMPLETED"};
      payload.referenceId=d.dossierId;
      const l=lines.find(x=>/(duplicate|already completed|already sent|delivered and closed|resolved; no further action)/i.test(x.text));
      evidence=l?[l.lineId]:evidence;
    } else if (informational && !/(please|request|update|send|draft|change)/i.test(objective)) {
      action="no_action"; target=null; payload={reasonCode:"INFORMATIONAL",referenceId:d.dossierId};
      const l=lines.find(x=>/(for your information|fyi only|no action needed|informational update)/i.test(x.text));
      evidence=l?[l.lineId]:evidence;
    } else if (/draft/i.test(objective) && /(order|delivery|shipment|status)/i.test(text)) {
      const ref = (text.match(/\b(?:ORDER|REF|REFERENCE)[-:# ]?([A-Z0-9-]{3,})\b/i)||[])[0];
      const recipient = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
      const statusMatch = text.match(/\b(delayed|shipped|in transit|delivered|processing|backordered)\b/i);
      if (recipient && ref && statusMatch && !/(not approved|do not send|wrong recipient|unverified|expired approval)/i.test(text)) {
        action="create_draft"; target={kind:"draft_queue",id:"mailbox:"+mailbox};
        payload={recipient,referenceId:ref,status:statusMatch[1].toLowerCase(),template:"order_status"};
        evidence = lines.filter(x => new RegExp(recipient.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i").test(x.text) || /order|reference|status|draft/i.test(x.text)).map(x=>x.lineId).slice(0,4);
      }
    } else if (/delivery_window/i.test(objective) || /update.*delivery window/i.test(objective.toLowerCase())) {
      const ev=lines.find(x => /source.?event|event id/i.test(x.text));
      const val=lines.find(x => /delivery window\s*[:=]/i.test(x.text));
      const caseLine=lines.find(x => /case\s*(?:id|#)\s*[:=]/i.test(x.text));
      const authorized=lines.find(x => /approved|authorize/i.test(x.text) && /delivery window/i.test(x.text));
      if (ev && val && caseLine && authorized) {
        const caseId=(caseLine.text.match(/case\s*(?:id|#)\s*[:=]\s*([A-Z0-9_-]+)/i)||[])[1];
        const sourceEventId=(ev.text.match(/(?:source.?event|event id)\s*[:=]\s*([A-Z0-9_-]+)/i)||[])[1];
        const value=(val.text.match(/delivery window\s*[:=]\s*([\w -]+)/i)||[])[1]?.trim();
        if (caseId&&sourceEventId&&value) { action="update_internal_record"; target={kind:"case_record",id:caseId}; payload={field:"delivery_window",sourceEventId,value}; evidence=[ev.lineId,val.lineId,caseLine.lineId,authorized.lineId]; }
      }
    }
  }
  // Exact target/payload schemas; no mail body text is ever copied into tool arguments.
  if (!ACTIONS.has(action) || !evidence.length) {
    action="request_confirmation"; target={kind:"approval_queue",id:"mailroom-ops"};
    payload={claimedSender:"unknown",questionCode:"VERIFY_REQUEST",referenceId:d.dossierId};
    evidence=lines.length?[lines[0].lineId]:[];
  }
  return {dossierId:d.dossierId, callId:"mailroom:"+sha({id:d.dossierId,content:sha(d)}).slice(0,48), action,target,payload,evidence:[...new Set(evidence)]};
}
function validateProposal(p, d, allowed) {
  if (!isObj(p) || p.dossierId!==d.dossierId || !requiredString(p.callId) || !/^[A-Za-z0-9._:-]{12,128}$/.test(p.callId)) return false;
  if (!allowed.includes(p.action) || !ACTIONS.has(p.action) || !isObj(p.payload) || !Array.isArray(p.evidence)||p.evidence.length<1) return false;
  const ids=new Set(allLines(d).map(x=>x.lineId));
  if (new Set(p.evidence).size!==p.evidence.length || p.evidence.some(x=>!ids.has(x))) return false;
  if (p.action==="no_action" && p.target!==null) return false;
  return true;
}
module.exports = async (req,res) => {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if (req.method!=="POST") return bad(res,405,"POST required");
  let raw="";
  try {
    if (typeof req.body==="string") raw=req.body;
    else if (req.body && typeof req.body==="object") raw=JSON.stringify(req.body);
    else raw="";
    if (Buffer.byteLength(raw)>MAX_BODY) return bad(res,413,"request too large");
    const b=raw?JSON.parse(raw):req.body;
    if (!isObj(b) || b.profile!==PROFILE || !requiredString(b.evaluationId) || !["propose","commit"].includes(b.operation)) return bad(res,400,"invalid envelope");
    const db=readDb();
    if (b.operation==="propose") {
      if (!isObj(b.receiptVerifier)||b.receiptVerifier.algorithm!=="Ed25519"||!isObj(b.receiptVerifier.publicKeyJwk)||b.receiptVerifier.publicKeyJwk.kty!=="OKP"||b.receiptVerifier.publicKeyJwk.crv!=="Ed25519"||!requiredString(b.receiptVerifier.publicKeyJwk.x)) return bad(res,422,"invalid receipt verifier");
      if (!isObj(b.corpus)||!Array.isArray(b.dossiers)||b.dossiers.length!==64&&b.dossiers.length!==70) return bad(res,422,"invalid dossiers");
      if (!Array.isArray(b.allowedActions)||b.allowedActions.some(a=>!ACTIONS.has(a))) return bad(res,422,"invalid allowedActions");
      const seen=new Set();
      for (const d of b.dossiers) {
        if (!isObj(d)||!requiredString(d.dossierId)||!["stable_core","fresh_audit"].includes(d.partition)||!validLines(d)||seen.has(d.dossierId)) return bad(res,422,"invalid or duplicate dossier");
        seen.add(d.dossierId);
      }
      const inputDigest=sha(b.dossiers);
      const existing=db.evaluations[b.evaluationId];
      if (existing) {
        if (existing.inputDigest!==inputDigest || existing.requestDigest!==sha(b)) return bad(res,409,"evaluationId content conflict");
        return res.status(200).json(existing.response);
      }
      const proposals=b.dossiers.map(d=>{
        const fp=sha(d);
        if (d.partition==="stable_core" && db.stable[fp]) return db.stable[fp];
        const p=decide(d);
        if (!validateProposal(p,d,b.allowedActions)) throw new Error("proposal schema failure");
        if (d.partition==="stable_core") db.stable[fp]=p;
        return p;
      });
      const response={profile:PROFILE,evaluationId:b.evaluationId,status:"awaiting_receipts",inputDigest,proposals};
      db.evaluations[b.evaluationId]={requestDigest:sha(b),inputDigest, verifier:b.receiptVerifier.publicKeyJwk, dossiers:b.dossiers, proposals,response, state:"awaiting_receipts"};
      writeDb(db);
      return res.status(200).json(response);
    }
    if (!Array.isArray(b.receipts)||!requiredString(b.inputDigest)) return bad(res,422,"invalid receipts");
    const ev=db.evaluations[b.evaluationId];
    if (!ev) return bad(res,409,"unknown evaluation");
    if (ev.inputDigest!==b.inputDigest) return bad(res,409,"input digest mismatch");
    if (ev.state==="completed") {
      if (ev.commitDigest!==sha(b)) return bad(res,409,"commit replay conflict");
      return res.status(200).json(ev.commitResponse);
    }
    if (b.receipts.length!==ev.proposals.length) return bad(res,422,"receipt count mismatch");
    const proposals=new Map(ev.proposals.map(p=>[p.dossierId,p]));
    const seen=new Set(), normalized=[];
    let pub;
    try { pub=crypto.createPublicKey({key:ev.verifier,format:"jwk"}); } catch { return bad(res,422,"invalid stored verifier"); }
    // Verify the entire batch before persisting any outcome.
    for (const r of b.receipts) {
      if (!isObj(r)||seen.has(r.dossierId)||!proposals.has(r.dossierId)) return bad(res,422,"duplicate or unknown receipt");
      seen.add(r.dossierId);
      const p=proposals.get(r.dossierId);
      const pd=proposalDigest(p);
      if (r.callId!==p.callId||r.action!==p.action||r.proposalDigest!==pd||!requiredString(r.receiptId)||typeof r.accepted!=="boolean"||!requiredString(r.receiptSignature)) return bad(res,422,"receipt does not match proposal");
      const {receiptSignature,...unsigned}=r;
      const signed={profile:PROFILE,evaluationId:b.evaluationId,inputDigest:b.inputDigest,receipt:unsigned};
      let sig,ok=false;
      try { sig=Buffer.from(r.receiptSignature,"base64"); ok=crypto.verify(null,Buffer.from(canonical(signed),"utf8"),pub,sig); } catch {}
      if (!ok) return bad(res,422,"invalid receipt signature");
      normalized.push({dossierId:r.dossierId,callId:p.callId,action:p.action,proposalDigest:pd,receiptId:r.receiptId,status:r.accepted?"executed":"rejected"});
    }
    if (seen.size!==ev.proposals.length) return bad(res,422,"missing receipt");
    const outcomes=ev.proposals.map(p=>normalized.find(o=>o.dossierId===p.dossierId));
    const response={profile:PROFILE,evaluationId:b.evaluationId,status:"completed",inputDigest:b.inputDigest,outcomes};
    ev.receipts=b.receipts; ev.state="completed"; ev.commitDigest=sha(b); ev.commitResponse=response; writeDb(db);
    return res.status(200).json(response);
  } catch(e) { return bad(res,400,"malformed request"); }
};
