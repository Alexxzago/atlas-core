import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

interface Input { readonly path: string; readonly sql: string; readonly parameters: readonly SQLInputValue[]; }

const input = workerData as Input;
if (!parentPort) throw new Error("Billing capacity race worker requires a parent port.");
const database = new DatabaseSync(input.path);
database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
parentPort.postMessage({ status: "ready" });
parentPort.once("message", (message: unknown) => {
  if (message !== "start") return;
  try { database.prepare(input.sql).run(...input.parameters); parentPort!.postMessage({ status: "success" }); }
  catch { parentPort!.postMessage({ status: "rejected" }); }
  finally { database.close(); }
});
