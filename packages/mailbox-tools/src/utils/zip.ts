import * as fs from 'fs';
import * as path from 'path';
import { run } from './common';

export type Staging = {
  dir: string;
  cleanup: () => void;
};

/**
 * Creates a zip containing the *contents* of sourceDir.
 * (So unzipping yields the folder contents directly.)
 */
export function stageZipDirectoryContents(zipBaseName: string, sourceDir: string): Staging {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`sourceDir does not exist: ${sourceDir}`);
  }
  if (!fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`sourceDir is not a directory: ${sourceDir}`);
  }

  const stagingDir = fs.mkdtempSync(path.join(process.cwd(), '.mailbox-tools-zip-'));
  const zipPath = path.join(stagingDir, zipBaseName);

  // Ensure parent directories exist for the zip file
  const zipDir = path.dirname(zipPath);
  fs.mkdirSync(zipDir, { recursive: true });

  run('zip', ['-r', zipPath, '.'], { cwd: sourceDir });

  return {
    dir: stagingDir,
    cleanup: () => fs.rmSync(stagingDir, { recursive: true, force: true }),
  };
}
