import { randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { ToolExecutionTraceRepositoryPort } from "../application/toolContracts.js";
import type { ToolDefinition, ToolExecutionContext } from "../domain/tool.js";
import { ToolSchemaError, validateToolSchema } from "../domain/tool.js";

export type ToolExecutionFailureCode = "invalid_tool_input" | "invalid_tool_output" | "tool_timeout" | "tool_execution_failed" | "confirmation_required" | "idempotency_required" | "multiple_tool_calls_not_allowed";
export class ToolExecutionError extends Error { public constructor(readonly code: ToolExecutionFailureCode) { super(code); } }
const MAX_AUDIT_DEPTH = 4;
const MAX_AUDIT_COLLECTION_ITEMS = 20;
const MAX_AUDIT_STRING_BYTES = 512;
const MAX_AUDIT_PAYLOAD_BYTES = 2_048;
const REDACTED_AUDIT_VALUE = "[redacted]";
const sensitiveAuditKeys = new Set(["authorization","token","accesstoken","refreshtoken","apikey","secret","password","passwd","cookie","setcookie","credential","credentials","clientsecret","privatekey"]);

export class ToolExecutionService {
  public constructor(private readonly traces: ToolExecutionTraceRepositoryPort, private readonly clock: Clock) {}
  public async execute(definition: ToolDefinition, context: ToolExecutionContext, input: unknown): Promise<unknown> {
    if (definition.requiredCapabilities.length === 0) throw new ToolExecutionError("tool_execution_failed");
    if (definition.confirmationPolicy !== "none" && (!context.confirmation || context.confirmation.kind !== definition.confirmationPolicy)) throw new ToolExecutionError("confirmation_required");
    if ((definition.operationClass === "write" || definition.operationClass === "sensitive_write") && !context.idempotencyKey) throw new ToolExecutionError("idempotency_required");
    let validatedInput: unknown;
    try { validatedInput=validateToolSchema(definition.inputSchema,input); } catch (error:unknown) { if(error instanceof ToolSchemaError)throw new ToolExecutionError("invalid_tool_input"); throw error; }
    const started=this.clock.now(), traceId=`ttr_${randomUUID().replaceAll("-","")}`;
    await this.traces.createRequested({id:traceId,assistantExecutionRecordId:context.assistantExecutionRecordId,workspaceId:context.workspaceId,companyId:context.companyId,assistantProfileId:context.assistantProfileId,modelToolCallId:context.invocationId,toolName:definition.name,state:"requested",auditInput:redact(validatedInput,definition.auditPolicy.inputFields),requestedAt:started});
    const controller=new AbortController();
    let timer: ReturnType<typeof setTimeout> | null=null;
    let timedOut=false;
    let executorSettled=false;
    const operation=Promise.resolve().then(()=>definition.executor(context,validatedInput,controller.signal));
    const observedOperation=operation.then(
      (output)=>{executorSettled=true;return output;},
      (error:unknown)=>{executorSettled=true;throw error;},
    );
    // Keep a rejection handler attached after timeout; late executor failures are not trace transitions.
    void observedOperation.catch(()=>undefined);
    const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{if(executorSettled)return;timedOut=true;controller.abort();reject(new ToolExecutionError("tool_timeout"));},definition.timeoutMilliseconds);});
    try {
      const output=await Promise.race([observedOperation,timeout]);
      let validatedOutput:unknown;
      try { validatedOutput=validateToolSchema(definition.outputSchema,output); } catch { await this.fail(traceId,"invalid_tool_output",started); throw new ToolExecutionError("invalid_tool_output"); }
      if(!await this.traces.complete(traceId,"requested",{auditOutput:redact(validatedOutput,definition.auditPolicy.outputFields),completedAt:this.clock.now(),durationMilliseconds:duration(started,this.clock.now())})) throw new ToolExecutionError("tool_execution_failed");
      return validatedOutput;
    } catch(error:unknown) {
      if(error instanceof ToolExecutionError){if(error.code==="tool_timeout")await this.fail(traceId,"tool_timeout",started);throw error;}
      const code=timedOut?"tool_timeout":"tool_execution_failed";
      await this.fail(traceId,code,started);
      throw new ToolExecutionError(code);
    } finally { if(timer!==null)clearTimeout(timer); }
  }
  private async fail(traceId:string,code:ToolExecutionFailureCode,started:string):Promise<void>{if(!await this.traces.fail(traceId,"requested",{errorCode:code,completedAt:this.clock.now(),durationMilliseconds:duration(started,this.clock.now())}))throw new ToolExecutionError("tool_execution_failed");}
}
function duration(started:string,completed:string):number{return Math.max(0,Date.parse(completed)-Date.parse(started));}
function redact(value:unknown, allowed:readonly string[]|undefined):unknown { if(!allowed||!value||typeof value!=="object"||Array.isArray(value))return null;const record=value as Record<string,unknown>, output:Record<string,unknown>={};for(const key of allowed){const item=redactValue(record[key],0);if(item!==undefined)output[key]=item;}if(!Object.keys(output).length)return null;return Buffer.byteLength(JSON.stringify(output),"utf8")<=MAX_AUDIT_PAYLOAD_BYTES?Object.freeze(output):null; }
function redactValue(value:unknown,depth:number,seen=new WeakSet<object>()):unknown { if(value===undefined||depth>MAX_AUDIT_DEPTH)return undefined;if(value===null||typeof value==="boolean"||typeof value==="number")return value;if(typeof value==="string")return Buffer.byteLength(value,"utf8")<=MAX_AUDIT_STRING_BYTES?value:undefined;if(typeof value!=="object")return undefined;if(seen.has(value))return "[circular]";seen.add(value);if(Array.isArray(value)){const items=value.slice(0,MAX_AUDIT_COLLECTION_ITEMS).map(item=>redactValue(item,depth+1,seen)).filter(item=>item!==undefined);return Object.freeze(items);}const output:Record<string,unknown>={};for(const [key,item] of Object.entries(value as Record<string,unknown>).slice(0,MAX_AUDIT_COLLECTION_ITEMS)){const safe=isSensitiveAuditKey(key)?REDACTED_AUDIT_VALUE:redactValue(item,depth+1,seen);if(safe!==undefined)output[key]=safe;}return Object.freeze(output); }
function isSensitiveAuditKey(key:string):boolean{return sensitiveAuditKeys.has(key.toLowerCase().replace(/[\s_-]/g,""));}
