# Atlas Production Roadmap

**Version:** 1.0

**Status:** Active

**Last Updated:** 2026-07-22

**Owner:** Atlas Team

---

## Purpose

This document defines the strategic roadmap required to transform Atlas from a development project into a production-ready SaaS platform capable of serving real customers.

It is the reference used to prioritize Milestones, Epics and Engineering decisions.

When this document conflicts with implementation convenience, this document wins.

---

# Mission

Atlas exists to become the first employee a company hires.

A company should be able to provide its business knowledge once and immediately obtain an AI employee capable of answering customers consistently across every communication channel.

Knowledge is the product.

Channels are only interfaces.

The objective is not to build software.

The objective is to deploy Atlas inside real companies and generate recurring revenue.

---

# North Star

FIRST PRODUCTION CUSTOMER

Everything we build must reduce the time between:

"I discovered Atlas"

and

"Atlas is already answering my customers."

---

# Success Metric

A company can become operational in less than 15 minutes.

Without requiring technical knowledge.

---

# Atlas Product

Atlas is an AI Commercial Employee.

Atlas can:

• Learn a company's business.
• Answer customer questions.
• Capture leads.
• Escalate conversations.
• Keep answers consistent.
• Operate 24/7.

Atlas never invents company information.

---

# Product Pillars

Pillar 1

Company Knowledge

The company's knowledge is the single source of truth.

Every answer comes from published company knowledge.

---

Pillar 2

Operational Assistant

The Assistant never answers directly from the LLM.

It always executes using:

Assistant Profile

+

Published Knowledge

+

Execution Contract

---

Pillar 3

Channels

Channels are adapters.

The business logic never depends on WhatsApp,
Instagram,
Web Chat,
Email,
or future providers.

---

Pillar 4

Workspace

Every company owns its own workspace.

Workspace contains:

Company

Knowledge

Profiles

Channels

Conversations

Users

Settings

---

# Customer Journey

Step 1

Create Workspace

↓

Step 2

Create Company

↓

Step 3

Enter Website URL

↓

Step 4

Atlas extracts company knowledge

↓

Step 5

Administrator reviews extracted knowledge

↓

Step 6

Knowledge is published

↓

Step 7

Assistant Profile is created

↓

Step 8

Operational tests

↓

Step 9

Communication channel connected

↓

Step 10

Atlas goes live

---

# Production Requirements

The following capabilities are mandatory.

## Infrastructure

Production deployment

HTTPS

Persistent database

Environment variables

Backups

Logging

Monitoring

Health checks

Automatic restart

---

## Product

Workspace

Company

Knowledge lifecycle

Assistant

Operational execution

Publication workflow

Safe human handoff

---

## Administration

Company management

Knowledge review

Knowledge publishing

Assistant testing

Channel configuration

Basic settings

---

## Channels

Phase 1

Web Chat

Phase 2

WhatsApp

Phase 3

Instagram

Phase 4

Email

Future

Voice

API

Custom integrations

---

# Milestone 1

FIRST PRODUCTION CUSTOMER

Goal

Atlas deployed for one real company.

Completion Criteria

Company onboarded

Knowledge published

Assistant operational

Customers receive answers

Human escalation works

Logs available

Monitoring available

Deployment reproducible

---

# Milestone 2

SELF SERVICE

Goal

A customer can configure Atlas without our help.

---

# Milestone 3

MULTI TENANT PRODUCTION

Goal

Multiple companies running simultaneously.

---

# Milestone 4

COMMERCIAL PLATFORM

Billing

Subscriptions

Analytics

Usage

Licensing

---

# Current Status

Architecture
✅

Knowledge
✅

Operational Assistant
✅

Workspace foundations
✅

Security
✅

Engineering process
✅

Production deployment
❌

Production monitoring
❌

WhatsApp production
❌

Customer onboarding UX
🟡

Administration UX
🟡

Observability
❌

Billing
❌

---

# Engineering Rule

Every Epic must answer one question.

Does this bring Atlas closer to the first production customer?

If not,

it is not the next Epic.

---

# Product Rule

Never build features because they are interesting.

Build only what removes friction from deployment.

---

# Long-Term Vision

Atlas becomes a company operating system for customer communication.

Knowledge is created once.

Every communication channel consumes the same knowledge.

The AI changes.

The knowledge remains.

The channels evolve.

The company never has to rebuild its business intelligence.

That is Atlas.