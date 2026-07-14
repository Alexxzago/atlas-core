# Atlas Development Instructions

## Read First

Before making any code changes, read:

1. docs/ATLAS_V1_ARCHITECTURE.md
2. docs/ATLAS_ENGINEERING_PROMPT.md

These documents define the project architecture and coding standards.

## Project Rules

- Never introduce business logic into controllers.
- Repositories are the only layer allowed to access SQLite.
- Providers communicate with external services only.
- Services contain business rules.
- Preserve the existing architecture.
- Prefer modifying existing code over creating duplicate implementations.
- Return complete files when a change affects a file substantially.
- Do not introduce unnecessary dependencies.
- Keep TypeScript types explicit.
- Ask for clarification if a requested change conflicts with the architecture.

## Current Goal

Continue implementing Atlas as a multi-tenant SaaS platform.

Current priority:

1. Company Management
2. Intelligent Onboarding
3. Company-aware Chat
4. WhatsApp integration