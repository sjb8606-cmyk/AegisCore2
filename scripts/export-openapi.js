#!/usr/bin/env node
// scripts/export-openapi.js
// Generates docs/openapi.yaml from route definitions.

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const spec = {
  openapi: '3.1.0',
  info: {
    title:       'platform-core API',
    version:     '1.0.0',
    description: 'Secure SaaS/AI Platform Foundation — public API surface',
    contact: { name: 'Platform Team', email: 'platform@example.com' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000',   description: 'Local Dev' },
  ],
  security: [{ BearerAuth: [] }],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'OIDC JWT issued by configured identity provider',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['success', 'error', 'message', 'requestId', 'timestamp'],
        properties: {
          success:   { type: 'boolean', enum: [false] },
          error:     { type: 'string', example: 'UNAUTHORIZED' },
          message:   { type: 'string' },
          details:   { type: 'object' },
          requestId: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          limit:      { type: 'integer' },
          hasMore:    { type: 'boolean' },
          nextCursor: { type: 'string', nullable: true },
          prevCursor: { type: 'string', nullable: true },
        },
      },
      AuditEvent: {
        type: 'object',
        required: ['id','tenantId','actorId','actorType','action','outcome','timestamp'],
        properties: {
          id:         { type: 'string', format: 'uuid' },
          tenantId:   { type: 'string' },
          actorId:    { type: 'string' },
          actorType:  { type: 'string', enum: ['user','service','system'] },
          action:     { type: 'string' },
          outcome:    { type: 'string', enum: ['success','failure','partial'] },
          resource:   { type: 'string' },
          resourceId: { type: 'string' },
          timestamp:  { type: 'string', format: 'date-time' },
          _prevHash:  { type: 'string', description: 'SHA-256 of previous event (Merkle chain)' },
          _hash:      { type: 'string', description: 'SHA-256 of this event' },
          _sequence:  { type: 'integer' },
        },
      },
      UsageEvent: {
        type: 'object',
        required: ['id','tenantId','eventType','quantity','idempotencyKey','recordedAt'],
        properties: {
          id:             { type: 'string', format: 'uuid' },
          tenantId:       { type: 'string' },
          actorId:        { type: 'string' },
          eventType:      { type: 'string' },
          quantity:       { type: 'number' },
          unit:           { type: 'string' },
          idempotencyKey: { type: 'string' },
          recordedAt:     { type: 'string', format: 'date-time' },
        },
      },
      ValidationViolation: {
        type: 'object',
        properties: {
          type:     { type: 'string' },
          detail:   { type: 'string' },
          severity: { type: 'string', enum: ['low','medium','high','critical'] },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: '401 Unauthorized',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: '403 Forbidden',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: '404 Not Found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      RateLimited: {
        description: '429 Too Many Requests',
        headers: {
          'Retry-After':          { schema: { type: 'integer' } },
          'X-RateLimit-Limit':    { schema: { type: 'integer' } },
          'X-RateLimit-Remaining':{ schema: { type: 'integer' } },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },

  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        summary:     'Liveness probe',
        tags:        ['Observability'],
        security:    [],
        responses: {
          '200': {
            description: 'Service is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:    { type: 'string', enum: ['ok'] },
                    service:   { type: 'string' },
                    version:   { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ready': {
      get: {
        operationId: 'getReadiness',
        summary:     'Readiness probe',
        tags:        ['Observability'],
        security:    [],
        responses: {
          '200': { description: 'Service is ready' },
          '503': { description: 'Service is not ready' },
        },
      },
    },
    '/api/items': {
      get: {
        operationId: 'listItems',
        summary:     'List items (tenant-scoped, paginated)',
        tags:        ['Items'],
        parameters: [
          { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Pagination cursor' },
          { name: 'sort',   in: 'query', schema: { type: 'string', enum: ['asc','desc'], default: 'desc' } },
        ],
        responses: {
          '200': {
            description: 'Paginated list of items',
            headers: { ETag: { schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success:    { type: 'boolean' },
                    data:       { type: 'array', items: { type: 'object' } },
                    meta:       { $ref: '#/components/schemas/Pagination' },
                    requestId:  { type: 'string' },
                    timestamp:  { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/api/ai/validate': {
      post: {
        operationId: 'validateAiOutput',
        summary:     'Validate LLM output against safety rules',
        tags:        ['AI Safety'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt', 'response'],
                properties: {
                  prompt:   { type: 'string', maxLength: 10000 },
                  response: { type: 'string', maxLength: 50000 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Validation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid:      { type: 'boolean' },
                    violations: { type: 'array', items: { $ref: '#/components/schemas/ValidationViolation' } },
                    filtered:   { type: 'boolean' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
  },

  tags: [
    { name: 'Observability', description: 'Health and readiness probes' },
    { name: 'Items',         description: 'Demo tenant-scoped resource' },
    { name: 'AI Safety',     description: 'LLM output validation' },
  ],
};

const outputDir  = path.join(__dirname, '..', 'docs');
const outputFile = path.join(outputDir, 'openapi.yaml');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, yaml.dump(spec, { lineWidth: 120 }));

console.log(`✅ OpenAPI spec written to ${outputFile}`);
