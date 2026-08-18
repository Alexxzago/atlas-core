import type { Clock } from "../../identity/application/ports.js";
import type { AssistantProfileCapabilityRepositoryPort, AssistantModelPort, ToolAvailabilityPolicy, ToolResult } from "../application/toolContracts.js";
import { ToolRegistry } from "../application/toolRegistry.js";
import type { ToolExecutionContext } from "../domain/tool.js";
import { ToolExecutionError, ToolExecutionService } from "./toolExecutionService.js";

export class AssistantToolOrchestrator {
  public constructor(private readonly model: AssistantModelPort,private readonly registry:ToolRegistry,private readonly capabilities:AssistantProfileCapabilityRepositoryPort,private readonly availability:ToolAvailabilityPolicy,private readonly execution:ToolExecutionService,private readonly clock:Clock){}
  public async run(prompt:string,context:ToolExecutionContext):Promise<string>{
    const assigned=new Set(await this.capabilities.listForProfile({workspaceId:context.workspaceId},context.companyId,context.assistantProfileId));
    const tools=[];
    for(const tool of this.registry.list())if(tool.requiredCapabilities.every(capability=>assigned.has(capability))&&await this.availability.isAvailable(tool,context))tools.push(tool);
    const results:ToolResult[]=[];
    const session=this.model.createSession();
    for(let toolRounds=0;;){
      const controller=new AbortController(); const step=toolRounds===0
        ? await session.start({prompt,tools:this.registry.declarations(tools)},controller.signal)
        : await session.continue(Object.freeze([...results]),controller.signal);
      if(step.kind==="final")return step.text;
      if(toolRounds>=2)throw new ToolExecutionError("tool_execution_failed");
      if(step.toolCalls.length!==1)throw new ToolExecutionError("multiple_tool_calls_not_allowed");
      const call=step.toolCalls[0]; if(!call)throw new ToolExecutionError("tool_execution_failed");
      const tool=tools.find(value=>value.name===call.toolName);if(!tool)throw new ToolExecutionError("tool_execution_failed");
      const currentCapabilities=new Set(await this.capabilities.listForProfile({workspaceId:context.workspaceId},context.companyId,context.assistantProfileId));
      if(!tool.requiredCapabilities.every(capability=>currentCapabilities.has(capability)))throw new ToolExecutionError("tool_execution_failed");
      if(!await this.availability.isAvailable(tool,context))throw new ToolExecutionError("tool_execution_failed");
      const output=await this.execution.execute(tool,{...context,invocationId:call.id},call.input);
      results.push(Object.freeze({toolCallId:call.id,toolName:tool.name,output}));
      toolRounds++;
    }
  }
}
