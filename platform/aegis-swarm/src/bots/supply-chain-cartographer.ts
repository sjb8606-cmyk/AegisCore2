/**
 * platform/aegis-swarm/src/bots/supply-chain-cartographer.ts
 *
 * D-02 — Supply Chain Cartographer.
 *
 * Maps the repo's dependency graph (workspace packages + their
 * declared dependencies) and exports it as a simplified SBOM. Also
 * flags a genuinely real supply-chain risk pattern: an *external*
 * (non-workspace) dependency pinned to an unbounded version range
 * (`*` or `latest`) — the shape of a dependency-confusion attack
 * surface, since any future published version (including a malicious
 * one) would be silently accepted.
 *
 * Deliberately does NOT flag internal @platform/* or @features/*
 * workspace packages pinned to "*" — that's this repo's normal,
 * intentional npm-workspaces linking convention, not a risk.
 *
 * SIGNING IS NOT YET AVAILABLE. The AppSpec's role for this bot
 * includes "generates signed SBOMs" — signing requires
 * @platform/pqcrypto (Phase 1 of the CrystalForge Guardian build
 * order), which has not been built in this repo. signSbom() throws a
 * clear, honest error rather than silently no-opping or faking a
 * signature. generateSbom() itself works today and produces a real,
 * usable (unsigned) SBOM.
 */

import fs from 'fs';
import path from 'path';
import { CrystalBot, Finding } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
const UNBOUNDED_VERSION_PATTERNS = new Set(['*', 'latest']);

interface PackageManifest {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  filePath: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  versionRange: string;
  depType: 'dependency' | 'devDependency';
  isInternal: boolean;
}

export interface DependencyGraphReport {
  findings: Finding[];
  graph: DependencyEdge[];
  internalPackageCount: number;
  externalPackageCount: number;
}

export interface SbomComponent {
  name: string;
  version: string;
  type: 'internal-workspace' | 'external';
}

export interface SbomDocument {
  bomFormat: 'CrystalForge-Simplified-SBOM';
  specVersion: '0.1';
  generatedAt: string;
  components: SbomComponent[];
  signature: null;
  signingStatus: 'unsigned-pqcrypto-not-yet-available';
}

/**
 * Pure — evaluates a single dependency entry against D-02's real
 * detection criteria. Exported at module level so other code (e.g.
 * R-25) can test against this exact logic directly. Same reasoning as
 * every other pure export tonight.
 *
 * Trusts `internalNames` completely: any depName matching a name in
 * that set is treated as internal and skipped, with no verification
 * that it actually resolves to the workspace rather than a same-named
 * public registry package. That's the real dependency-confusion
 * bypass R-25 surfaces — not a bug in this function's own logic, but
 * an inherent limitation of name-based trust with no resolution check.
 */
export function evaluateDependencyRisk(
  packageName: string,
  packageFilePath: string,
  depName: string,
  versionRange: string,
  internalNames: Set<string>,
): Finding | null {
  const isInternal = internalNames.has(depName);
  if (!isInternal && UNBOUNDED_VERSION_PATTERNS.has(versionRange)) {
    return {
      cat: 'sec',
      sev: 'warn',
      loc: `${path.relative(process.cwd(), packageFilePath)} -> ${depName}`,
      desc: `External dependency "${depName}" is pinned to an unbounded version ("${versionRange}") — a future malicious or breaking publish would be silently accepted.`,
      rec: `Pin "${depName}" to a specific version or a scoped range (e.g. "^x.y.z"), not "*"/"latest".`,
    };
  }
  return null;
}

export class SupplyChainCartographerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scanDependencyGraph(rootDir: string): Promise<DependencyGraphReport> {
    await this.enforcePermission('read:filesystem');

    const packages = this.readPackageManifests(rootDir);
    const internalNames = new Set(packages.map((p) => p.name));

    const graph: DependencyEdge[] = [];
    const findings: Finding[] = [];

    for (const pkg of packages) {
      this.appendEdgesAndFindings(pkg, pkg.dependencies, 'dependency', internalNames, graph, findings);
      this.appendEdgesAndFindings(pkg, pkg.devDependencies, 'devDependency', internalNames, graph, findings);
    }

    const externalNames = new Set(graph.filter((e) => !e.isInternal).map((e) => e.to));

    const pi = this.computePI(findings);

    await this.createDecision(
      { rootDir, packageCount: packages.length },
      { edgeCount: graph.length, findingCount: findings.length, pi },
      'supply-chain-cartographer-v1',
    );

    if (findings.length > 0) {
      await this.signalSwarm('supply_chain.unbounded_external_dependency_found', {
        botId: this.botId,
        count: findings.length,
      });
    }

    return {
      findings,
      graph,
      internalPackageCount: internalNames.size,
      externalPackageCount: externalNames.size,
    };
  }

  async generateSbom(rootDir: string): Promise<SbomDocument> {
    await this.enforcePermission('read:filesystem');

    const packages = this.readPackageManifests(rootDir);
    const internalNames = new Set(packages.map((p) => p.name));
    const seen = new Map<string, SbomComponent>();

    for (const pkg of packages) {
      seen.set(pkg.name, { name: pkg.name, version: pkg.version || '0.0.0', type: 'internal-workspace' });
      for (const [depName, depVersion] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!seen.has(depName)) {
          seen.set(depName, {
            name: depName,
            version: depVersion,
            type: internalNames.has(depName) ? 'internal-workspace' : 'external',
          });
        }
      }
    }

    return {
      bomFormat: 'CrystalForge-Simplified-SBOM',
      specVersion: '0.1',
      generatedAt: new Date().toISOString(),
      components: [...seen.values()],
      signature: null,
      signingStatus: 'unsigned-pqcrypto-not-yet-available',
    };
  }

  signSbom(_sbom: SbomDocument): never {
    throw new Error(
      'SBOM signing is not available yet: @platform/pqcrypto has not been built in this repo ' +
        '(CrystalForge Guardian AppSpec, Phase 1 / Package 1 — a prerequisite for every other package). ' +
        'generateSbom() works today and returns a real, unsigned SBOM.',
    );
  }

  private appendEdgesAndFindings(
    pkg: PackageManifest,
    deps: Record<string, string> | undefined,
    depType: 'dependency' | 'devDependency',
    internalNames: Set<string>,
    graph: DependencyEdge[],
    findings: Finding[],
  ): void {
    if (!deps) return;

    for (const [depName, versionRange] of Object.entries(deps)) {
      const isInternal = internalNames.has(depName);
      graph.push({ from: pkg.name, to: depName, versionRange, depType, isInternal });

      const finding = evaluateDependencyRisk(pkg.name, pkg.filePath, depName, versionRange, internalNames);
      if (finding) findings.push(finding);
    }
  }

  private readPackageManifests(rootDir: string): PackageManifest[] {
    const manifests: PackageManifest[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name)) walk(fullPath);
        } else if (entry.isFile() && entry.name === 'package.json') {
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (typeof parsed.name === 'string') {
              manifests.push({
                name: parsed.name,
                version: parsed.version,
                dependencies: parsed.dependencies,
                devDependencies: parsed.devDependencies,
                filePath: fullPath,
              });
            }
          } catch {
            // Malformed or unreadable package.json — skip rather than fail the whole scan.
          }
        }
      }
    };

    walk(rootDir);
    return manifests;
  }
}
