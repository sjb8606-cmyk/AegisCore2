import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { mountApp, checkAppConfig } from '../index';

let tmpRoot: string;
let appsDir: string;
let routesDir: string;

function writeAppConfig(appId: string, data: Record<string, unknown>) {
  fs.writeFileSync(path.join(appsDir, `${appId}.json`), JSON.stringify(data, null, 2));
}

function writeRouteFile(name: string) {
  fs.writeFileSync(
    path.join(routesDir, `${name}.js`),
    `const { Router } = require('express');
     const router = Router();
     router.get('/', (req, res) => res.json({ core: '${name}' }));
     module.exports.default = router;
    `,
  );
}

const noopAuth = () => (req: any, res: any, next: any) => next();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-loader-mount-test-'));
  appsDir = path.join(tmpRoot, 'config', 'apps');
  fs.mkdirSync(appsDir, { recursive: true });

  routesDir = path.join(__dirname, `.tmp-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(routesDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(routesDir, { recursive: true, force: true });
});

describe('checkAppConfig (dry-run, no mounting)', () => {
  it('reports cores that are declared and have a matching route file as mounted', () => {
    writeAppConfig('testapp', { app_id: 'testapp', name: 'Test', cores: ['alpha', 'beta'] });
    writeRouteFile('alpha');
    writeRouteFile('beta');
    const report = checkAppConfig('testapp', routesDir, tmpRoot);
    expect(report.mounted.sort()).toEqual(['alpha', 'beta']);
    expect(report.missingRouteFile).toEqual([]);
    expect(report.unlistedInConfig).toEqual([]);
  });

  it('flags a declared core with no route file as missingRouteFile', () => {
    writeAppConfig('testapp', { app_id: 'testapp', name: 'Test', cores: ['alpha', 'ghost-core'] });
    writeRouteFile('alpha');
    const report = checkAppConfig('testapp', routesDir, tmpRoot);
    expect(report.mounted).toEqual(['alpha']);
    expect(report.missingRouteFile).toEqual(['ghost-core']);
  });

  it('flags a route file that exists but is not declared in config as unlistedInConfig', () => {
    writeAppConfig('testapp', { app_id: 'testapp', name: 'Test', cores: ['alpha'] });
    writeRouteFile('alpha');
    writeRouteFile('undeclared-core');
    const report = checkAppConfig('testapp', routesDir, tmpRoot);
    expect(report.mounted).toEqual(['alpha']);
    expect(report.unlistedInConfig).toEqual(['undeclared-core']);
  });
});

describe('mountApp', () => {
  it('mounts only cores declared in config, ignoring extra route files present on disk', async () => {
    writeAppConfig('testapp', { app_id: 'testapp', name: 'Test', cores: ['alpha'] });
    writeRouteFile('alpha');
    writeRouteFile('undeclared-core');

    const app = express();
    let report;
    try {
      report = mountApp(app, {
        appId: 'testapp',
        routesDir,
        requireAuth: noopAuth,
        tenantResolver: noopAuth,
        configStartDir: tmpRoot,
      });
    } catch (err) {
      console.log('=== DIAGNOSTIC: mountApp threw ===', err);
      throw err;
    }

    console.log('=== DIAGNOSTIC: mountApp report ===', JSON.stringify(report, null, 2));
    console.log('=== DIAGNOSTIC: routesDir contents ===', fs.readdirSync(routesDir));
    console.log('=== DIAGNOSTIC: routesDir path ===', routesDir);

    expect(report.mounted).toEqual(['alpha']);
    expect(report.unlistedInConfig).toEqual(['undeclared-core']);

    const server = app.listen(0);
    const { port } = server.address() as any;

    const mountedRes = await fetch(`http://127.0.0.1:${port}/api/alpha`);
    expect(mountedRes.status).toBe(200);
    expect(await mountedRes.json()).toEqual({ core: 'alpha' });

    const unmountedRes = await fetch(`http://127.0.0.1:${port}/api/undeclared-core`);
    expect(unmountedRes.status).toBe(404);

    server.close();
  });

  it('does not throw when a declared core has no route file — reports it instead', () => {
    writeAppConfig('testapp', { app_id: 'testapp', name: 'Test', cores: ['ghost-core'] });
    const app = express();
    const report = mountApp(app, {
      appId: 'testapp',
      routesDir,
      requireAuth: noopAuth,
      tenantResolver: noopAuth,
      configStartDir: tmpRoot,
    });
    expect(report.mounted).toEqual([]);
    expect(report.missingRouteFile).toEqual(['ghost-core']);
  });
});
