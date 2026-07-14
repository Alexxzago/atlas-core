# ATLAS V1 Architecture

## Vision

Atlas is an AI-powered omnichannel customer assistant.

A company should be able to provide a single website URL and obtain an AI assistant capable of answering customer questions consistently across every supported communication channel.

The business knowledge belongs to the company, not to any AI model.

---

# Core Principles

1. AI never invents company information.

2. Every external provider can be replaced.

3. Business logic never depends on an AI provider.

4. Every communication channel shares the same knowledge.

5. The onboarding process should require less than 10 minutes.

6. Every feature must be testable locally.

7. Knowledge is the product.
Channels are only interfaces.

---

# High Level Architecture

Client Channels

↓

Controllers

↓

Agents

↓

Services

↓

Repositories

↓

Database

↓

Providers

---

# Providers

Providers communicate with external services.

Examples:

- Gemini
- Firecrawl
- WhatsApp API
- Instagram API
- Email Provider

Providers never contain business logic.

---

# Services

Services implement Atlas business rules.

Examples:

- Knowledge Builder
- Markdown Cleaner
- Conversation Service
- Company Service

---

# Agents

Agents orchestrate decisions.

Example:

Atlas Agent

↓

Knowledge Repository

↓

AI Provider

↓

Response

---

# Controllers

Controllers expose HTTP endpoints.

Controllers should be as small as possible.

---

# Repository Layer

Repositories are responsible for persistence.

Initially:

SQLite

Future:

PostgreSQL

---

# Multi-tenant

Atlas supports multiple companies.

Each company owns:

- knowledge
- channels
- conversations
- users
- settings

---

# Long-term Goal

A company should become operational by executing:

POST /onboard

{
"url": "https://company.com"
}

The complete onboarding should happen automatically.