import { parentPort, workerData } from "node:worker_threads";
import { createDatabase } from "../../config/database.js";
import { SystemClock } from "../../identity/infrastructure/systemClock.js";
import { createSystemActorContext } from "../../knowledge/domain/actorContext.js";
import { KnowledgeDomainError } from "../../knowledge/domain/knowledge.js";
import { KnowledgeService } from "../../knowledge/services/knowledgeServices.js";
import { CompanyKnowledgeRepository } from "../../repositories/companyKnowledgeRepository.js";
import { CompanyRepository } from "../../repositories/companyRepository.js";

type Operation = "reserve" | "terminal" | "archive" | "publication";
interface WorkerInput { path: string; operation: Operation; workspaceId: number; workspaceKey: string; companyId: number; sourceId?: string; revisionId?: string; expectedSourceVersion?: number; expectedKnowledgeVersionId?: string | null; revisionIds?: string[]; at: string; }

const input = workerData as WorkerInput;
if (!parentPort) throw new Error("Company Knowledge race worker requires a parent port.");
const port = parentPort;
const database = createDatabase(input.path);
database.exec("PRAGMA busy_timeout = 5000;");
const context = { workspaceId: input.workspaceId, workspaceKey: input.workspaceKey };
const repository = new CompanyKnowledgeRepository(database);

port.postMessage({ status: "ready" });
port.once("message", (message: unknown) => {
  if (message !== "start") return;
  try {
    let result: string;
    if (input.operation === "reserve") {
      const revision = repository.reserveRevision(context, input.companyId, { sourceId: required(input.sourceId), revisionId: required(input.revisionId), locator: null, expectedSourceVersion: required(input.expectedSourceVersion), mediaType: "text/plain", inputBytes: 1, createdAt: input.at, abandonedBefore: "2026-07-19T00:00:00.000Z" });
      result = `created:${revision.revisionNumber}`;
    } else if (input.operation === "terminal") {
      result = `changed:${Number(repository.failRevision(context, input.companyId, required(input.revisionId), "ingestion_interrupted", input.at))}`;
    } else if (input.operation === "archive") {
      result = `changed:${Number(repository.archiveSource(context, input.companyId, required(input.sourceId), required(input.expectedSourceVersion), input.at) !== null)}`;
    } else {
      const service = new KnowledgeService(new CompanyRepository(database), repository, { acquire: async () => { throw new Error("URL acquisition is not used by this worker."); } }, { extract: async () => { throw new Error("PDF extraction is not used by this worker."); } }, { extract: async () => { throw new Error("Fact extraction is not used by this worker."); } }, new SystemClock());
      const published = service.publish(context, createSystemActorContext("knowledge-race"), input.companyId, { sourceRevisionIds: input.revisionIds ?? [], expectedKnowledgeVersionId: input.expectedKnowledgeVersionId ?? null });
      result = published.status;
    }
    port.postMessage({ status: "result", result });
  } catch (error: unknown) {
    const code = error instanceof KnowledgeDomainError ? error.code : error instanceof Error ? error.name : "unknown";
    port.postMessage({ status: "result", result: code === "knowledge_publication_changed" ? "changed" : `error:${code}` });
  } finally {
    database.close();
  }
});

function required<T>(value: T | undefined): T { if (value === undefined) throw new Error("Missing race worker input."); return value; }
