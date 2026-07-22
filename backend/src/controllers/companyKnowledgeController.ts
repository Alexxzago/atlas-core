import type { RequestHandler, Response } from "express";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { KnowledgeService } from "../knowledge/services/knowledgeServices.js";
import { KnowledgeDomainError } from "../knowledge/domain/knowledge.js";

export function createCompanyKnowledgeControllers(service:KnowledgeService):Record<string,(context:WorkspaceContext,actor:ActorContext)=>RequestHandler>{
  const wrap=(handler:(c:WorkspaceContext,a:ActorContext,req:Parameters<RequestHandler>[0],res:Response)=>unknown)=>(c:WorkspaceContext,a:ActorContext):RequestHandler=>async(req,res)=>{res.setHeader("Cache-Control","no-store, private");res.setHeader("Pragma","no-cache");try{await handler(c,a,req,res);}catch(error){respond(res,error);}};
  return{
    list:wrap((c,_a,req,res)=>res.json(service.list(c,req.params.companyId))),
    revision:wrap((c,_a,req,res)=>res.json(service.revision(c,req.params.companyId,req.params.sourceId,req.params.revisionId))),
    publication:wrap((c,_a,req,res)=>res.json(service.current(c,req.params.companyId))),
    createManual:wrap(async(c,a,req,res)=>res.status(201).json(await service.create(c,a,req.params.companyId,"manual_text",req.body))),
    createUrl:wrap(async(c,a,req,res)=>res.status(201).json(await service.create(c,a,req.params.companyId,"public_url",req.body))),
    createPdf:wrap(async(c,a,req,res)=>res.status(201).json(await service.create(c,a,req.params.companyId,"pdf",{name:req.query.name},buffer(req.body)))),
    reviseManual:wrap(async(c,a,req,res)=>res.status(201).json(await service.revise(c,a,req.params.companyId,req.params.sourceId,"manual_text",req.body))),
    reviseUrl:wrap(async(c,a,req,res)=>res.status(201).json(await service.revise(c,a,req.params.companyId,req.params.sourceId,"public_url",req.body))),
    revisePdf:wrap(async(c,a,req,res)=>res.status(201).json(await service.revise(c,a,req.params.companyId,req.params.sourceId,"pdf",{expectedSourceVersion:Number(req.query.expectedSourceVersion)},buffer(req.body)))),
    archive:wrap((c,_a,req,res)=>res.json(service.archive(c,req.params.companyId,req.params.sourceId,req.body))),
    publish:wrap((c,a,req,res)=>{const result=service.publish(c,a,req.params.companyId,req.body);res.status(result.status==="created"?201:200).json(result.version);}),
  };
}
function buffer(value:unknown):Uint8Array{if(!Buffer.isBuffer(value))throw new KnowledgeDomainError("unsupported_pdf");return value;}
function respond(res:Response,error:unknown):void{if(!(error instanceof KnowledgeDomainError)){console.error("Company Knowledge failed.",error);res.status(503).json({error:{code:"knowledge_temporarily_unavailable",message:"Company Knowledge is temporarily unavailable."}});return;}const code=error.code;if(code==="resource_not_found"){res.status(404).json({error:"Resource not found."});return;}const status=code==="knowledge_unavailable"?404:code==="knowledge_input_too_large"?413:code==="unsupported_pdf"||code==="url_media_type_unsupported"||code==="url_content_encoding_unsupported"?415:code==="pdf_text_empty"||code==="url_content_empty"||code==="manual_content_empty"||code==="knowledge_extraction_invalid"?422:code.includes("timeout")||code.includes("unavailable")||code==="pdf_parse_failed"?503:code.includes("changed")||code.includes("conflict")||code.includes("archived")||code.includes("not_ready")||code.includes("mismatch")||code.includes("in_progress")||code==="knowledge_limit_exceeded"?409:400;const details=safeDetails(code,error.details);res.status(status).json({error:{code,message:safeMessage(code),...(details===undefined?{}:{details})}});}
function safeMessage(code:string):string{return({knowledge_unavailable:"Published Company Knowledge was not found.",knowledge_conflict:"Knowledge contains conflicts.",knowledge_publication_changed:"Published Company Knowledge changed.",knowledge_input_too_large:"Knowledge input is too large.",unsupported_pdf:"PDF is not supported.",pdf_text_empty:"PDF contains no usable text.",invalid_public_url:"Public URL is invalid."} as Record<string,string>)[code]??"Company Knowledge request could not be completed.";}
function safeDetails(code:string,details:unknown):unknown{if(!details||typeof details!=="object"||Array.isArray(details))return undefined;const value=details as Record<string,unknown>;if(typeof value.revisionId==="string")return{revisionId:value.revisionId};if(code==="knowledge_limit_exceeded"&&Object.keys(value).length===1&&typeof value.field==="string")return{field:value.field};if(code==="knowledge_conflict"&&Object.keys(value).length===2&&typeof value.field==="string"&&Array.isArray(value.revisionIds)&&value.revisionIds.every(id=>typeof id==="string"))return{field:value.field,revisionIds:value.revisionIds};return undefined;}
