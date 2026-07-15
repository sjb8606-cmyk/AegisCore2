import { NodeSDK } from '@opentelemetry/sdk-node';
import { trace } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';

const sdk = new NodeSDK({
  resource: new Resource({ 'service.name': 'platform-core' }),
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});

sdk.start();

// SWAP FIX: Export getTracer specifically for Veridact
export function getTracer(name: string) {
  return trace.getTracer(name);
}

export { sdk };
