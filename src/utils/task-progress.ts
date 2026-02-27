import { promises as fs } from 'fs';
import * as syncFs from 'fs';
import path from 'path';
import { resolveSchemaForChange } from './change-metadata.js';
import { resolveSchema } from '../core/artifact-graph/resolver.js';

const TASK_PATTERN = /^[-*]\s+\[[\sx]\]/i;
const COMPLETED_TASK_PATTERN = /^[-*]\s+\[x\]/i;

const DEFAULT_TRACKS_FILE = 'tasks.md';

export interface TaskProgress {
  total: number;
  completed: number;
}

export function countTasksFromContent(content: string): TaskProgress {
  const lines = content.split('\n');
  let total = 0;
  let completed = 0;
  for (const line of lines) {
    if (line.match(TASK_PATTERN)) {
      total++;
      if (line.match(COMPLETED_TASK_PATTERN)) {
        completed++;
      }
    }
  }
  return { total, completed };
}

/**
 * Resolve the tracks file for a change from its schema's apply.tracks,
 * falling back to tasks.md.
 */
function resolveTracksFile(changesDir: string, changeName: string): string {
  const changeDir = path.join(changesDir, changeName);

  try {
    const schemaName = resolveSchemaForChange(changeDir);
    const projectRoot = path.resolve(changeDir, '../../..');
    const schema = resolveSchema(schemaName, projectRoot);
    if (schema.apply?.tracks) {
      const tracksPath = path.join(changeDir, schema.apply.tracks);
      if (syncFs.existsSync(tracksPath)) {
        return tracksPath;
      }
    }
  } catch {
    // Schema resolution failed — fall through to default
  }

  return path.join(changeDir, DEFAULT_TRACKS_FILE);
}

export async function getTaskProgressForChange(changesDir: string, changeName: string): Promise<TaskProgress> {
  const tasksPath = resolveTracksFile(changesDir, changeName);
  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    return countTasksFromContent(content);
  } catch {
    return { total: 0, completed: 0 };
  }
}

export function formatTaskStatus(progress: TaskProgress): string {
  if (progress.total === 0) return 'No tasks';
  if (progress.completed === progress.total) return '✓ Complete';
  return `${progress.completed}/${progress.total} tasks`;
}


