import type { AssistantExecutionRequest, AssistantExecutionResult } from "./assistantExecution.js";

export interface AssistantExecutionPort {
  execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult>;
}
