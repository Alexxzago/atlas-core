import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { assistantCapabilityKey, AssistantCapabilityCatalog, type AssistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import type { ToolDefinition } from "../assistant/domain/tool.js";
import { AssistantToolCatalogService } from "../assistant/services/assistantToolCatalogService.js";
import { createListAssistantToolCatalogController } from "../controllers/assistantCapabilityController.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const profileId = "asp_0123456789abcdef0123456789abcdef";
const context = createWorkspaceContext({ id: 7, key: "tools" } as never);
const forbidden = ["schema", "parameters", "function", "handler", "providerSecret", "credential", "token", "secret", "trace", "payload", "rawError", "stack", "headers", "authorization", "apiKey", "endpoint", "memoryPolicy"];
class Capabilities { public values = new Set<AssistantCapabilityKey>([assistantCapabilityKey("orders.read")]); public async listForProfile(): Promise<readonly AssistantCapabilityKey[]> { return [...this.values]; } public async existsForProfile(): Promise<boolean> { return true; } public async replaceForProfile(): Promise<boolean> { return true; } }
function tool(name: string, capability: AssistantCapabilityKey): ToolDefinition { return { name, description: "internal handler secret schema", inputSchema: { type: "object", maxProperties: 1, properties: {} }, outputSchema: { type: "object", maxProperties: 1, properties: {} }, requiredCapabilities: [capability], operationClass: "read", timeoutMilliseconds: 100, idempotencyPolicy: "not_applicable", confirmationPolicy: "none", auditPolicy: {}, executor: async () => ({}) }; }
function listen(app: express.Express): Promise<{ server: ReturnType<express.Express["listen"]>; origin: string }> { const server = app.listen(0, "127.0.0.1"); return new Promise(resolve => server.once("listening", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))); }
function close(server: ReturnType<express.Express["listen"]>): Promise<void> { return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

test("EPIC048 PASS4 tool catalog is exact, safe, company-readable, and non-disclosing", async () => {
  const read = assistantCapabilityKey("orders.read"), unavailable = assistantCapabilityKey("orders.unavailable");
  const catalog = new AssistantCapabilityCatalog([{ key: read, kind: "tool" }, { key: unavailable, kind: "tool" }]);
  const registry = new ToolRegistry(catalog, [tool("orders.lookup", read), tool("orders.unavailable", unavailable)]);
  const service = new AssistantToolCatalogService(new Capabilities(), registry, { isAvailable: async definition => definition.name !== "orders.unavailable" });
  const app = express(); app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: async (value: string) => value === "reader" ? { userId: value } : null, validateCsrf: async () => true } as never,
    users: { findById: async (id: string) => ({ id }) } as never,
    authorization: { authorize: async () => ({ userId: "reader", membershipId: "member", role: "viewer", capabilities: new Set(["company:read"]) }) } as never,
    resolver: { resolve: async () => context } as never, controllers: {} as never, assistantControllers: {} as never,
    assistantCapabilityControllers: { list: () => (_req, res) => res.status(501).end(), catalog: () => (_req, res) => res.status(501).end(), toolsCatalog: workspace => createListAssistantToolCatalogController(service, workspace), replace: () => (_req, res) => res.status(501).end() },
  }));
  const { server, origin } = await listen(app); const path = `${origin}/workspaces/wsp_tools/companies/3/assistant-profiles/${profileId}/tools/catalog`;
  try {
    const response = await fetch(path, { headers: { cookie: "atlas=reader" } }); assert.equal(response.status, 200);
    const body = await response.json() as { tools: Array<Record<string, unknown>> };
    assert.deepEqual(body, { tools: [{ id: "orders.lookup", enabled: true, availability: "available", capabilityId: "orders.read", safeReason: null, safeNextAction: null }, { id: "orders.unavailable", enabled: false, availability: "unavailable", capabilityId: "orders.unavailable", safeReason: "Esta herramienta necesita una configuración pendiente.", safeNextAction: "Revisá la configuración de la empresa." }] });
    assert.deepEqual(body.tools.map(item => item.id), registry.list().map(item => item.name));
    assert.ok(body.tools.every(item => Object.keys(item).length === 6));
    const serialized = JSON.stringify(body).toLowerCase(); assert.ok(forbidden.every(value => !serialized.includes(value.toLowerCase())));
    assert.equal((await fetch(path, { headers: { cookie: "atlas=outsider" } })).status, 404);
    assert.equal((await fetch(`${origin}/workspaces/wsp_tools/companies/3/assistant-profiles/asp_invalid/tools/catalog`, { headers: { cookie: "atlas=reader" } })).status, 404);
  } finally { await close(server); }
});
