/**
 * Archive-Arts Command
 *
 * Archive artifact outputs and optionally cascade to all transitive dependents.
 * Moves files to archived/<timestamp>_<artifact>/ and appends archive_log.md.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import {
  readChangeMetadata,
  resolveSchemaForChange,
} from '../../utils/change-metadata.js';
import { resolveSchema } from '../../core/artifact-graph/resolver.js';
import { ArtifactGraph } from '../../core/artifact-graph/graph.js';
import {
  validateChangeExists,
  validateSchemaExists,
} from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ArchiveArtsOptions {
  change?: string;
  schema?: string;
  cascade?: boolean; // commander inverts --no-cascade to cascade: false
  msg?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Computes all transitive dependents of a given artifact ID.
 * A dependent is an artifact whose requires chain includes the trigger.
 */
function getTransitiveDependents(
  graph: ArtifactGraph,
  triggerId: string,
): string[] {
  const allArtifacts = graph.getAllArtifacts();

  // Build forward adjacency: artifact -> direct dependents
  const dependentsMap = new Map<string, string[]>();
  for (const a of allArtifacts) {
    dependentsMap.set(a.id, []);
  }
  for (const a of allArtifacts) {
    for (const req of a.requires) {
      const list = dependentsMap.get(req);
      if (list) list.push(a.id);
    }
  }

  // BFS from trigger to collect all transitive dependents
  const visited = new Set<string>();
  const queue = [...(dependentsMap.get(triggerId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of dependentsMap.get(current) ?? []) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return [...visited].sort();
}

/**
 * Parses the generates field (comma-separated) and extracts base paths
 * to move. Glob patterns like exp/ are stripped of wildcards.
 */
function parseGeneratesPaths(generates: string): string[] {
  return generates
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      // Strip glob suffixes: "exp/**/*" -> "exp", "survey/references/**" -> "survey/references"
      const cleaned = entry
        .replace(/\/\*\*\/?\*?$/, '')
        .replace(/\/\*$/, '');
      // If the entry was just "**/*", return empty (skip)
      return cleaned || null;
    })
    .filter((s): s is string => s !== null);
}

/**
 * Moves a file or directory to the archive destination.
 * Creates parent directories as needed. Skips if source does not exist.
 */
function moveToArchive(
  changeDir: string,
  relativePath: string,
  archiveDir: string,
): boolean {
  const src = path.join(changeDir, relativePath);
  if (!fs.existsSync(src)) return false;

  const dest = path.join(archiveDir, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  return true;
}

/**
 * Formats a Date as YYYYMMDD_HHmmss.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * Formats a Date as YYYY-MM-DD HH:mm for the log entry.
 */
function formatLogDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return y + '-' + m + '-' + d + ' ' + hh + ':' + mm;
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export async function archiveArtsCommand(
  artifactId: string,
  options: ArchiveArtsOptions,
): Promise<void> {
  const projectRoot = process.cwd();
  const changeName = await validateChangeExists(options.change, projectRoot);

  if (options.schema) {
    validateSchemaExists(options.schema, projectRoot);
  }

  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
  const schemaName = resolveSchemaForChange(changeDir, options.schema);
  const schema = resolveSchema(schemaName, projectRoot);

  // Validate artifact ID exists
  const validIds = new Set(schema.artifacts.map((a) => a.id));
  if (!validIds.has(artifactId)) {
    const available = [...validIds].sort().join(', ');
    throw new Error(
      'Unknown artifact \'' + artifactId + '\'. Available: ' + available,
    );
  }

  // Build graph and compute cascade set
  const graph = ArtifactGraph.fromSchema(schema);
  const cascade =
    options.cascade === false
      ? [] // --no-cascade
      : getTransitiveDependents(graph, artifactId);

  const archiveSet = [artifactId, ...cascade];

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const archiveDirName = timestamp + '_' + artifactId;
  const archiveDir = path.join(changeDir, 'archived', archiveDirName);

  // Collect all generates paths for the archive set
  const artifactMap = new Map(schema.artifacts.map((a) => [a.id, a]));
  let movedCount = 0;

  for (const id of archiveSet) {
    const artifact = artifactMap.get(id)!;
    const paths = parseGeneratesPaths(artifact.generates);

    for (const relPath of paths) {
      const moved = moveToArchive(changeDir, relPath, archiveDir);
      if (moved) {
        movedCount++;
        console.log(chalk.dim('  -> ') + relPath);
      }
    }
  }

  // Append archive_log.md
  const logPath = path.join(changeDir, 'archive_log.md');
  const reason = options.msg ?? 'manual trigger';
  const cascadeText = cascade.length > 0 ? cascade.join(', ') : 'none';
  const logEntry = [
    '',
    '## ' + formatLogDate(now) + ' -- archive-arts: ' + artifactId,
    '- **Trigger**: ' + artifactId,
    '- **Cascaded**: ' + cascadeText,
    '- **Reason**: ' + reason,
    '- **Archived to**: archived/' + archiveDirName + '/',
    '',
  ].join('\n');

  if (fs.existsSync(logPath)) {
    fs.appendFileSync(logPath, logEntry, 'utf-8');
  } else {
    fs.writeFileSync(logPath, '# Archive Log\n' + logEntry, 'utf-8');
  }

  // Summary
  console.log();
  if (movedCount === 0) {
    console.log(chalk.yellow('No artifact files found to archive.'));
  } else {
    console.log(
      chalk.green(
        'Archived ' + movedCount + ' path(s) to archived/' + archiveDirName + '/',
      ),
    );
  }

  if (cascade.length > 0) {
    console.log(chalk.dim('Cascaded: ' + cascadeText));
  }

  console.log(chalk.dim('Reason: ' + reason));
  console.log(chalk.dim('Log entry appended to archive_log.md'));
}
