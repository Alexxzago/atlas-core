import type { RequestHandler } from "express";
import { PlatformAdministrationValidationError, type PlatformAdministrationService } from "../platformAdmin/services/platformAdministrationService.js";

function safe(handler:RequestHandler):RequestHandler{return(req,res,next)=>{try{handler(req,res,next);}catch(error){if(error instanceof PlatformAdministrationValidationError){res.status(400).json({error:"Invalid admin query."});return;}next(error);}};}
export function createPlatformAdminControllers(service:PlatformAdministrationService):Record<"overview"|"workspaces",RequestHandler>{return{overview:safe((_req,res)=>res.json({data:service.overview()})),workspaces:safe((req,res)=>res.json({data:service.workspaces(req.query.cursor,req.query.limit)}))};}
