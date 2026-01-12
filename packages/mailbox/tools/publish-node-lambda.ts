import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import {
  artifactBucketName,
  awsArgs,
  ensureAwsCliAvailable,
  mkTempDir,
  optionalString,
  parseArgs,
  releasePrefix,
  requireString,
  run,
  type PublishBaseOptions,
} from './_common';

function baseOptionsFromArgs(): PublishBaseOptions {
  const args = parseArgs(process.argv.slice(2));

  const bucketBase = requireString(args, 'bucketBase');
  const region = requireString(args, 'region');
  const mode = requireString(args, 'mode') as 'release' | 'dev';
  const version = requireString(args, 'version');
  const devTag = optionalString(args, 'devTag');
  const profile = optionalString(args, 'profile');

  if (mode !== 'release' && mode !== 'dev') {
    throw new Error('--mode must be release|dev');
  }

  return { bucketBase, region, mode, version, devTag, profile };
}

async function main() {
  const base = baseOptionsFromArgs();
  ensureAwsCliAvailable();

  const args = parseArgs(process.argv.slice(2));

  // entry is a TS/JS file path relative to packages/mailbox
  const entry = requireString(args, 'entry');
  const outKey = requireString(args, 'key');

  const entryPath = path.isAbsolute(entry)
    ? entry
    : path.join(process.cwd(), entry);

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entry file not found: ${entryPath}`);
  }

  const tmp = mkTempDir('mailbox-node-lambda-');
  const outJs = path.join(tmp, 'index.js');

  await esbuild.build({
    entryPoints: [entryPath],
    outfile: outJs,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    minify: true,
    external: [
      // AWS SDK v2 is available in the Lambda runtime; keep bundles small
      'aws-sdk',
    ],
  });

  const zipPath = path.join(tmp, 'lambda.zip');

  // Zip up index.js only
  run('zip', ['-j', zipPath, outJs]);

  const bucket = artifactBucketName(base.bucketBase, base.region);
  const prefixKey = releasePrefix(base);

  const fullKey = `${prefixKey}/${outKey.replace(/^\/+/, '')}`;

  run('aws', ['s3', 'cp', zipPath, `s3://${bucket}/${fullKey}`, ...awsArgs(base)]);

  // eslint-disable-next-line no-console
  console.log(`Uploaded lambda zip: s3://${bucket}/${fullKey}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
