import fs from 'fs';
import { constants } from 'node:fs';
import path from 'path';
import { manageSymlink } from '@/integrations/unixIntegrationManager';
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
}

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

// Moves lima content into the new location. Idempotent.
export async function migrateLima() {
  try {
    await fs.promises.access(paths.oldLima, constants.R_OK | constants.W_OK)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // there is no directory to move, done already
      return;
    } else {
      throw new Error(`Can't test for ${ paths.oldLima }: err`);
    }
  }

  try {
    await fs.promises.rename(paths.oldLima, paths.lima)
  }
  catch (err: any) {
    throw new Error(`Can't migrate lima configuration to ${ paths.lima }: err`);
  }
}