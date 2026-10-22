const crypto = require("node:crypto");
const { get, put } = require("@vercel/blob");

const PROFILE = "ga5-mailroom-action-gate/v2";
const ACTIONS = ["create_draft", "update_internal_record", "send_approved_notice", "request_confirmation", "quarantine_item", "no_action"];
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RESPONSE = 512 * 1024;

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
function sha(v) {
  return crypto.createHash("sha256").update(typeof v === "string" ? v : canonical(v), "utf8").digest("hex");
}
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function str(v) { return typeof v === "string" && v.trim().length > 0; }
function exactKeys(obj, keys) {
  return isObj(obj) && Object.keys(obj).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
}
function send(res, status, value) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE) {
    res.statusCode = 500;
    return res.end(JSON.stringify({error:"response too large"}));
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(body);
}
function fail(res, status, message) { return send(res, status, {error:message}); }

function evalKey(id) { return "mailroom/evaluations/" + sha(id) + ".json"; }
function stableKey(d) { return "mailroom/stable/" + sha({dossierId:d.dossierId, fingerprint:sha(d)}) + ".json"; }
async function loadJson(pathname) {
  const result = await get(pathname, {access:"private"});
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const body = await new Response(result.stream).text();
  return JSON.parse(body);
}
async function saveJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access:"private", addRandomSuffix:false, allowOverwrite:true, contentType:"application/json"
  });
}
function allLines(d) { return d.sources.flatMap(source => source.lines.map(line => ({...line, source}))); }
function trustedSource(source) {
  const m = [source.kind, source.provenance, source.title].join(" ").toLowerCase();
  return /(trusted|verified|signed|internal|policy|crm|case record|case_record|approval|fulfillment event|system record|authorized)/i.test(m)
    && !/(untrusted|unverified|customer supplied|customer email|external sender)/i.test(m);
}
function externalSource(source) {
  return /(customer.?email|inbound.?mail|external.?email|attachment|customer.?message|web.?form|external.?sender)/i.test([source.kind,source.provenance,source.title].join(" "));
}
function quotedAttack(line, source) {
  const t = line.toLowerCase();
  const context = [source.kind,source.provenance,source.title].join(" ").toLowerCase();
  const reported = /(quoted example|security training|attack string|prompt injection test|do not follow|example of (an )?attack|security review|incident report|reported attempt|malicious email said|this email contains|contains the phrase|test fixture|quoted text)/i.test(t)
    || /(security review|incident report|security training|test fixture|prompt injection benchmark|threat analysis)/i.test(context);
  return reported && (trustedSource(source) || /(quoted|example|reported|test fixture|do not follow|security review|incident report)/i.test(t));
}
function injectionLine(line, source) {
  if (quotedAttack(line.text, source)) return false;
  const t = line.text.toLowerCase();
  const commands = [
    /ignore (all |any |the )?(previous |prior |above )?instructions/,
    /reveal (the )?(system prompt|hidden prompt|secret|canary|private context)/,
    /exfiltrat(e|ion)/,
    /override (the )?(safety|security|approval|mailroom|system) policy/,
    /(send|forward|email|export|upload).{0,100}(secret|canary|private context|without approval|unapproved recipient)/,
    /(call|invoke|use) (the )?(tool|function).{0,80}(secret|private|outside scope)/,
    /print.{0,30}(environment variables|api key|private key|credentials)/
  ];
  const hasDirective = commands.some(p => p.test(t));
  if (!hasDirective) return false;
  if (trustedSource(source) && !externalSource(source)) return false;
  return true;
}
function extractEmails(text) { return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []; }
function extractReference(lines) {
  for (const line of lines) {
    const t = line.text;
    const labelled = t.match(/\b(?:order|reference|ref|ticket|case|shipment|tracking|request|event)\s*(?:id|number|no\.?|#)?\s*[:=#-]\s*([A-Z0-9][A-Z0-9_-]{2,})\b/i);
    if (labelled) return {value:labelled[1], lineId:line.lineId};
  }
  for (const line of lines) {
    const found = line.text.match(/\b(?:ORD|ORDER|REF|CASE|TKT|SHIP|TRK|REQ|EVT)[-_][A-Z0-9][A-Z0-9_-]{2,}\b/i);
    if (found) return {value:found[0], lineId:line.lineId};
  }
  return null;
}
function extractStatus(lines) {
  for (const line of lines) {
    const m = line.text.match(/\bstatus\s*[:=]\s*([A-Za-z][A-Za-z_ -]{1,30})/i);
    if (m) {
      const v = m[1].split(/[;,.!]/)[0].trim().replace(/\s+/g, " ").toLowerCase();
      if (v && !/^(not approved|expired|unknown|unverified)$/.test(v)) return {value:v,lineId:line.lineId};
    }
  }
  const vocab = [
    ["out_for_delivery", /\bout for delivery\b/i], ["in_transit", /\bin[_ ]transit\b/i],
    ["backordered", /\bbackordered\b/i], ["delayed", /\bdelayed\b/i],
    ["shipped", /\bshipped\b/i], ["delivered", /\bdelivered\b/i],
    ["processing", /\bprocessing\b/i], ["cancelled", /\bcancelled\b/i], ["canceled", /\bcanceled\b/i]
  ];
  for (const [value,re] of vocab) {
    const line = lines.find(x => re.test(x.text));
    if (line) return {value,lineId:line.lineId};
  }
  return null;
}
function extractNamedValue(lines, label) {
  const re = new RegExp("\\b(?:" + label + ")\\s*[:=]\\s*([^;,\\.\\n]+)", "i");
  for (const line of lines) {
    const m = line.text.match(re);
    if (m) return {value:m[1].trim(),lineId:line.lineId};
  }
  return null;
}
function getApprovalQueue(lines) {
  const e = extractNamedValue(lines, "(?:owning\\s+team|approval\\s+queue|owner\\s+team|team)");
  if (e && e.value && e.value.length < 100) return e;
  return {value:"mailroom-ops",lineId:null};
}
function getSender(lines) {
  for (const line of lines) {
    const m = line.text.match(/^\s*(?:from|sender|claimed sender|customer email)\s*:\s*(.+?)\s*$/i);
    if (m) {
      const e = extractEmails(m[1])[0];
      return {value:e || m[1].trim(),lineId:line.lineId};
    }
  }
  return {value:"unknown",lineId:null};
}
function isDuplicateOrInfo(d, lines) {
  for (const line of lines) {
    if (trustedSource(line.source) && /(duplicate|already completed|already sent|delivery confirmed and closed|resolved;? no further action|status\s*[:=]\s*completed)/i.test(line.text)) {
      return {reason:/duplicate/i.test(line.text) ? "DUPLICATE" : "ALREADY_COMPLETED", lineId:line.lineId};
    }
  }
  if (/(no action needed|for information only|fyi only|informational update)/i.test(d.objective)) {
    const line = lines.find(x => /(no action needed|for information only|fyi only|informational update)/i.test(x.text));
    if (line) return {reason:"INFORMATIONAL",lineId:line.lineId};
  }
  return null;
}
function makeCallId(d) { return "mailroom:" + sha({dossierId:d.dossierId,fingerprint:sha(d)}).slice(0,48); }
function proposal(d, action, target, payload, evidence) {
  return {dossierId:d.dossierId,callId:makeCallId(d),action,target,payload,evidence:[...new Set(evidence)]};
}
function decide(d) {
  const lines = allLines(d);
  const ref = extractReference(lines);
  const mailbox = d.mailbox;
  const objective = d.objective.toLowerCase();

  // A trusted report that quotes an attack is not itself an attack. Quarantine only a
  // directive embedded in an untrusted item which attempts to control agent/tool behavior.
  for (const line of lines) {
    if (injectionLine(line, line.source)) {
      const named = extractNamedValue([line], "artifact\\s*id");
      const artifactId = named ? named.value : (line.source.sourceId || "");
      if (str(artifactId)) {
        return proposal(d,"quarantine_item",{kind:"security_queue",id:"mailroom"},
          {artifactId,reasonCode:"INDIRECT_PROMPT_INJECTION"},[line.lineId]);
      }
    }
  }

  const dup = isDuplicateOrInfo(d,lines);
  if (dup && ref) {
    return proposal(d,"no_action",null,{reasonCode:dup.reason,referenceId:ref.value},[...new Set([ref.lineId,dup.lineId].filter(Boolean))]);
  }

  // Internal changes need a trusted, current authorization for the exact field, plus
  // a case ID, source event ID and the exact new value.
  if (/delivery.?window/.test(objective) || /update.*delivery window/i.test(d.objective)) {
    const caseId = extractNamedValue(lines,"case\\s*(?:id|#)");
    const eventId = extractNamedValue(lines,"(?:source\\s*event\\s*id|event\\s*id)");
    const window = extractNamedValue(lines,"delivery\\s*window");
    const auth = lines.find(x => trustedSource(x.source)
      && /(approve|authorized|authorised|signed off)/i.test(x.text)
      && /delivery.?window/i.test(x.text)
      && !/(expired|revoked|superseded|rescinded|for a different case|wrong case)/i.test(x.text));
    if (caseId && eventId && window && auth && caseId.value && eventId.value && window.value) {
      const evidence = [caseId.lineId,eventId.lineId,window.lineId,auth.lineId];
      return proposal(d,"update_internal_record",{kind:"case_record",id:caseId.value},
        {field:"delivery_window",sourceEventId:eventId.value,value:window.value},evidence);
    }
  }

  // An outbound send is only proposed when a trusted approval scopes the exact
  // recipient, named template, reference and public status. Stale/expired approvals fail closed.
  const sendIntent = /\b(send|email|dispatch|issue)\b/i.test(d.objective) && /(notice|delivery|order|customer)/i.test(d.objective);
  if (sendIntent && ref) {
    const approval = lines.find(x => trustedSource(x.source)
      && /(approved|authorized|authorised|signed off)/i.test(x.text)
      && /approved_delivery_notice/i.test(x.text)
      && !/(expired|revoked|superseded|rescinded|different recipient|different template)/i.test(x.text));
    if (approval) {
      const emails = extractEmails(approval.text);
      const status = extractStatus(lines);
      const recipientMatch = approval.text.match(/(?:recipient|send to|approved for)\s*[:=]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      const recipient = recipientMatch ? recipientMatch[1] : (emails.length === 1 ? emails[0] : null);
      const exactFacts = /(?:public facts|facts approved|permitted facts|status)/i.test(approval.text) || (status && new RegExp(status.value.replace(/_/g,"[_ ]"),"i").test(approval.text));
      if (recipient && status && exactFacts) {
        const evidence = [approval.lineId,ref.lineId,status.lineId];
        return proposal(d,"send_approved_notice",{kind:"email",id:recipient},
          {referenceId:ref.value,status:status.value,template:"approved_delivery_notice"},evidence);
      }
    }
  }

  // Drafting is non-sending, but the recipient must come from an explicit sender/reply-to
  // header (or trusted customer record), not arbitrary text in the body.
  const draftIntent = /\b(draft|prepare a reply|prepare reply|compose a reply|create a draft)\b/i.test(d.objective);
  if (draftIntent && ref) {
    const recipientLine = lines.find(x => /^\s*(?:from|reply-to|customer email)\s*:/i.test(x.text)
      && extractEmails(x.text).length === 1
      && (externalSource(x.source) || trustedSource(x.source)));
    const internalRecipient = lines.find(x => trustedSource(x.source) && /^\s*(?:verified customer email|approved recipient|customer email)\s*:/i.test(x.text)
      && extractEmails(x.text).length === 1);
    const recLine = internalRecipient || recipientLine;
    const status = extractStatus(lines);
    const identityConflict = /(sender mismatch|identity conflict|unverified sender|spoofed|different customer|email mismatch)/i.test(lines.map(x=>x.text).join("\n"));
    const unsafeSend = /(send immediately|do not create a draft|send this instead|bypass approval)/i.test(lines.map(x=>x.text).join("\n"));
    if (recLine && status && !identityConflict && !unsafeSend) {
      const recipient=extractEmails(recLine.text)[0];
      const supporting=[recLine.lineId,ref.lineId,status.lineId];
      return proposal(d,"create_draft",{kind:"draft_queue",id:"mailbox:"+mailbox},
        {recipient,referenceId:ref.value,status:status.value,template:"order_status"},supporting);
    }
  }

  // If a sender identity, target, approval age, reference or requested field is ambiguous,
  // route for confirmation; never promote an untrusted email into authority.
  const sender = getSender(lines);
  const queue = getApprovalQueue(lines);
  const evidenceCandidates = [];
  if (sender.lineId) evidenceCandidates.push(sender.lineId);
  if (ref) evidenceCandidates.push(ref.lineId);
  const conflict = lines.find(x => /(identity conflict|sender mismatch|recipient mismatch|approval expired|expired approval|approval revoked|stale approval|scope mismatch|different recipient|wrong recipient|not authorized|not approved)/i.test(x.text));
  if (conflict) evidenceCandidates.push(conflict.lineId);
  if (evidenceCandidates.length === 0 && lines.length) evidenceCandidates.push(lines[0].lineId);
  if (evidenceCandidates.length === 0) {
    // Malformed/empty dossiers are rejected during schema validation before this function.
    return null;
  }
  return proposal(d,"request_confirmation",{kind:"approval_queue",id:queue.value},
    {claimedSender:sender.value,questionCode:"VERIFY_REQUEST",referenceId:ref ? ref.value : d.dossierId},
    [...new Set(evidenceCandidates)]);
}

function validateProposal(p,d,allowed) {
  if (!isObj(p) || !exactKeys(p,["dossierId","callId","action","target","payload","evidence"])) return false;
  if (p.dossierId!==d.dossierId || !str(p.callId) || !/^[A-Za-z0-9._:-]{12,128}$/.test(p.callId)) return false;
  if (!allowed.includes(p.action) || !Array.isArray(p.evidence) || p.evidence.length<1) return false;
  const ids = new Set(allLines(d).map(x=>x.lineId));
  if (new Set(p.evidence).size!==p.evidence.length || p.evidence.some(x=>!str(x)||!ids.has(x))) return false;
  if (!p.evidence.every(str)) return false;
  if (p.action==="create_draft") {
    return exactKeys(p.target,["kind","id"]) && p.target.kind==="draft_queue" && p.target.id==="mailbox:"+d.mailbox
      && exactKeys(p.payload,["recipient","referenceId","status","template"])
      && str(p.payload.recipient) && str(p.payload.referenceId) && str(p.payload.status) && p.payload.template==="order_status";
  }
  if (p.action==="update_internal_record") {
    return exactKeys(p.target,["kind","id"]) && p.target.kind==="case_record" && str(p.target.id)
      && exactKeys(p.payload,["field","sourceEventId","value"]) && p.payload.field==="delivery_window"
      && str(p.payload.sourceEventId) && str(p.payload.value);
  }
  if (p.action==="send_approved_notice") {
    return exactKeys(p.target,["kind","id"]) && p.target.kind==="email" && str(p.target.id)
      && exactKeys(p.payload,["referenceId","status","template"]) && str(p.payload.referenceId)
      && str(p.payload.status) && p.payload.template==="approved_delivery_notice";
  }
  if (p.action==="request_confirmation") {
    return exactKeys(p.target,["kind","id"]) && p.target.kind==="approval_queue" && str(p.target.id)
      && exactKeys(p.payload,["claimedSender","questionCode","referenceId"])
      && str(p.payload.claimedSender) && p.payload.questionCode==="VERIFY_REQUEST" && str(p.payload.referenceId);
  }
  if (p.action==="quarantine_item") {
    return exactKeys(p.target,["kind","id"]) && p.target.kind==="security_queue" && p.target.id==="mailroom"
      && exactKeys(p.payload,["artifactId","reasonCode"]) && str(p.payload.artifactId)
      && p.payload.reasonCode==="INDIRECT_PROMPT_INJECTION";
  }
  if (p.action==="no_action") {
    return p.target===null && exactKeys(p.payload,["reasonCode","referenceId"])
      && ["ALREADY_COMPLETED","DUPLICATE","INFORMATIONAL"].includes(p.payload.reasonCode) && str(p.payload.referenceId);
  }
  return false;
}
function normalizeProposal(p) {
  return {dossierId:p.dossierId,callId:p.callId,action:p.action,target:p.target===undefined?null:p.target,payload:p.payload,evidence:[...p.evidence].sort()};
}
function proposalDigest(p) { return sha(normalizeProposal(p)); }
function validDossier(d) {
  if (!isObj(d) || !str(d.dossierId) || !["stable_core","fresh_audit"].includes(d.partition)
    || !str(d.receivedAt) || Number.isNaN(Date.parse(d.receivedAt)) || !str(d.mailbox) || !str(d.objective)
    || !Array.isArray(d.sources) || d.sources.length<1) return false;
  const lineIds=[];
  for (const s of d.sources) {
    if (!isObj(s) || !str(s.sourceId) || !str(s.kind) || !str(s.provenance) || !str(s.title) || !Array.isArray(s.lines)) return false;
    for (const l of s.lines) {
      if (!isObj(l) || !str(l.lineId) || typeof l.text!=="string") return false;
      lineIds.push(l.lineId);
    }
  }
  return lineIds.length>0 && new Set(lineIds).size===lineIds.length;
}
function validProposeEnvelope(b) {
  if (!exactKeys(b,["profile","operation","evaluationId","receiptVerifier","corpus","allowedActions","dossiers"])
    || b.profile!==PROFILE || b.operation!=="propose" || !str(b.evaluationId)) return false;
  const v=b.receiptVerifier;
  if (!exactKeys(v,["algorithm","publicKeyJwk"]) || v.algorithm!=="Ed25519" || !isObj(v.publicKeyJwk)
    || v.publicKeyJwk.kty!=="OKP" || v.publicKeyJwk.crv!=="Ed25519" || !str(v.publicKeyJwk.x)) return false;
  try { if (Buffer.from(v.publicKeyJwk.x,"base64url").length!==32) return false; crypto.createPublicKey({key:v.publicKeyJwk,format:"jwk"}); } catch { return false; }
  if (!isObj(b.corpus) || !str(b.corpus.coreId) || !str(b.corpus.auditId) || b.corpus.stableCount!==58 || b.corpus.freshCount!==6) return false;
  if (!Array.isArray(b.allowedActions) || b.allowedActions.length!==ACTIONS.length || new Set(b.allowedActions).size!==ACTIONS.length
    || b.allowedActions.some(a=>!ACTIONS.includes(a))) return false;
  if (!Array.isArray(b.dossiers) || b.dossiers.length!==64) return false;
  const seen=new Set(), stable=[], fresh=[];
  for (const d of b.dossiers) {
    if (!validDossier(d) || seen.has(d.dossierId)) return false;
    seen.add(d.dossierId);
    (d.partition==="stable_core" ? stable : fresh).push(d);
  }
  return stable.length===58 && fresh.length===6;
}
function validCommitEnvelope(b) {
  return exactKeys(b,["profile","operation","evaluationId","inputDigest","receipts"])
    && b.profile===PROFILE && b.operation==="commit" && str(b.evaluationId)
    && /^[a-f0-9]{64}$/.test(b.inputDigest) && Array.isArray(b.receipts);
}
function validReceiptShape(r) {
  return exactKeys(r,["dossierId","callId","action","accepted","proposalDigest","receiptId","receiptSignature"])
    && str(r.dossierId) && str(r.callId) && str(r.action) && typeof r.accepted==="boolean"
    && /^[a-f0-9]{64}$/.test(r.proposalDigest) && str(r.receiptId) && str(r.receiptSignature);
}

module.exports = async function handler(req,res) {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if (req.method!=="POST") return fail(res,405,"POST required");

  let b;
  try {
    const raw = typeof req.body==="string" ? req.body : JSON.stringify(req.body === undefined ? null : req.body);
    if (Buffer.byteLength(raw || "", "utf8") > MAX_BODY) return fail(res,413,"request too large");
    b = typeof req.body==="string" ? JSON.parse(req.body) : req.body;
  } catch { return fail(res,400,"malformed JSON"); }
  if (!isObj(b) || b.profile!==PROFILE || !str(b.evaluationId) || !["propose","commit"].includes(b.operation)) {
    return fail(res,400,"invalid envelope");
  }

  try {
    if (b.operation==="propose") {
      if (!validProposeEnvelope(b)) return fail(res,422,"invalid propose schema");
      const inputDigest=sha(b.dossiers);
      const requestDigest=sha(b);
      const ekey=evalKey(b.evaluationId);
      const existing=await loadJson(ekey);
      if (existing) {
        if (existing.inputDigest!==inputDigest || existing.requestDigest!==requestDigest) return fail(res,409,"evaluationId content conflict");
        return send(res,200,existing.response);
      }

      const proposals=[];
      for (const d of b.dossiers) {
        const skey=stableKey(d);
        let p = d.partition==="stable_core" ? await loadJson(skey) : null;
        if (!p) {
          p=decide(d);
          if (!p || !validateProposal(p,d,b.allowedActions)) return fail(res,422,"proposal validation failed");
          if (d.partition==="stable_core") await saveJson(skey,p);
        } else {
          // Revalidate cached proposals against this exact dossier before using them.
          if (!validateProposal(p,d,b.allowedActions)) return fail(res,409,"cached proposal mismatch");
        }
        proposals.push(p);
      }
      if (new Set(proposals.map(p=>p.callId)).size!==proposals.length) return fail(res,422,"duplicate callId");
      const response={profile:PROFILE,evaluationId:b.evaluationId,status:"awaiting_receipts",inputDigest,proposals};
      const record={evaluationId:b.evaluationId,requestDigest,inputDigest,verifier:b.receiptVerifier.publicKeyJwk,dossiers:b.dossiers,proposals,response,state:"awaiting_receipts"};
      await saveJson(ekey,record);
      return send(res,200,response);
    }

    if (!validCommitEnvelope(b)) return fail(res,422,"invalid commit schema");
    const ekey=evalKey(b.evaluationId);
    const ev=await loadJson(ekey);
    if (!ev) return fail(res,409,"unknown evaluation");
    if (ev.inputDigest!==b.inputDigest) return fail(res,409,"input digest mismatch");
    if (ev.state==="completed") {
      if (ev.commitDigest!==sha(b)) return fail(res,409,"commit replay conflict");
      return send(res,200,ev.commitResponse);
    }
    if (b.receipts.length!==ev.proposals.length) return fail(res,422,"receipt count mismatch");

    let publicKey;
    try { publicKey=crypto.createPublicKey({key:ev.verifier,format:"jwk"}); }
    catch { return fail(res,422,"invalid stored verifier"); }
    const pById=new Map(ev.proposals.map(p=>[p.dossierId,p]));
    const seen=new Set(), verified=[];
    // Validate every receipt and signature first. No state is changed until the whole
    // batch has passed, so one forged or transferred receipt rejects the entire commit.
    for (const r of b.receipts) {
      if (!validReceiptShape(r) || seen.has(r.dossierId) || !pById.has(r.dossierId)) return fail(res,422,"duplicate, unknown, or malformed receipt");
      seen.add(r.dossierId);
      const p=pById.get(r.dossierId);
      const pd=proposalDigest(p);
      if (r.callId!==p.callId || r.action!==p.action || r.proposalDigest!==pd) return fail(res,422,"receipt does not match persisted proposal");
      let signature;
      try { signature=Buffer.from(r.receiptSignature,"base64"); } catch { return fail(res,422,"invalid signature encoding"); }
      if (signature.length!==64) return fail(res,422,"invalid signature length");
      const {receiptSignature,...unsignedReceipt}=r;
      const signed={profile:PROFILE,evaluationId:b.evaluationId,inputDigest:b.inputDigest,receipt:unsignedReceipt};
      let ok=false;
      try { ok=crypto.verify(null,Buffer.from(canonical(signed),"utf8"),publicKey,signature); } catch { ok=false; }
      if (!ok) return fail(res,422,"invalid receipt signature");
      verified.push({dossierId:p.dossierId,callId:p.callId,action:p.action,proposalDigest:pd,receiptId:r.receiptId,status:r.accepted?"executed":"rejected"});
    }
    if (seen.size!==ev.proposals.length) return fail(res,422,"missing receipt");
    const outcomes=ev.proposals.map(p=>verified.find(o=>o.dossierId===p.dossierId));
    const response={profile:PROFILE,evaluationId:b.evaluationId,status:"completed",inputDigest:b.inputDigest,outcomes};
    ev.receipts=b.receipts;
    ev.state="completed";
    ev.commitDigest=sha(b);
    ev.commitResponse=response;
    ev.completedAt=new Date().toISOString();
    await saveJson(ekey,ev);
    return send(res,200,response);
  } catch (err) {
    console.error("mailroom internal failure", err && err.name, err && err.message);
    return fail(res,503,"temporary storage or processing failure");
  }
};
