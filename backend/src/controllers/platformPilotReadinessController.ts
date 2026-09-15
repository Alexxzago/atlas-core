import type { RequestHandler } from "express";
import type { PlatformPilotReadinessService } from "../platformAdmin/services/platformPilotReadinessService.js";

export function createPlatformPilotReadinessController(service:PlatformPilotReadinessService):RequestHandler{return async(request,response)=>{try{response.json({data:await service.workspace(request.params.workspaceId)});}catch{response.status(404).json({error:"Resource not found."});}};}
