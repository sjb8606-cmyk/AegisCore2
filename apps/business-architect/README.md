# Business Architect

Evidence-aware guided business planning service assembled on AegisCore.

## Run

From the repository root:

npm install
npm run build
npx ts-node apps/business-architect/src/index.ts

The service defaults to port 3050.

## Research provider

Set BUSINESS_ARCHITECT_RESEARCH_URL to an HTTP POST endpoint accepting:

{ "query": "..." }

and returning:

{ "results": [{ "url": "...", "title": "...", "content": "..." }] }

The provider is deliberately external and configurable. Business Architect does not pretend that a search engine is wired when it is not.

## Core journey

IDEA -> CUSTOMER_PROBLEM -> RESEARCH -> COMPETITION -> BUSINESS_MODEL -> OPERATIONS -> PRICING -> COSTS -> FINANCIALS -> RISKS -> FUNDING -> PLAN -> EXECUTIVE_SUMMARY -> FUNDING_PACKAGE -> LAUNCH -> OPERATE
