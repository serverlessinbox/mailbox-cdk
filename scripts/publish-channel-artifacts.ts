/**
 * Publishes all CDK artifacts to the dev (or configured) channel.
 *
 * Reads artifact routing from each workspace's gitversion-s3.cjs config file.
 * For each artifact:
 *   - If bundleType === 'js-zip': the built output is /tmp/<basename-of-objectName>
 *   - Otherwise: source is treated as a direct file path (absolute or relative to workspace root)
 *
 * Invocation:
 *   yarn ts-node scripts/publish-channel-artifacts.ts
 *
 * Environment:
 *   PUBLISH_CHANNEL  - channel name (default: 'dev')
 *   AWS_PROFILE      - AWS credentials profile (default: ambient credentials)
 */

import * as path from 'path';
import { S3Uploader } from '@serverlessinbox/artifact-tools';

interface S3ArtifactEntry {
  source: string;
  bundleType?: string;
  objectName: string;
  bucketName?: string;
  basePath?: string;
  region?: string;
}

interface S3WorkspaceConfig {
  bucketName: string;
  basePath: string;
  artifacts: S3ArtifactEntry[];
}

const REPO_ROOT = path.resolve(__dirname, '..');
const channel = process.env.PUBLISH_CHANNEL ?? 'dev';

const WORKSPACES: Array<{ name: string; configPath: string; cwd: string }> = [
  {
    name: 'mailbox',
    configPath: path.resolve(REPO_ROOT, 'packages/mailbox/gitversion-s3.cjs'),
    cwd: path.resolve(REPO_ROOT, 'packages/mailbox'),
  },
  {
    name: 'mailbox-cognito',
    configPath: path.resolve(REPO_ROOT, 'packages/mailbox-cognito/gitversion-s3.cjs'),
    cwd: path.resolve(REPO_ROOT, 'packages/mailbox-cognito'),
  },
];

/**
 * Resolve the file path of a built artifact.
 *
 * For js-zip bundled artifacts, the bundle step writes to /tmp/<objectName-basename>.
 * For plain file artifacts, the source path is resolved relative to the workspace root.
 */
function resolveArtifactPath(entry: S3ArtifactEntry, workspaceCwd: string): string {
  if (entry.bundleType === 'js-zip') {
    return path.join('/tmp', path.basename(entry.objectName));
  }
  if (path.isAbsolute(entry.source)) {
    return entry.source;
  }
  return path.resolve(workspaceCwd, entry.source);
}

async function main(): Promise<void> {
  console.log(`Publishing artifacts to channel: ${channel}`);

  for (const workspace of WORKSPACES) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config: S3WorkspaceConfig = require(workspace.configPath);
    console.log(`\n--- Workspace: ${workspace.name} (${config.artifacts.length} artifacts) ---`);

    for (const entry of config.artifacts) {
      const bucketName = entry.bucketName ?? config.bucketName;
      const basePath = entry.basePath ?? config.basePath;
      const region = entry.region;
      const filePath = resolveArtifactPath(entry, workspace.cwd);

      console.log(`  ${entry.objectName}`);
      console.log(`    source: ${filePath}`);
      console.log(`    -> s3://${bucketName}/${basePath}/channels/${channel}/${entry.objectName}`);

      const uploader = new S3Uploader({ region });
      await uploader.uploadChannel(bucketName, basePath, channel, entry.objectName, filePath);
    }
  }

  console.log('\nAll artifacts published.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
