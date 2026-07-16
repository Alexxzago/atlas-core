import { parentPort, workerData } from "node:worker_threads";
import { createDatabase } from "../../config/database.js";
import { reconstructAssistantProfile, type AssistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileRepository } from "../../repositories/assistantProfileRepository.js";

interface WorkerInput { path: string; workspaceId: number; workspaceKey: string; companyId: number; id: string; name: string; }
const input = workerData as WorkerInput;
if (!parentPort) throw new Error("Assistant Profile worker requires a parent port.");
const port = parentPort;
const database = createDatabase(input.path);
database.exec("PRAGMA busy_timeout = 5000;");
port.postMessage({ status: "ready" });
port.once("message", (message: unknown) => {
  if (message !== "start") return;
  try {
    const at = "2026-07-16T12:00:00.000Z";
    const profile = reconstructAssistantProfile({ id: input.id as AssistantProfileId, companyId: input.companyId, name: input.name, normalizedName: input.name.trim().toLowerCase(), description: null, businessRole: null, objective: null, audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Safe fallback", status: "draft", createdAt: at, updatedAt: at, archivedAt: null });
    const result = new AssistantProfileRepository(database).create({ workspaceId: input.workspaceId, workspaceKey: input.workspaceKey }, input.companyId, profile);
    port.postMessage({ status: "result", result: result.status });
  } catch (error: unknown) {
    port.postMessage({ status: "error", error: error instanceof Error ? error.name : "unknown" });
  } finally {
    database.close();
  }
});
