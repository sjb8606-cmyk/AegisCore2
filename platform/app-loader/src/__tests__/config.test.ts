import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadAppConfig, listDeclaredApps, AppError } from '../config';

let tmpRoot: string;
let appsDir: string;

function writeAppConfig(appId: string, data: Record<string, unknown>) {
  fs.writeFileSync(path.join(appsDir, `${appId}.json`), JSON.stringify(data, null, 2));
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-loader-test-'));
  appsDir = path.join(tmpRoot, 'config', 'apps');
  fs.mkdirSync(appsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('loadAppConfig', () => {
  it('loads and validates a well-formed app config', () => {
    writeAppConfig('tidelock', { app_id: 'tidelock', name: 'TIDELOCK', cores: ['shipment-intake', 'species-registry'] });
    const config = loadAppConfig('tidelock', tmpRoot);
    expect(config.app_id).toBe('tidelock');
    expect(config.cores).toEqual(['shipment-intake', 'species-registry']);
    expect(config.status).toBe('active');
  });

  it('throws NOT_FOUND when the config file does not exist', () => {
    expect(() => loadAppConfig('does-not-exist', tmpRoot)).toThrow(AppError);
    try {
      loadAppConfig('does-not-exist', tmpRoot);
    } catch (err) {
      expect((err as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('throws UNPROCESSABLE on invalid JSON', () => {
    fs.writeFileSync(path.join(appsDir, 'broken.json'), '{ not valid json');
    expect(() => loadAppConfig('broken', tmpRoot)).toThrow(AppError);
  });

  it('throws UNPROCESSABLE when cores is empty', () => {
    writeAppConfig('empty-cores', { app_id: 'empty-cores', name: 'Empty', cores: [] });
    expect(() => loadAppConfig('empty-cores', tmpRoot)).toThrow(AppError);
  });

  it('throws UNPROCESSABLE when app_id does not match filename', () => {
    writeAppConfig('mismatched', { app_id: 'something-else', name: 'X', cores: ['a'] });
    expect(() => loadAppConfig('mismatched', tmpRoot)).toThrow(AppError);
  });

  it('walks up parent directories to find config/apps, like other loaders in the repo', () => {
    writeAppConfig('tidelock', { app_id: 'tidelock', name: 'TIDELOCK', cores: ['a'] });
    const nestedCwd = path.join(tmpRoot, 'apps', 'tidelock-api', 'src');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const config = loadAppConfig('tidelock', nestedCwd);
    expect(config.app_id).toBe('tidelock');
  });
});

describe('listDeclaredApps', () => {
  it('lists every app declared in config/apps/', () => {
    writeAppConfig('tidelock', { app_id: 'tidelock', name: 'TIDELOCK', cores: ['a'] });
    writeAppConfig('delight-engine', { app_id: 'delight-engine', name: 'Delight', cores: ['b'] });
    const apps = listDeclaredApps(tmpRoot).sort();
    expect(apps).toEqual(['delight-engine', 'tidelock']);
  });

  it('returns an empty array when config/apps does not exist', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-loader-empty-'));
    expect(listDeclaredApps(emptyRoot)).toEqual([]);
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  });
});
