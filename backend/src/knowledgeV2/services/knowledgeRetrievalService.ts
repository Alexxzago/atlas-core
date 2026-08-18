import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { KnowledgeRetrievalPort, KnowledgeRetrievalRepositoryPort } from "../application/ports.js";
import { chunkUtf8Deterministically, lexicalTerms, type KnowledgeChunkV2, type RetrievalContext } from "../domain/knowledgeRetrieval.js";

export class KnowledgeIndexingService {
  public constructor(private readonly repository:KnowledgeRetrievalRepositoryPort){}
  public indexCompletedRevision(context:WorkspaceContext,companyId:number,input:{sourceId:string;sourceRevisionId:string;contentDigest:string;normalizedText:string;completedAt:string}):void{this.repository.replaceRevision(context,companyId,{...input,createdAt:input.completedAt,chunks:chunkUtf8Deterministically(input.normalizedText)});}
  public publicationReady(context:WorkspaceContext,companyId:number,revisionIds:readonly string[]):boolean{return this.repository.readyForRevisions(context,companyId,revisionIds);}
}
export class LexicalKnowledgeRetrievalService implements KnowledgeRetrievalPort {
  public constructor(private readonly repository:KnowledgeRetrievalRepositoryPort){}
  public retrieve(context:WorkspaceContext,companyId:number,revisionIds:readonly string[],query:string,limit=6):readonly KnowledgeChunkV2[]{const terms=lexicalTerms(query);if(!terms.length||!Number.isSafeInteger(limit)||limit<1)return[];const seen=new Set<string>();return Object.freeze(this.repository.findReadyChunks(context,companyId,revisionIds).map(chunk=>({chunk,score:terms.reduce((total,term)=>total+occurrences(chunk.normalizedText,term),0)})).filter(match=>match.score>0).sort((a,b)=>b.score-a.score||a.chunk.sourceRevisionId.localeCompare(b.chunk.sourceRevisionId)||a.chunk.ordinal-b.chunk.ordinal).filter(match=>{if(seen.has(match.chunk.id))return false;seen.add(match.chunk.id);return true;}).slice(0,limit).map(match=>match.chunk));}
  public assemble(matches:readonly KnowledgeChunkV2[],maximumBytes=4*1024):RetrievalContext{if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1)return Object.freeze({text:"",citations:Object.freeze([])});let bytes=0;const accepted:KnowledgeChunkV2[]=[],seen=new Set<string>();for(const match of matches){if(seen.has(match.id))continue;seen.add(match.id);const next=Buffer.byteLength(match.text,"utf8");if(bytes+next>maximumBytes)continue;bytes+=next;accepted.push(match);}return Object.freeze({text:accepted.map(match=>match.text).join("\n\n"),citations:Object.freeze(accepted.map(match=>Object.freeze({sourceRevisionId:match.sourceRevisionId,chunkId:match.id,characterStart:match.characterStart,characterEnd:match.characterEnd}))) });}
  public context(context:WorkspaceContext,companyId:number,revisionIds:readonly string[],query:string):RetrievalContext{return this.assemble(this.retrieve(context,companyId,revisionIds,query));}
}
function occurrences(text:string,term:string):number{let count=0,at=text.indexOf(term);while(at>=0){count++;at=text.indexOf(term,at+term.length);}return count;}
