const crypto=require('node:crypto');
const {read,write,listJson}=require('./store');
const IN='application/vnd.ga5.invoice-claim-batch+json',OUT='application/vnd.ga5.invoice-action-proposals+json',RESULTS='application/vnd.ga5.invoice-action-results+json',RECEIPTS='application/vnd.ga5.invoice-action-receipts+json';
const ACTIONS=['settle_invoice','request_approval','hold_invoice','reject_duplicate','open_exception'];
const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:canon(v)).digest('hex');
const uid=()=>crypto.randomBytes(16).toString('hex');
const text=x=>typeof x==='string'&&x.trim().length>0;
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
function send(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/a2a+json');res.setHeader('Cache-Control','no-store');return res.end(JSON.stringify(data));}
function fail(res,status,error){if(res.writableEnded)return;return send(res,status,{error});}
function checkHeaders(req,res){if(req.headers['a2a-version']!=='1.0')return fail(res,400,'INVALID_VERSION');const ct=String(req.headers['content-type']||'').split(';')[0];if(req.method!=='GET'&&ct!=='application/a2a+json')return fail(res,415,'INVALID_MEDIA_TYPE');if(req.method==='GET'&&req.headers['content-type']&&ct!=='application/a2a+json')return fail(res,415,'INVALID_MEDIA_TYPE');return true;}
function principal(req){const m=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);return m?hash(m[1]):null;}
async function body(req){if(req.body!==undefined&&req.body!==null){if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{throw Object.assign(new Error('INVALID_JSON'),{status:400})}}return req.body;}let s='';for await(const c of req){s+=c;if(s.length>3*1024*1024)throw Object.assign(new Error('TOO_LARGE'),{status:413});}try{return JSON.parse(s)}catch{throw Object.assign(new Error('INVALID_JSON'),{status:400})}}
function path(req){return new URL(req.url||'/','https://x').pathname;}
function lines(pkg){const out=[];const docs=pkg.documents||pkg.sources||pkg.files||[];for(const d of docs){const ls=d.lines||d.paragraphs||d.items||[];for(const l of ls){if(typeof l==='string')out.push({ref:null,text:l});else if(obj(l)&&text(l.text))out.push({ref:l.ref||l.lineId||l.id||null,text:l.text});}}if(!out.length&&Array.isArray(pkg.lines))for(const l of pkg.lines){if(obj(l)&&text(l.text))out.push({ref:l.ref||l.lineId||l.id||null,text:l.text});}return out;}
function refsIn(s){return [...String(s||'').matchAll(/\[[^\]]+\]/g)].map(m=>m[0]);}
function negated(text,phrase){const i=String(text).toLowerCase().indexOf(phrase);if(i<0)return false;const pre=String(text).slice(Math.max(0,i-28),i);return /\b(?:not|no|never|without|isn't|isnt|doesn't|doesnt|wasn't|wasnt|cannot|can't|cant)\s+(?:a\s+)?(?:confirmed\s+|considered\s+)?$/i.test(pre)||/\b(?:not|no|never|without)\b/i.test(pre);}
function facts(pkg){const ls=lines(pkg),all=ls.map(x=>x.text).join('\n');
 const vendor=text(pkg.vendorName)?pkg.vendorName:((all.match(/(?:vendor|supplier|merchant|seller)\s*[:#-]\s*([^\n\[;]+)/i)||[])[1]||'Unknown Vendor').trim();
 const invoice=text(pkg.invoiceNumber)?pkg.invoiceNumber:((all.match(/(?:invoice\s*(?:number|no\.?|#)|invoice\b|inv\.?\s*(?:no\.?|#))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i)||[])[1]||'UNKNOWN').trim();
 let amountMinor=Number.isInteger(pkg.amountMinor)?pkg.amountMinor:null;let amountText='';
 if(amountMinor===null){for(const l of ls){const m=l.text.match(/(?:amount|total|invoice\s+total|gross|net)\s*(?:due)?\s*[:=]?\s*(?:INR|USD|EUR|GBP|₹|\$|€|£)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);if(m){amountText=m[1];break;}}}
 if(amountMinor===null&&amountText)amountMinor=Math.round(Number(amountText.replace(/,/g,''))*100);if(amountMinor===null)amountMinor=0;
 let currency=text(pkg.currency)?pkg.currency:((all.match(/\b(INR|USD|EUR|GBP)\b/i)||[])[1]||'INR');currency=currency.toUpperCase();
 return {vendorName:vendor,invoiceNumber:invoice,amountMinor,currency,ls,all};}
function evidenceAndAction(pkg){const f=facts(pkg);const paras=f.ls.map((x,i)=>({i,ref:x.ref,text:x.text,refs:refsIn(x.text)}));
 const score=(text,patterns)=>patterns.reduce((n,p)=>n+(new RegExp(p,'i').test(text)&&!negated(text,p.replace(/\\b|[()]/g,''))?1:0),0);
 const duplicate=['already\\s+paid','paid\\s+(?:previously|before)','previously\\s+settled','duplicate\\s+invoice','same\\s+(?:commercial\\s+)?invoice.*(?:paid|settled)','invoice.*already\\s+settled'];
 const conflict=['records?\\s+(?:conflict|disagree|mismatch)','(?:amount|vendor|invoice|po|purchase\\s+order).*mismatch','cannot\\s+reconcile','inconsistent\\s+(?:records|documents|amounts)','material\\s+conflict'];
 const approval=['approval\\s+required','manager\\s+approval','needs?\\s+approval','outside\\s+(?:delegated|autonomous)\\s+authority','exceeds?\\s+(?:delegated\\s+)?authority','above\\s+(?:the\\s+)?approval\\s+limit','over\\s+(?:the\\s+)?approval\\s+limit'];
 const hold=['hold\\s+(?:the\\s+)?payment','payment\\s+(?:must|should)\\s+be\\s+held','do\\s+not\\s+pay','pending\\s+verification','awaiting\\s+verification','verification\\s+(?:is\\s+)?pending','bank\\s+details?\\s+(?:need|needs|require)\\s+verification','goods\\s+(?:receipt|confirmation)\\s+(?:is\\s+)?missing','tax\\s+(?:validation|verification)\\s+(?:is\\s+)?pending'];
 const settle=['reconciled','three[- ]way\\s+match','within\\s+(?:delegated|autonomous)\\s+authority','approved\\s+for\\s+payment','valid\\s+(?:and\\s+)?(?:approved|reconciled)?\\s*invoice','no\\s+(?:outstanding\\s+)?mismatch'];
 const scores={reject_duplicate:0,open_exception:0,request_approval:0,hold_invoice:0,settle_invoice:0};
 for(const p of paras){const t=p.text;scores.reject_duplicate+=score(t,duplicate)*12;scores.open_exception+=score(t,conflict)*11;scores.request_approval+=score(t,approval)*9;scores.hold_invoice+=score(t,hold)*8;scores.settle_invoice+=score(t,settle)*5;}
 let action='open_exception';let best=-1;for(const a of ['reject_duplicate','open_exception','request_approval','hold_invoice','settle_invoice']){if(scores[a]>best){best=scores[a];action=a;}}
 if(best<=0)action='open_exception';
 const actionPatterns={reject_duplicate:duplicate,open_exception:conflict,request_approval:approval,hold_invoice:hold,settle_invoice:settle};
 const ranked=paras.map(p=>({p,s:score(p.text,actionPatterns[action])*10+p.refs.length})).sort((a,b)=>b.s-a.s);
 let chosen=ranked.find(x=>x.p.refs.length>=3&&x.s>0)?.p||ranked.find(x=>x.p.refs.length>=3)?.p;
 let refs=chosen?chosen.refs.slice(0,3):[];
 if(refs.length<3){const allRefs=[];for(const p of ranked){for(const r of p.refs)if(!allRefs.includes(r))allRefs.push(r);}for(const p of f.ls){if(p.ref&&!allRefs.includes(p.ref))allRefs.push(p.ref);}refs=allRefs.slice(0,3);}
 if(refs.length<3){for(let i=0;i<f.ls.length&&refs.length<3;i++){const r=f.ls[i].ref||`[line:${i+1}]`;if(!refs.includes(r))refs.push(r);}}
 const rationale=`${action} is selected from the decisive invoice evidence. The action is supported by ${refs.join(', ')}. Vendor ${f.vendorName}, invoice ${f.invoiceNumber}, amount ${f.amountMinor} minor units in ${f.currency} are the extracted facts used with the stated payment, authority, verification, duplicate, or reconciliation condition.`;
 return {action,facts:{vendorName:f.vendorName,invoiceNumber:f.invoiceNumber,amountMinor:f.amountMinor,currency:f.currency},evidenceRefs:refs,rationale};}
async function decision(pkg){const k='decisions/'+hash(pkg);const cached=await read(k);if(cached)return cached;const d=evidenceAndAction(pkg);await write(k,d);return d;}
function validProposal(p,pkg){const source=lines(pkg),validRefs=new Set(source.flatMap(x=>x.ref?[x.ref,...refsIn(x.text)]:refsIn(x.text)));return obj(p)&&p.packageId===pkg.packageId&&text(p.actionId)&&p.actionId.length>=12&&ACTIONS.includes(p.action)&&obj(p.facts)&&text(p.facts.vendorName)&&text(p.facts.invoiceNumber)&&Number.isInteger(p.facts.amountMinor)&&text(p.facts.currency)&&Array.isArray(p.evidenceRefs)&&p.evidenceRefs.length===3&&new Set(p.evidenceRefs).size===3&&p.evidenceRefs.every(r=>validRefs.has(r))&&text(p.rationale)&&p.rationale.length>=60&&p.rationale.length<=1500&&p.rationale.includes(p.action)&&p.evidenceRefs.every(r=>p.rationale.includes(r));}
function task(tid,ctx,p,batch,msg,props){return {id:tid,contextId:ctx,status:{state:'TASK_STATE_INPUT_REQUIRED'},history:[msg],artifacts:[{parts:[{mediaType:OUT,data:{batchId:batch.batchId,proposals:props}}]}],metadata:{principal:p,batchId:batch.batchId}};}
const taskPath=(p,id)=>`principals/${p}/tasks/${id}`;const idemPath=(p,id)=>`principals/${p}/idem/${encodeURIComponent(id)}`;
async function saveTask(p,t){return write(taskPath(p,t.id),t);}
async function main(req,res){if(!checkHeaders(req,res))return;const p=principal(req);if(!p)return fail(res,401,'UNAUTHORIZED');const u=path(req);
 if(req.method==='POST'&&(u==='/a2a/message:send'||u==='/api/agent')){const b=await body(req),m=b?.message;if(!obj(m)||m.role!=='ROLE_USER'||!text(m.messageId)||!Array.isArray(m.parts)||!obj(b.configuration))return fail(res,400,'INVALID_MESSAGE');
  const mh=hash(m),old=await read(idemPath(p,m.messageId));if(old){if(old.hash!==mh)return fail(res,409,'IDEMPOTENCY_CONFLICT');return send(res,200,old.task);}
  if(m.taskId){const t=await read(taskPath(p,m.taskId));if(!t)return fail(res,404,'TASK_NOT_FOUND');if(t.contextId!==m.contextId)return fail(res,400,'CONTEXT_MISMATCH');if(t.status.state!=='TASK_STATE_INPUT_REQUIRED')return fail(res,409,'TASK_TERMINAL');
   const rp=m.parts.find(x=>x?.mediaType===RESULTS&&obj(x.data));if(!rp||rp.data.batchId!==t.metadata.batchId||!Array.isArray(rp.data.results))return fail(res,422,'INVALID_RESULTS');const props=t.artifacts[0].parts[0].data.proposals;
   if(rp.data.results.length!==props.length)return fail(res,409,'RESULT_SET_MISMATCH');const by=new Map(props.map(x=>[x.packageId,x])),seen=new Set();
   for(const r of rp.data.results){const q=by.get(r.packageId);if(!q||seen.has(r.packageId)||r.actionId!==q.actionId||r.action!==q.action||!['ACCEPTED','REJECTED'].includes(r.outcome)||!text(r.receiptNonce))return fail(res,409,'RESULT_BINDING_MISMATCH');seen.add(r.packageId);}
   const executions=rp.data.results.filter(r=>r.outcome==='ACCEPTED').map(r=>{const q=by.get(r.packageId);return {packageId:q.packageId,actionId:q.actionId,action:q.action,receiptNonce:r.receiptNonce,facts:q.facts,evidenceRefs:q.evidenceRefs};});
   const fin={...t,status:{state:'TASK_STATE_COMPLETED'},history:t.history.concat([m]),artifacts:t.artifacts.concat([{parts:[{mediaType:RECEIPTS,data:{batchId:t.metadata.batchId,executions}}]}])};await saveTask(p,fin);await write(idemPath(p,m.messageId),{hash:mh,task:fin});return send(res,200,fin);
  }
  const part=m.parts.find(x=>x?.mediaType===IN&&obj(x.data));const batch=part?.data;if(!obj(batch)||!text(batch.batchId)||!text(batch.policyRevision)||!Array.isArray(batch.packages)||!batch.packages.length||!batch.packages.every(x=>obj(x)&&text(x.packageId)))return fail(res,422,'INVALID_INVOICE_BATCH');
  const seen=new Set();for(const x of batch.packages){if(seen.has(x.packageId))return fail(res,422,'DUPLICATE_PACKAGE_ID');seen.add(x.packageId);}
  const raw=await Promise.all(batch.packages.map(decision));const props=batch.packages.map((x,i)=>{const d=raw[i];const q={packageId:x.packageId,actionId:`act_${hash({batchId:batch.batchId,packageId:x.packageId,decision:d}).slice(0,32)}`,action:d.action,facts:d.facts,evidenceRefs:d.evidenceRefs,rationale:d.rationale};return validProposal(q,x)?q:{...q,evidenceRefs:refsIn((lines(x).find(l=>refsIn(l.text).length>=3)||lines(x)[0]||{}).text).slice(0,3)};});
  const tid='task_'+uid(),ctx=m.contextId||'ctx_'+uid(),t=task(tid,ctx,p,batch,m,props);await saveTask(p,t);await write(idemPath(p,m.messageId),{hash:mh,task:t});return send(res,200,t);
 }
 if(req.method==='GET'&&u==='/a2a/tasks'){const tasks=await listJson(`principals/${p}/tasks/`);return send(res,200,{tasks:tasks.filter(t=>t&&t.metadata&&t.metadata.principal===p)});}
 let m=u.match(/^\/a2a\/tasks\/([^/:]+)$/);if(req.method==='GET'&&m){const t=await read(taskPath(p,m[1]));return t?send(res,200,t):fail(res,404,'TASK_NOT_FOUND');}
 m=u.match(/^\/a2a\/tasks\/([^/:]+):cancel$/);if(req.method==='POST'&&m){const t=await read(taskPath(p,m[1]));if(!t)return fail(res,404,'TASK_NOT_FOUND');if(t.status.state==='TASK_STATE_COMPLETED')return fail(res,409,'TASK_ALREADY_TERMINAL');if(t.status.state==='TASK_STATE_CANCELED')return send(res,200,t);const c={...t,status:{state:'TASK_STATE_CANCELED'},history:t.history.concat([{messageId:'cancel:'+uid(),role:'ROLE_USER',parts:[]}])};await saveTask(p,c);return send(res,200,c);}
 return fail(res,404,'NOT_FOUND');}
module.exports=async(req,res)=>{try{return await main(req,res)}catch(e){console.error(e);return fail(res,e.status||500,e.message||'INTERNAL_ERROR')}};
