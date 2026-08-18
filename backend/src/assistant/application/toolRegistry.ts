import { AssistantCapabilityCatalog } from "../domain/assistantCapability.js";
import { type ToolDefinition, type ToolSchema, ToolSchemaError } from "../domain/tool.js";
import type { ModelToolDeclaration } from "./toolContracts.js";

export class ToolRegistryError extends Error {}
export class ToolRegistry {
  private readonly tools: ReadonlyMap<string, ToolDefinition>;
  public constructor(catalog: AssistantCapabilityCatalog, definitions: readonly ToolDefinition[]) {
    const tools = new Map<string, ToolDefinition>();
    for (const definition of definitions) {
      if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(definition.name) || tools.has(definition.name)) throw new ToolRegistryError("Tool name is invalid or duplicated.");
      if (!definition.description.trim() || !Number.isSafeInteger(definition.timeoutMilliseconds) || definition.timeoutMilliseconds < 1 || definition.timeoutMilliseconds > 30_000) throw new ToolRegistryError("Tool definition is invalid.");
      if (definition.requiredCapabilities.length === 0) throw new ToolRegistryError("Tools require at least one capability.");
      if ((definition.operationClass === "write" || definition.operationClass === "sensitive_write") && definition.idempotencyPolicy !== "source_owned_required") throw new ToolRegistryError("Write tools require source-owned idempotency.");
      try { validateDefinitionSchema(definition.inputSchema); validateDefinitionSchema(definition.outputSchema); }
      catch { throw new ToolRegistryError("Tool schema is invalid."); }
      for (const capability of definition.requiredCapabilities) try { catalog.require(capability); } catch { throw new ToolRegistryError("Tool references an unknown capability."); }
      tools.set(definition.name, Object.freeze({ ...definition, requiredCapabilities: Object.freeze([...definition.requiredCapabilities]), auditPolicy: Object.freeze({ inputFields: Object.freeze([...definition.auditPolicy.inputFields ?? []]), outputFields: Object.freeze([...definition.auditPolicy.outputFields ?? []]) }) }));
    }
    this.tools = tools; Object.freeze(this);
  }
  public get(name: string): ToolDefinition | null { return this.tools.get(name) ?? null; }
  public list(): readonly ToolDefinition[] { return Object.freeze([...this.tools.values()]); }
  public declarations(tools: readonly ToolDefinition[]): readonly ModelToolDeclaration[] { return Object.freeze(tools.map(({ name, description, inputSchema }) => Object.freeze({ name, description, inputSchema }))); }
}
function validateDefinitionSchema(schema: ToolSchema): void {
  if (schema.type === "string" && (!Number.isSafeInteger(schema.maxLength) || schema.maxLength < 1 || schema.maxLength > 10_000)) throw new ToolSchemaError();
  if (schema.type === "enum" && (schema.values.length < 1 || schema.values.length > 100 || new Set(schema.values).size !== schema.values.length)) throw new ToolSchemaError();
  if (schema.type === "array") { if (!Number.isSafeInteger(schema.maxItems) || schema.maxItems < 1 || schema.maxItems > 100) throw new ToolSchemaError(); validateDefinitionSchema(schema.items); }
  if (schema.type === "object") { if (!Number.isSafeInteger(schema.maxProperties) || schema.maxProperties < 1 || schema.maxProperties > 100) throw new ToolSchemaError(); for (const required of schema.required ?? []) if (!(required in schema.properties)) throw new ToolSchemaError(); for (const child of Object.values(schema.properties)) validateDefinitionSchema(child); }
}
