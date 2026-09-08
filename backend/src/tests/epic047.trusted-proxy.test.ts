import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";

async function requestIp(production: boolean, forwarded?: string): Promise<string> {
  const router = Router(); router.get("/client-ip", (request, response) => response.json({ ip: request.ip }));
  const app = createApp({ authorizedCompaniesRouter: Router(), chatRouter: Router(), companiesRouter: Router(), identityRouter: Router(), knowledgeRouter: Router(), publicWebChatRouter: router, scrapeRouter: Router(), workspacesRouter: Router() }, { production, trustedLocalMode: true });
  const server = app.listen(0, "127.0.0.1");
  try { await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address() as AddressInfo; const response = await fetch(`http://127.0.0.1:${address.port}/public/web-chat/client-ip`, { headers: forwarded ? { "x-forwarded-for": forwarded } : {} }); return (await response.json() as { ip: string }).ip; }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("EPIC047 client IP boundary uses the connected peer for direct, proxied, and spoofed production requests", async () => {
  assert.equal(await requestIp(true), "127.0.0.1");
  assert.equal(await requestIp(true, "198.51.100.10"), "127.0.0.1");
  assert.equal(await requestIp(true, "203.0.113.9, 198.51.100.10"), "127.0.0.1");
});

test("EPIC047 development also ignores forwarding headers", async () => { assert.equal(await requestIp(false, "203.0.113.9"), "127.0.0.1"); });
