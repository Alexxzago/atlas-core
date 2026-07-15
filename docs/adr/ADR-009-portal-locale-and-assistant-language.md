# ADR-009: Portal Locale and Assistant Language

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Atlas has an internationalized administrative portal and will answer customers in potentially different languages. Treating both settings as one value would let an administrator’s interface preference alter customer-facing behavior.

## Decision

Portal locale and assistant language are separate concepts. Portal locale controls administrative interface text and locale-sensitive formatting. Assistant language controls customer-facing AI responses and must not change when portal locale changes.

The portal supports English and Spanish through typed dictionaries and a lightweight React context. Locale selection priority is persisted explicit preference, supported browser language, then English. Spanish-language browsers select Spanish automatically. The document language and direction reflect portal locale.

Assistant-language configuration is not yet implemented. Its future owner is the company’s assistant profile, not portal internationalization state.

## Alternatives considered

- One language setting for portal and assistant: rejected because administrative and customer audiences differ.
- Hard-coded Spanish UI: rejected because commercial deployment is multilingual.
- An internationalization dependency now: rejected because current requirements are small and already covered without one.

## Consequences

Components do not hard-code visible text. Future assistant-language work must use a separate domain setting and API contract.

## Tradeoffs

Two concepts require explicit naming and configuration but prevent unintended customer-facing changes.

## Compatibility implications

Current portal locale behavior remains unchanged. No assistant behavior is inferred from browser or portal language.

## Conditions for revisiting

Revisit the portal implementation if supported locales, translation workflows, or RTL requirements exceed the lightweight approach. Do not merge the two language concepts.
