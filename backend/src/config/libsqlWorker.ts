import { parentPort, type MessagePort, workerData } from "node:worker_threads";
import { createClient, type InArgs } from "@libsql/client";

interface Request { readonly id: number; readonly action: "execute" | "query" | "exec" | "begin" | "commit" | "rollback" | "close"; readonly sql?: string; readonly args?: unknown[]; }

if (!parentPort) throw new Error("libSQL worker requires a parent port.");

const client = createClient({ url: workerData.url as string, authToken: workerData.authToken as string });
let transaction: Awaited<ReturnType<typeof client.transaction>> | null = null;

function result(value: { rowsAffected?: number | bigint; lastInsertRowid?: number | bigint | undefined; rows?: unknown[] }): object {
  return { rowsAffected: value.rowsAffected ?? 0, lastInsertRowid: value.lastInsertRowid, rows: value.rows ?? [] };
}

parentPort.once("message", ({ port }: { readonly port: MessagePort }) => {
port.on("message", async (request: Request): Promise<void> => {
  try {
    if (request.action === "begin") { transaction = await client.transaction("write"); port.postMessage({ id: request.id, value: {} }); return; }
    if (request.action === "commit") { if (!transaction) throw new Error("No active libSQL transaction."); await transaction.commit(); transaction = null; port.postMessage({ id: request.id, value: {} }); return; }
    if (request.action === "rollback") { if (!transaction) throw new Error("No active libSQL transaction."); await transaction.rollback(); transaction = null; port.postMessage({ id: request.id, value: {} }); return; }
    if (request.action === "close") { if (transaction) await transaction.rollback(); client.close(); port.postMessage({ id: request.id, value: {} }); return; }
    if (!request.sql) throw new Error("libSQL operation requires SQL.");
    if (request.action === "exec") { if (transaction) await transaction.executeMultiple(request.sql); else await client.executeMultiple(request.sql); port.postMessage({ id: request.id, value: {} }); return; }
    const target = transaction ?? client;
    const response = await target.execute({ sql: request.sql, args: (request.args ?? []) as InArgs });
    port.postMessage({ id: request.id, value: result(response) });
  } catch (error: unknown) {
    const detail = error as { message?: unknown; code?: unknown };
    port.postMessage({ id: request.id, error: { message: typeof detail?.message === "string" ? detail.message : "libSQL operation failed.", code: typeof detail?.code === "string" ? detail.code : undefined } });
  }
  });
});
