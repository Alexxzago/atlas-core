import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { Router } from "express";
import { AssistantCapabilityCatalog, assistantCapabilityKey, type AssistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { ToolRegistry } from "../assistant/application/toolRegistry.js";
import type { ToolDefinition } from "../assistant/domain/tool.js";
import { AssistantCapabilityCatalogService } from "../assistant/services/assistantCapabilityCatalogService.js";
import { AssistantCapabilityService } from "../assistant/services/assistantCapabilityService.js";
import { createListAssistantCapabilityCatalogController, createReplaceAssistantCapabilitiesController } from "../controllers/assistantCapabilityController.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const profileId = "asp_0123456789abcdef0123456789abcdef";
const context = createWorkspaceContext({ id: 7, key: "catalog" } as never);
const secrets = ["provider-token-hostile", "customer@example.test", "https://private.example.test/secret"];

class Capabilities {
  public values = new Set<AssistantCapabilityKey>([assistantCapabilityKey("orders.read")]);
  public async listForProfile(): Promise<readonly AssistantCapabilityKey[]> { return [...this.values]; }
  public async existsForProfile(): Promise<boolean> { return true; }
  public async replaceForProfile(_context: { readonly workspaceId: number }, _companyId: number, _profileId: string, capabilities: readonly AssistantCapabilityKey[]): Promise<boolean> { this.values = new Set(capabilities); return true; }
}

function tool(name: string, capability: AssistantCapabilityKey, operationClass: ToolDefinition["operationClass"], secret: string = ""): ToolDefinition {
  return { name, description: `Catalog test tool ${secret}`, inputSchema: { type: "object", maxProperties: 1, properties: {} }, outputSchema: { type: "object", maxProperties: 1, properties: {} }, requiredCapabilities: [capability], operationClass, timeoutMilliseconds: 100, idempotencyPolicy: operationClass === "read" ? "not_applicable" : "source_owned_required", confirmationPolicy: "none", auditPolicy: {}, integration: { provider: secret, kind: secrets[2]! }, executor: async () => ({}) };
}

function listen(app: express.Express): Promise<{ readonly server: ReturnType<express.Express["listen"]>; readonly origin: string }> {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => server.once("listening", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

function close(server: ReturnType<express.Express["listen"]>): Promise<void> { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

test("EPIC048 PASS3 catalog endpoint projects assignment synchronization, availability, consequences, and safe output", async () => {
  const read = assistantCapabilityKey("orders.read"), write = assistantCapabilityKey("orders.create"), sensitive = assistantCapabilityKey("payments.refund");
  const catalog = new AssistantCapabilityCatalog([{ key: read, kind: "tool" }, { key: write, kind: "tool" }, { key: sensitive, kind: "tool" }]);
  const repository = new Capabilities();
  const registry = new ToolRegistry(catalog, [tool("orders.lookup", read, "read", secrets[0]), tool("orders.lookup_backup", read, "read", secrets[1]), tool("orders.create", write, "write", secrets[2]), tool("payments.refund", sensitive, "sensitive_write", secrets[0])]);
  const availability = { isAvailable: async (definition: ToolDefinition, received: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }) => {
    assert.deepEqual(received, { workspaceId: 7, companyId: 3, assistantProfileId: profileId });
    return definition.name !== "orders.lookup_backup" && definition.name !== "payments.refund";
  } };
  const catalogService = new AssistantCapabilityCatalogService(catalog, repository, registry, availability);
  const capabilityService = new AssistantCapabilityService(catalog, repository, { now: () => "2026-09-08T00:00:00.000Z" });
  const app = express();
  app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: async (value: string) => value === "reader" || value === "manager" ? { userId: value } : null, validateCsrf: async () => true } as never,
    users: { findById: async (id: string) => ({ id }) } as never,
    authorization: { authorize: async (user: { id: string }) => user.id === "reader" ? { userId: user.id, membershipId: "member", role: "viewer", capabilities: new Set(["company:read"]) } : { userId: user.id, membershipId: "member", role: "administrator", capabilities: new Set(["company:read", "assistant:capability:manage"]) } } as never,
    resolver: { resolve: async () => context } as never,
    controllers: {} as never,
    assistantControllers: {} as never,
    assistantCapabilityControllers: { list: () => (_req, res) => res.status(501).end(), catalog: (workspace) => createListAssistantCapabilityCatalogController(catalogService, workspace), replace: (workspace, actor) => createReplaceAssistantCapabilitiesController(capabilityService, workspace, actor) },
  }));
  const { server, origin } = await listen(app);
  const path = `${origin}/workspaces/wsp_catalog/companies/3/assistant-profiles/${profileId}/capabilities`;
  try {
    const initial = await fetch(`${path}/catalog`, { headers: { cookie: "atlas=reader" } });
    const initialBody = await initial.json() as { capabilities: Array<Record<string, unknown>> };
    assert.equal(initial.status, 200);
    assert.deepEqual(initialBody.capabilities, [
      { id: "orders.read", assigned: true, availability: "degraded", consequence: "read_only", safeReason: "Esta capacidad necesita una integración configurada.", safeNextAction: "Revisá las integraciones de la empresa.", toolCount: 2 },
      { id: "orders.create", assigned: false, availability: "available", consequence: "consequential", safeReason: null, safeNextAction: null, toolCount: 1 },
      { id: "payments.refund", assigned: false, availability: "unavailable", consequence: "consequential", safeReason: "Esta capacidad necesita una integración configurada.", safeNextAction: "Revisá las integraciones de la empresa.", toolCount: 1 },
    ]);
    const serialized = JSON.stringify(initialBody);
    assert.ok(secrets.every((secret) => !serialized.includes(secret)));
    assert.equal((await fetch(path, { method: "PUT", headers: { cookie: "atlas=reader", "content-type": "application/json" }, body: JSON.stringify({ capabilities: [] }) })).status, 404);
    const replaced = await fetch(path, { method: "PUT", headers: { cookie: "atlas=manager", origin, "x-csrf-token": "csrf", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify({ capabilities: [] }) });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await replaced.json(), { capabilities: [] });
    const synchronized = await fetch(`${path}/catalog`, { headers: { cookie: "atlas=reader" } });
    assert.equal(synchronized.status, 200);
    assert.ok((await synchronized.json() as { capabilities: Array<{ assigned: boolean }> }).capabilities.every((item) => !item.assigned));
  } finally { await close(server); }
});
