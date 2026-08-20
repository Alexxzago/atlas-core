import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { MediaRepository } from "../../repositories/mediaRepository.js";
import { MediaDomainError } from "../../media/domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

interface Input { readonly path: string; readonly workspaceId: number; readonly companyId: number; readonly assetId: string; readonly operation: "attach" | "delete"; readonly gate: SharedArrayBuffer; readonly waitForStart?: boolean; }
const input=workerData as Input, gate=new Int32Array(input.gate), context:WorkspaceContext={workspaceId:input.workspaceId,workspaceKey:"default"}, database=new DatabaseSync(input.path);
// Worker threads do not share the in-process coordinator. This is SQLite's lock wait, not a retry.
database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
const repository=new MediaRepository(database,{beforeBegin:operation=>{if(operation!==input.operation||!input.waitForStart)return;Atomics.store(gate,4,1);Atomics.notify(gate,4);},beforeCommit:operation=>{if(operation!==input.operation)return;Atomics.store(gate,2,1);Atomics.notify(gate,2);Atomics.wait(gate,0,0);}});
Atomics.store(gate,3,1);Atomics.notify(gate,3);
if(input.waitForStart)Atomics.wait(gate,1,0);
try{if(input.operation==="attach"){const result=repository.createAssociation(context,{id:"maa_"+input.operation+"_"+Math.random().toString(16).slice(2),workspaceId:input.workspaceId,companyId:input.companyId,assetId:input.assetId,ownerType:"tool_result",ownerId:"owner",createdAt:"2026-08-18T00:00:00.000Z"},"2026-08-18T00:00:00.000Z",()=>true);parentPort?.postMessage({kind:"result",result:result?"attach_success":"media_not_associable"});}else{const result=repository.delete(context,input.companyId,input.assetId,"2026-08-18T00:00:00.000Z");parentPort?.postMessage({kind:"result",result:result?"delete_success":"media_not_found"});}}catch(error){parentPort?.postMessage({kind:"result",result:error instanceof MediaDomainError?error.code:"unexpected_error"});}finally{database.close();}
