import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createApp } from "../app.js";
import { setShuttingDown } from "../routes/health.js";

test("EPIC-016.8 /health and /ready return 200/503 based on shuttingDown state", async () => {
  const empty = express.Router();
  const app = createApp({
    authorizedCompaniesRouter: empty,
    chatRouter: empty,
    companiesRouter: empty,
    identityRouter: empty,
    knowledgeRouter: empty,
    publicWebChatRouter: empty,
    scrapeRouter: empty,
    workspacesRouter: empty,
  }, { production: false, trustedLocalMode: false });

  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  try {
    // 1. Initial State: Healthy
    setShuttingDown(false);

    const healthOk = await fetch(`${origin}/health`);
    assert.equal(healthOk.status, 200);
    const healthJsonOk = await healthOk.json() as Record<string, unknown>;
    assert.equal(healthJsonOk.status, "online");

    const readyOk = await fetch(`${origin}/ready`);
    assert.equal(readyOk.status, 200);
    const readyJsonOk = await readyOk.json() as Record<string, unknown>;
    assert.equal(readyJsonOk.status, "ready");

    // 2. Shutting Down State: Returns 503 with shutting_down
    setShuttingDown(true);

    const healthShutdown = await fetch(`${origin}/health`);
    assert.equal(healthShutdown.status, 503);
    const healthJsonShutdown = await healthShutdown.json() as Record<string, unknown>;
    assert.deepEqual(healthJsonShutdown, { status: "shutting_down" });

    const readyShutdown = await fetch(`${origin}/ready`);
    assert.equal(readyShutdown.status, 503);
    const readyJsonShutdown = await readyShutdown.json() as Record<string, unknown>;
    assert.deepEqual(readyJsonShutdown, { status: "shutting_down" });

  } finally {
    setShuttingDown(false); // Restore state for subsequent tests/executions
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});
