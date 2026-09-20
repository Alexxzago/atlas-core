import type { AssistantExecutionRecord, AssistantExecutionRecordId } from "../domain/operationalAssistantRuntime.js";

export interface AssistantExecutionRecordRepositoryPort {
  create(record: AssistantExecutionRecord): Promise<AssistantExecutionRecord>;
  complete(record: AssistantExecutionRecord, expectedState: "started"): Promise<boolean>;
}
