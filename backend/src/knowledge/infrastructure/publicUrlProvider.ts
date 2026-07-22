import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import type { PublicUrlContentProvider, AcquiredText } from "../application/ports.js";
import { KNOWLEDGE_LIMITS, KnowledgeDomainError } from "../domain/knowledge.js";

export class SecurePublicUrlProvider implements PublicUrlContentProvider {
  private readonly connectionLookup:ConnectionLookup;private readonly allowedPorts:ReadonlySet<number>;private readonly timeoutMilliseconds:number;private readonly requestFactory:RequestFactory|undefined;
  public constructor(options:Readonly<{connectionLookup?:ConnectionLookup;allowedPorts?:readonly number[];timeoutMilliseconds?:number;requestFactory?:RequestFactory}>={}){this.connectionLookup=options.connectionLookup??safeLookup;this.allowedPorts=new Set(options.allowedPorts??[80,443]);this.timeoutMilliseconds=options.timeoutMilliseconds??KNOWLEDGE_LIMITS.urlTimeoutMilliseconds;this.requestFactory=options.requestFactory;}
  public async acquire(raw: string, signal: AbortSignal): Promise<AcquiredText> { return this.read(validateUrl(raw,this.allowedPorts), signal, 0); }
  private async read(url: URL, signal: AbortSignal, redirects: number): Promise<AcquiredText> {
    if (redirects > 3) throw new KnowledgeDomainError("url_redirect_limit");
    const result = await fetchOne(url, signal,this.connectionLookup,this.timeoutMilliseconds,this.requestFactory);
    if (result.redirect) {
      const next = validateUrl(new URL(result.redirect, url).toString(),this.allowedPorts);
      if (url.protocol === "https:" && next.protocol !== "https:") throw new KnowledgeDomainError("invalid_public_url");
      return this.read(next, signal, redirects + 1);
    }
    return { text: result.body, mediaType: result.mediaType, inputBytes: result.bytes, finalUrl: url.toString() };
  }
}

export function validatePublicUrl(raw: string): URL {
  return validateUrl(raw,new Set([80,443]));
}
function validateUrl(raw:string,allowedPorts:ReadonlySet<number>):URL{
  let url: URL; try { url = new URL(raw); } catch { throw new KnowledgeDomainError("invalid_public_url"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.hash) throw new KnowledgeDomainError("invalid_public_url");
  const port=Number(url.port||(url.protocol==="https:"?443:80));if(!allowedPorts.has(port)||url.hostname.toLowerCase() === "localhost")throw new KnowledgeDomainError("invalid_public_url");
  const hostname=url.hostname.startsWith("[")&&url.hostname.endsWith("]")?url.hostname.slice(1,-1):url.hostname;
  if (isIP(hostname) && !publicAddress(hostname)) throw new KnowledgeDomainError("invalid_public_url");
  url.hash = ""; return url;
}

interface OneResult { body: string; bytes: number; mediaType: string; redirect?: string; }
function fetchOne(url: URL, signal: AbortSignal,connectionLookup:ConnectionLookup,timeoutMilliseconds:number,requestFactory?:RequestFactory): Promise<OneResult> {
  return new Promise((resolve, reject) => {
    const operation = requestFactory??(url.protocol === "https:" ? httpsRequest : httpRequest);
    const req = operation(url, { method: "GET", signal, agent:false, headers: { accept: "text/html,text/plain,text/markdown", "user-agent": "AtlasKnowledge/1" }, lookup: connectionLookup }, response => {
      const location = response.headers.location;
      if (response.statusCode && [301,302,303,307,308].includes(response.statusCode) && location) { response.resume(); resolve({ body:"",bytes:0,mediaType:"",redirect:location }); return; }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new KnowledgeDomainError("url_fetch_unavailable")); return; }
      const mediaType=String(response.headers["content-type"]??"").split(";",1)[0]!.trim().toLowerCase();
      if(!["text/html","text/plain","text/markdown"].includes(mediaType)){response.resume();reject(new KnowledgeDomainError("url_media_type_unsupported"));return;}
      const encoding=String(response.headers["content-encoding"]??"identity").trim().toLowerCase();if(encoding&&encoding!=="identity"){response.resume();reject(new KnowledgeDomainError("url_content_encoding_unsupported"));return;}
      const chunks:Buffer[]=[];let bytes=0;response.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>KNOWLEDGE_LIMITS.urlResponseBytes){req.destroy(new KnowledgeDomainError("knowledge_input_too_large"));return;}chunks.push(chunk);});
      response.on("end",()=>resolve({body:Buffer.concat(chunks).toString("utf8"),bytes,mediaType}));response.on("error",()=>reject(new KnowledgeDomainError("url_fetch_unavailable")));
    });
    req.setTimeout(timeoutMilliseconds,()=>req.destroy(new KnowledgeDomainError("url_fetch_unavailable")));req.on("error",error=>reject(error instanceof KnowledgeDomainError?error:new KnowledgeDomainError("url_fetch_unavailable")));req.end();
  });
}
export type ConnectionLookup=(hostname:string,options:unknown,callback:(error:NodeJS.ErrnoException|null,address:string|Array<{address:string;family:number}>,family?:number)=>void)=>void;
export type RequestFactory=(url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
export type AddressResolver=(hostname:string,options:{all:true},callback:(error:NodeJS.ErrnoException|null,addresses:Array<{address:string;family:number}>)=>void)=>void;
export function createSafeLookup(resolver:AddressResolver=lookup as AddressResolver):ConnectionLookup{return(hostname,options,callback)=>resolver(hostname,{...(typeof options==="object"&&options?options:{}),all:true},(error,addresses)=>{if(error){callback(error,"",0);return;}if(!addresses.length||addresses.some(item=>!publicAddress(item.address))){callback(Object.assign(new Error("Non-public address."),{code:"EACCES"}),"",0);return;}const wantsAll=Boolean(typeof options==="object"&&options&&(options as{all?:boolean}).all);const first=addresses[0]!;callback(null,wantsAll?addresses:first.address,wantsAll?undefined:first.family);});}
export const safeLookup:ConnectionLookup=createSafeLookup();
export function publicAddress(address:string):boolean {
  const value=address.toLowerCase();
  const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);if(mapped)return publicAddress(mapped[1]!);
  if(value.includes(":")){const numeric=ipv6(value);if(numeric===null)return false;return inV6(numeric,"2000::",3)&&![
    ["2001::",23],["2001:1::1",128],["2001:1::2",128],["2001:1::3",128],["2001:2::",48],["2001:3::",32],["2001:4:112::",48],["2001:10::",28],["2001:20::",28],["2001:30::",28],["2001:db8::",32],["2002::",16],["2620:4f:8000::",48],
  ].some(([base,bits])=>inV6(numeric,String(base),Number(bits)));}
  const parts=value.split(".").map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;const[a,b,c]=parts as [number,number,number,number];return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0)||(a===192&&b===31&&c===196)||(a===192&&b===52&&c===193)||(a===192&&b===88&&c===99)||(a===192&&b===175&&c===48)||(a===198&&(b===18||b===19))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
function inV6(value:bigint,base:string,bits:number):boolean{const parsed=ipv6(base);if(parsed===null)return false;const shift=BigInt(128-bits);return value>>shift===parsed>>shift;}
function ipv6(value:string):bigint|null{if(value.includes("."))return null;const pieces=value.split("::");if(pieces.length>2)return null;const left=pieces[0]?pieces[0].split(":"):[],right=pieces.length===2&&pieces[1]?pieces[1].split(":"):[];if((pieces.length===1&&left.length!==8)||(pieces.length===2&&left.length+right.length>=8))return null;const groups=[...left,...Array(8-left.length-right.length).fill("0"),...right];if(groups.length!==8||groups.some(part=>!part||!/^[0-9a-f]{1,4}$/.test(part)))return null;return groups.reduce((result,part)=>(result<<16n)|BigInt(`0x${part}`),0n);}
