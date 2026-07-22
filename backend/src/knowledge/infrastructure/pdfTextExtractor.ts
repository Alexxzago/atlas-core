import { Worker } from "node:worker_threads";
import type { PdfTextExtractor, AcquiredText } from "../application/ports.js";
import { KNOWLEDGE_LIMITS, KnowledgeDomainError } from "../domain/knowledge.js";

export interface PdfWorkerLifecycleEvidence { readonly pagesLoaded:number;readonly pagesCleaned:number;readonly loadingTaskDestroyed:boolean;readonly portCloseRequested:boolean;readonly networkAttempts:number;readonly timerRemoved:boolean;readonly abortHandlerRemoved:boolean;readonly listenersRemoved:boolean;readonly workerExitAwaited:boolean; }
export const productionPdfWorkerCode = `
const { parentPort, workerData } = require('node:worker_threads');
(async()=>{const bytes=workerData;let task,doc,outcome,pagesLoaded=0,pagesCleaned=0,loadingTaskDestroyed=false,networkAttempts=0;try{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const deny=()=>{networkAttempts++;throw Error('pdf_network_forbidden');};globalThis.fetch=deny;try{require('node:http').request=deny;require('node:https').request=deny;require('node:net').connect=deny;require('node:net').createConnection=deny;require('node:dns').lookup=deny;require('node:dns').resolve=deny;}catch{}
   task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true});
    doc=await task.promise;if(doc.numPages>100)throw new Error('pdf_page_limit');
  const [javascript,attachments]=await Promise.all([doc.getJSActions(),doc.getAttachments()]);if(javascript||attachments)throw new Error('pdf_active_content');const pages=[];let characters=0;
  for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);pagesLoaded++;try{const content=await page.getTextContent();const text=content.items.map(item=>'str' in item?item.str:'').join(' ');characters+=Array.from(text).length;if(characters>100000)throw new Error('pdf_text_limit');pages.push(text);}finally{page.cleanup();pagesCleaned++;}}
  outcome={text:pages.join(String.fromCharCode(10)),pages:doc.numPages};
}catch(error){outcome={error:error instanceof Error?error.message:'pdf_parse_failed'};
}finally{try{if(task){await task.destroy();loadingTaskDestroyed=true;}else if(doc){await doc.destroy();loadingTaskDestroyed=true;}}catch(error){outcome={error:'pdf_cleanup_failed:'+(error instanceof Error?error.message:'unknown')};}}
parentPort.postMessage({...outcome,lifecycle:{pagesLoaded,pagesCleaned,loadingTaskDestroyed,portCloseRequested:true,networkAttempts}});parentPort.close();})().catch(()=>{parentPort.postMessage({error:'pdf_parse_failed',lifecycle:{pagesLoaded:0,pagesCleaned:0,loadingTaskDestroyed:false,portCloseRequested:true,networkAttempts:0}});parentPort.close();});`;

export class WorkerPdfTextExtractor implements PdfTextExtractor {
  public constructor(private readonly options:{timeoutMilliseconds?:number;workerCode?:string;resourceLimits?:{maxOldGenerationSizeMb:number;maxYoungGenerationSizeMb:number;stackSizeMb:number};onLifecycle?:(evidence:PdfWorkerLifecycleEvidence)=>void}={}){}
  public async extract(bytes: Uint8Array, signal: AbortSignal): Promise<AcquiredText> {
    const trailer=Buffer.from(bytes.subarray(Math.max(0,bytes.length-2048))),trailerText=trailer.toString("latin1"),startXref=/startxref\s+(\d+)/.exec(trailerText),structureText=Buffer.from(bytes).toString("latin1");
    if(bytes.byteLength<5||bytes.byteLength>KNOWLEDGE_LIMITS.pdfBytes||Buffer.from(bytes.subarray(0,Math.min(1024,bytes.length))).indexOf("%PDF-")<0||!startXref||Number(startXref[1])>=bytes.length||trailer.indexOf("%%EOF")<0||/\/(?:Encrypt|JavaScript|JS|EmbeddedFiles|EmbeddedFile|URI|OpenAction)\b/.test(structureText)||!/\bBT\b/.test(structureText))throw new KnowledgeDomainError("unsupported_pdf");
    const inputBytes=bytes.byteLength,workerBytes=new Uint8Array(bytes).buffer;
    const workerData=workerBytes;
    return new Promise((resolve,reject)=>{const worker=new Worker(this.options.workerCode??productionPdfWorkerCode,{eval:true,workerData,transferList:[workerBytes],resourceLimits:this.options.resourceLimits??{maxOldGenerationSizeMb:48,maxYoungGenerationSizeMb:4,stackSizeMb:4}});let settled=false,terminal:{text?:string;pages?:number;error?:string;lifecycle?:Omit<PdfWorkerLifecycleEvidence,"timerRemoved"|"abortHandlerRemoved"|"listenersRemoved"|"workerExitAwaited">}|undefined;
      const finish=async(error?:unknown,result?:{text:string;pages:number},terminate=true)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",aborted);let workerExitAwaited=!terminate;if(terminate)try{await worker.terminate();workerExitAwaited=true;}catch{error??=new KnowledgeDomainError("pdf_parse_failed");}worker.removeAllListeners();const lifecycle=terminal?.lifecycle;this.options.onLifecycle?.({pagesLoaded:lifecycle?.pagesLoaded??0,pagesCleaned:lifecycle?.pagesCleaned??0,loadingTaskDestroyed:lifecycle?.loadingTaskDestroyed??false,portCloseRequested:lifecycle?.portCloseRequested??false,networkAttempts:lifecycle?.networkAttempts??0,timerRemoved:true,abortHandlerRemoved:true,listenersRemoved:worker.listenerCount("message")===0&&worker.listenerCount("error")===0&&worker.listenerCount("exit")===0,workerExitAwaited});if(error)reject(error);else resolve({text:result!.text,mediaType:"application/pdf",inputBytes,pageCount:result!.pages});};
      const timer=setTimeout(()=>void finish(new KnowledgeDomainError("pdf_parse_failed")),this.options.timeoutMilliseconds??KNOWLEDGE_LIMITS.pdfTimeoutMilliseconds);const aborted=()=>void finish(new KnowledgeDomainError("pdf_parse_failed"));signal.addEventListener("abort",aborted,{once:true});worker.once("message",(message:typeof terminal)=>{terminal=message;});worker.once("error",()=>void finish(new KnowledgeDomainError("pdf_parse_failed")));worker.once("exit",code=>{if(settled)return;if(code!==0||!terminal){void finish(new KnowledgeDomainError("pdf_parse_failed"),undefined,false);return;}if(terminal.error){void finish(new KnowledgeDomainError(terminal.error.includes("password")?"unsupported_pdf":"pdf_parse_failed"),undefined,false);return;}if(!(terminal.text??"").trim()){void finish(new KnowledgeDomainError("pdf_text_empty"),undefined,false);return;}void finish(undefined,{text:terminal.text!,pages:terminal.pages??0},false);});
    });
  }
}
