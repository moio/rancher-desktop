import fs from 'fs';
import path from 'path';

import { manageSymlink } from '@/integrations/unixIntegrationManager';
import * as childProcess from '@/utils/childProcess';
import paths from '@/utils/paths';

const LEGACY_INTEGRATION_NAMES = [
  'docker',
  'docker-buildx',
  'docker-compose',
  'helm',
  'kubectl',
  'kuberlr',
  'nerdctl',
  'steve',
  'trivy',
  'rdctl',
];

type EaccesError = {
  errno: number;
  code: string;
  syscall: string;
  path: string;
};

export class PermissionError {
  errors: EaccesError[] = [];

  constructor(errors: EaccesError[]) {
    this.errors = errors;
  }
}

// Removes any symlinks that may remain from the previous strategy
// of managing integrations. Ensures a clean transition to the new
// strategy. Idempotent.
export async function removeLegacySymlinks(legacyIntegrationDir: string): Promise<void> {
  const settledPromises = await Promise.allSettled(LEGACY_INTEGRATION_NAMES.map((name) => {
    const linkPath = path.join(legacyIntegrationDir, name);

    return manageSymlink('', linkPath, false);
  }));

  const permissionErrors = [];

  for (const settledPromise of settledPromises) {
    if (settledPromise.status === 'rejected') {
      if (settledPromise.reason.code === 'EACCES') {
        permissionErrors.push(settledPromise.reason);
      } else {
        throw settledPromise.reason;
      }
    }
  }

  if (permissionErrors.length > 0) {
    throw new PermissionError(permissionErrors);
  }
}

// Moves lima content from the old location to the current one. Idempotent.
export async function migrateLimaFilesToNewLocation() {
  try {
    await fs.promises.access(paths.oldLima, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // there is no directory to move, done already
      return;
    } else {
      console.log(`Can't test access to ${ paths.oldLima }: ${ err }`);
      throw new Error(`Can't test access to ${ paths.oldLima }`);
    }
  }

  try {
    await fs.promises.rm(paths.lima, { recursive: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // there is no directory to delete, all good
    } else {
      console.log(`Can't delete ${ paths.lima }: ${ err }`);
      throw new Error(`Can't delete ${ paths.lima }: err`);
    }
  }

  try {
    await fs.promises.mkdir(path.dirname(paths.lima), { recursive: true });
  } catch (err: any) {
    console.log(`Can't create ${ paths.lima }: ${ err }`);
    throw new Error(`Can't create ${ paths.lima }: err`);
  }

  try {
    await fs.promises.rename(paths.oldLima, paths.lima);
  } catch (err: any) {
    console.log(`Can't migrate lima configuration to ${ paths.lima }: ${ err }`);
    throw new Error(`Can't migrate lima configuration to ${ paths.lima }: err`);
  }

  // Update Time Machine exclusions
  try {
    await childProcess.spawnFile('tmutil', ['addexclusion', paths.lima]);
  } catch (err: any) {
    console.log(`Failed to add exclusion to TimeMachine for ${ paths.lima }: ${ err }`);
  }
}
