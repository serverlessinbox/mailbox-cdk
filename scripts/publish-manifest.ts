#!/usr/bin/env ts-node

/**
 * Writes packages/mailbox-cdk/v{version}/manifest.json to S3.
 *
 * Must run after `yarn gitversion publish` so the CDK version is already bumped
 * and all S3 artifacts are in place.
 *
 * Reads the CDK version from packages/mailbox/package.json (already bumped by
 * `yarn gitversion bump`). Reads component versions from artifact-versions.json
 * (written by resolve-artifacts.ts).
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const BUCKET = 'mailbox-artifacts-eu-west-1';
const REGION = 'eu-west-1';

async function main(): Promise<void> {
  const artifactVersionsPath = path.join(__dirname, '..', 'artifact-versions.json');
  const packageJsonPath = path.join(__dirname, '..', 'packages', 'mailbox', 'package.json');

  const artifactVersions: Record<string, string> = JSON.parse(fs.readFileSync(artifactVersionsPath, 'utf8'));
  const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string };

  if (!version || version === '0.0.0') {
    throw new Error(`Unexpected mailbox version: "${version}". Was yarn gitversion bump run?`);
  }

  const manifest = {
    version,
    publishedAt: new Date().toISOString(),
    components: {
      'mailbox-go':         artifactVersions['mailbox-go'],
      'mailbox-admin-ui':   artifactVersions['mailbox-admin-ui'],
      'mailbox-webmail-ui': artifactVersions['mailbox-webmail-ui'],
      'mailbox-cdk-edge':   version,
    },
  };

  const key = `packages/mailbox-cdk/v${version}/manifest.json`;
  const client = new S3Client({ region: REGION });

  console.log(`Publishing manifest to s3://${BUCKET}/${key}`);
  console.log(JSON.stringify(manifest, null, 2));

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));

  console.log('Manifest published.');
}

main().catch(err => { console.error(err); process.exit(1); });
