import { MessageChannel, type MessagePort, Worker, receiveMessageOnPort } from "node:worker_threads";

export type SqlArgument = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  get(...args: SqlArgument[]): unknown;
  all(...args: SqlArgument[]): unknown[];
  run(...args: SqlArgument[]): { readonly changes: number | bigint; readonly lastInsertRowid: number | bigint; };
}

export interface SynchronousDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  readonly isTransaction: boolean;
  close(): void;
}

interface WorkerResponse { readonly id: number; readonly value?: { readonly rows?: unknown[]; readonly rowsAffected?: number | bigint; readonly lastInsertRowid?: number | bigint; }; readonly error?: { readonly message: string; readonly code?: string | undefined; }; }

export class SynchronousLibsqlDatabase implements SynchronousDatabase {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private nextId = 1;
  private inTransaction = false;
  private closed = false;

  public constructor(url: string, authToken: string) {
    const channel = new MessageChannel();
    this.port = channel.port1;
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    this.worker = new Worker(new URL(`./libsqlWorker.${extension}`, import.meta.url), { workerData: { url, authToken }, execArgv: extension === "ts" ? ["--import", "tsx"] : [] });
    this.worker.postMessage({ port: channel.port2 }, [channel.port2]);
  }

  public get isTransaction(): boolean { return this.inTransaction; }

  public prepare(sql: string): SqlStatement {
    return {
      get: (...args) => this.request("query", sql, args).rows?.[0],
      all: (...args) => this.request("query", sql, args).rows ?? [],
      run: (...args) => {
        const value = this.request("execute", sql, args);
        return { changes: value.rowsAffected ?? 0, lastInsertRowid: value.lastInsertRowid ?? 0 };
      },
    };
  }

  public exec(sql: string): void {
    const command = sql.trim().replace(/;$/, "").toUpperCase();
    if (command === "BEGIN IMMEDIATE" || command === "BEGIN") { this.request("begin"); this.inTransaction = true; return; }
    if (command === "COMMIT") { this.request("commit"); this.inTransaction = false; return; }
    if (command === "ROLLBACK") { this.request("rollback"); this.inTransaction = false; return; }
    this.request("exec", sql);
  }

  public close(): void {
    if (this.closed) return;
    try { this.request("close"); } finally { this.closed = true; void this.worker.terminate(); this.port.close(); }
  }

  private request(action: "execute" | "query" | "exec" | "begin" | "commit" | "rollback" | "close", sql?: string, args?: SqlArgument[]): NonNullable<WorkerResponse["value"]> {
    if (this.closed) throw new Error("Database is closed.");
    const id = this.nextId++;
    this.port.postMessage({ id, action, sql, args });
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 30_000;
    for (;;) {
      const message = receiveMessageOnPort(this.port)?.message as WorkerResponse | undefined;
      if (message?.id === id) {
        if (message.error) { const error = new Error(message.error.message) as Error & { code?: string }; if (message.error.code !== undefined) error.code = message.error.code; throw error; }
        return message.value ?? {};
      }
      if (Date.now() >= deadline) throw new Error("libSQL request timed out.");
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
}
