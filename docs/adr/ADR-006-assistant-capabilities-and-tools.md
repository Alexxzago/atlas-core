# ADR-006: Assistant Capabilities and Tools

**Status:** Accepted — Not Yet Implemented  
**Date:** 2026-07-14

## Context

Atlas must eventually execute controlled business actions such as checking stock, booking appointments, creating tickets, or querying operational systems. Prompt text alone is not an authorization mechanism.

## Decision

Assistant capabilities are explicit application concepts enabled for an assistant profile owned by a company. During the MVP, each company has at most one conceptual assistant profile; multiple assistant entities are postponed.

A capability expresses permitted business behavior and may expose one or more tools. Tools are infrastructure adapters for REST, GraphQL, webhooks, MCP, databases, or internal Atlas actions; they do not own business policy. Execution remains inside the modular monolith.

Application policy authorizes each invocation. Inputs and outputs require runtime validation. Sensitive or irreversible actions may require human confirmation. Execution records must support audit, bounded timeouts, controlled retries, and idempotency where side effects demand it. Tool results may enter the conversation only as labeled, validated execution results. Prompts cannot grant capabilities or override policy.

## Alternatives considered

- Free-form model access to integrations: rejected as unsafe.
- Tools owned directly by channels or providers: rejected because business authorization would fragment.
- A separate execution service now: rejected as premature.

## Consequences

Action execution is deny-by-default, tenant-scoped, and auditable. Capability policy remains separate from adapter credentials and transport details.

## Tradeoffs

Explicit policy and validation add work but constrain model-driven side effects.

## Compatibility implications

Knowledge answering remains unchanged. Capabilities can be added without converting knowledge or channels into action owners.

## Conditions for revisiting

Revisit if demonstrated execution scale, isolation, or regulatory requirements cannot be met safely inside the monolith.
