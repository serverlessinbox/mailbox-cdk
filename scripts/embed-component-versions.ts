#!/usr/bin/env ts-node

/**
 * Embeds resolved component versions into packages/mailbox/package.json and
 * packages/mailbox-cognito/package.json under the `serverlessinbox.components`
 * key.
 *
 * Must run after `yarn resolve-artifacts` so that artifact-versions.json
 * is present at the repo root.
 */

import * as fs from 'fs';
import * as path from 'path';

const PACKAGES = [
  'packages/mailbox',
  'packages/mailbox-cognito',
];

async function main(): Promise<void> {
  const artifactVersionsPath = path.join(__dirname, '..', 'artifact-versions.json');
  const versions: Record<string, string> = JSON.parse(fs.readFileSync(artifactVersionsPath, 'utf8'));

  for (const pkg of PACKAGES) {
    const pkgJsonPath = path.join(__dirname, '..', pkg, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    parsed.serverlessinbox = {
      components: {
        'mailbox-go':         { version: versions['mailbox-go'] },
        'mailbox-admin-ui':   { version: versions['mailbox-admin-ui'] },
        'mailbox-webmail-ui': { version: versions['mailbox-webmail-ui'] },
      },
    };

    fs.writeFileSync(pkgJsonPath, JSON.stringify(parsed, null, 2) + '\n');
    console.log(`Patched: ${pkgJsonPath}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
