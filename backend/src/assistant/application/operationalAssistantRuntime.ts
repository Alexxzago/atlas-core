import type { AssistantExecutionRecord, AssistantExecutionRecordId } from "../domain/operationalAssistantRuntime.js";

export interface AssistantExecutionRecordRepositoryPort {
  create(record: AssistantExecutionRecord): AssistantExecutionRecord;
  complete(record: AssistantExecutionRecord, expectedState: "started"): boolean;
}
