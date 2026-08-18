export type AssistantCapabilityKey = string & { readonly __assistantCapabilityKey: unique symbol };

export interface AssistantCapabilityDefinition {
  readonly key: AssistantCapabilityKey;
  readonly kind: "tool" | "behavior";
}

export class AssistantCapabilityError extends Error {}

export function assistantCapabilityKey(value: string): AssistantCapabilityKey {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value)) {
    throw new AssistantCapabilityError("Assistant capability key is invalid.");
  }
  return value as AssistantCapabilityKey;
}

/** Immutable code-owned catalogue; production starts with no executable capabilities. */
export class AssistantCapabilityCatalog {
  private readonly definitions: ReadonlyMap<AssistantCapabilityKey, AssistantCapabilityDefinition>;

  public constructor(definitions: readonly AssistantCapabilityDefinition[]) {
    const values = new Map<AssistantCapabilityKey, AssistantCapabilityDefinition>();
    for (const definition of definitions) {
      const key = assistantCapabilityKey(definition.key);
      if (values.has(key)) throw new AssistantCapabilityError("Assistant capability is duplicated.");
      values.set(key, Object.freeze({ key, kind: definition.kind }));
    }
    this.definitions = values;
    Object.freeze(this);
  }

  public has(key: string): key is AssistantCapabilityKey { return this.definitions.has(key as AssistantCapabilityKey); }
  public require(key: string): AssistantCapabilityKey {
    const parsed = assistantCapabilityKey(key);
    if (!this.definitions.has(parsed)) throw new AssistantCapabilityError("Assistant capability is unknown.");
    return parsed;
  }
  public list(): readonly AssistantCapabilityDefinition[] { return Object.freeze([...this.definitions.values()]); }
}

export const productionAssistantCapabilityCatalog = new AssistantCapabilityCatalog([
  { key: assistantCapabilityKey("live_data.read"), kind: "tool" },
]);
