/**
 * Skip / Unskip Commands
 *
 * Mark artifacts as skipped in .openspec.yaml so they are treated as completed
 * for dependency resolution without requiring actual output files.
 */

import ora from 'ora';
import chalk from 'chalk';
import {
  readChangeMetadata,
  writeChangeMetadata,
} from '../../utils/change-metadata.js';
import { resolveSchema } from '../../core/artifact-graph/resolver.js';
import {
  validateChangeExists,
  validateSchemaExists,
} from './shared.js';
import { resolveSchemaForChange } from '../../utils/change-metadata.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SkipOptions {
  change?: string;
  schema?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Validates that all artifact IDs exist in the schema.
 * Returns the set of valid artifact IDs from the schema.
 */
function validateArtifactIds(
  artifactIds: string[],
  schemaName: string,
  projectRoot: string
): void {
  const schema = resolveSchema(schemaName, projectRoot);
  const validIds = new Set(schema.artifacts.map(a => a.id));

  const invalid = artifactIds.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    const available = [...validIds].sort().join(', ');
    throw new Error(
      `Unknown artifact(s): ${invalid.join(', ')}. Available: ${available}`
    );
  }
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

export async function skipCommand(
  artifactIds: string[],
  options: SkipOptions
): Promise<void> {
  if (artifactIds.length === 0) {
    throw new Error('At least one artifact ID is required. Usage: openspec skip <artifact...>');
  }

  const projectRoot = process.cwd();
  const changeName = await validateChangeExists(options.change, projectRoot);

  if (options.schema) {
    validateSchemaExists(options.schema, projectRoot);
  }

  const changeDir = `${projectRoot}/openspec/changes/${changeName}`;
  const schemaName = resolveSchemaForChange(changeDir, options.schema);

  // Validate artifact IDs against schema
  validateArtifactIds(artifactIds, schemaName, projectRoot);

  // Read current metadata
  const metadata = readChangeMetadata(changeDir, projectRoot);
  if (!metadata) {
    throw new Error(`No .openspec.yaml found in change '${changeName}'`);
  }

  // Merge new skipped IDs
  const currentSkipped = new Set(metadata.skipped ?? []);
  const newlySkipped: string[] = [];

  for (const id of artifactIds) {
    if (!currentSkipped.has(id)) {
      currentSkipped.add(id);
      newlySkipped.push(id);
    }
  }

  if (newlySkipped.length === 0) {
    console.log(chalk.dim('All specified artifacts are already skipped.'));
    return;
  }

  // Write updated metadata
  metadata.skipped = [...currentSkipped].sort();
  writeChangeMetadata(changeDir, metadata, projectRoot);

  for (const id of newlySkipped) {
    console.log(`${chalk.dim('[s]')} ${id} — skipped`);
  }
  console.log(chalk.dim(`\nUpdated .openspec.yaml for change '${changeName}'.`));
}

export async function unskipCommand(
  artifactIds: string[],
  options: SkipOptions
): Promise<void> {
  if (artifactIds.length === 0) {
    throw new Error('At least one artifact ID is required. Usage: openspec unskip <artifact...>');
  }

  const projectRoot = process.cwd();
  const changeName = await validateChangeExists(options.change, projectRoot);

  const changeDir = `${projectRoot}/openspec/changes/${changeName}`;

  // Read current metadata
  const metadata = readChangeMetadata(changeDir, projectRoot);
  if (!metadata) {
    throw new Error(`No .openspec.yaml found in change '${changeName}'`);
  }

  const currentSkipped = new Set(metadata.skipped ?? []);
  const removed: string[] = [];

  for (const id of artifactIds) {
    if (currentSkipped.has(id)) {
      currentSkipped.delete(id);
      removed.push(id);
    }
  }

  if (removed.length === 0) {
    console.log(chalk.dim('None of the specified artifacts were skipped.'));
    return;
  }

  // Write updated metadata (omit skipped field if empty)
  metadata.skipped = currentSkipped.size > 0 ? [...currentSkipped].sort() : [];
  writeChangeMetadata(changeDir, metadata, projectRoot);

  for (const id of removed) {
    console.log(`${chalk.yellow('[ ]')} ${id} — unskipped`);
  }
  console.log(chalk.dim(`\nUpdated .openspec.yaml for change '${changeName}'.`));
}
