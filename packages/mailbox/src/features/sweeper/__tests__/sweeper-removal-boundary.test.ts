/// <reference types="jest" />

/**
 * Sweeper removal boundary — guard test.
 *
 * The sweeper's architecture assigns each resource-removal type (certificate, edge function,
 * stack-failure detector) its own IAM statements as a self-contained plugin. This guard asserts
 * that no removal's PolicyStatement is constructed outside the sweeper feature directory.
 *
 * Implementation approach: a regular-expression scan of the source text of every file outside
 * `features/sweeper/` for a class implementing `IResourceRemoval`, or a `grantStatements()` method
 * next to a `PolicyStatement`.
 *
 * Blind spot accepted: if a removal were to construct statements dynamically (e.g., in a factory
 * function in a helper), this scan would miss it. The mitigation is code review: removal types
 * are registered explicitly in their own files and reviewed at the call site.
 */

import * as fs   from 'fs';
import * as path from 'path';

describe('Sweeper removal boundary guard', () => {
  it('no PolicyStatement is constructed outside the sweeper feature directory for removal implementations', () => {
    // Locate the mailbox package root
    const packageRoot = path.resolve(__dirname, '../../../');
    const sweeperDir  = path.resolve(packageRoot, 'features/sweeper');

    // Scan all TypeScript source files in the mailbox package
    const sourceFiles              = scanDirForTypeScriptFiles(packageRoot);
    const violatingFiles: string[] = [];

    for (const file of sourceFiles) {
      // Skip sweeper directory files (they're allowed)
      if (file.startsWith(sweeperDir)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');

      // Look for removal implementations: classes implementing IResourceRemoval
      // or methods returning removal statements.
      // Key indicators: implements IResourceRemoval (alone or among other interfaces), or a
      // grantStatements() method definition alongside a PolicyStatement.
      const isRemovalImplementation =
        /\bimplements\b[^{]*\bIResourceRemoval\b/.test(content) ||
        (/grantStatements\s*\(\s*\)/.test(content) &&
          /PolicyStatement|iam\.PolicyStatement/.test(content));

      if (isRemovalImplementation) {
        // This file appears to be a removal implementation outside sweeper
        violatingFiles.push(path.relative(packageRoot, file));
      }
    }

    if (violatingFiles.length > 0) {
      throw new Error(
        `Found removal implementations (IResourceRemoval or grantStatements) outside the sweeper directory:\n${violatingFiles.map((f) => `  - ${f}`).join('\n')}`
      );
    }
  });
});

/**
 * Recursively scan a directory for TypeScript source files (excluding node_modules, .d.ts, test files, and __tests__).
 * Collects all .ts files that are part of the construct source tree.
 */
function scanDirForTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  function scan(current: string): void {
    if (!fs.existsSync(current)) {
      return;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files, non-source directories, and test files
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'lib' ||
        entry.name === 'cdk.out' ||
        entry.name === '__tests__' ||
        entry.name === '__mocks__'
      ) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }

  scan(dir);
  return files;
}
