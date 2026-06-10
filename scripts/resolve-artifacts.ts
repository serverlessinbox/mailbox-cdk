#!/usr/bin/env ts-node

/**
 * Resolves component artifact versions from S3 and writes artifact-versions.json.
 *
 * Reads:
 *   s3://mailbox-artifacts-eu-west-1/packages/mailbox-go/latest-stable.json
 *   s3://mailbox-artifacts-eu-west-1/packages/mailbox-admin-ui/latest-stable.json
 *   s3://mailbox-artifacts-eu-west-1/packages/mailbox-webmail-ui/latest-stable.json
 *
 * Writes:
 *   <repo-root>/artifact-versions.json
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const BUCKET = 'mailbox-artifacts-eu-west-1';
const REGION = 'eu-west-1';

interface Component {
  key: string;
  s3Key: string;
}

const COMPONENTS: Component[] = [
  { key: 'mailbox-go',         s3Key: 'packages/mailbox-go/latest-stable.json' },
  { key: 'mailbox-admin-ui',   s3Key: 'packages/mailbox-admin-ui/latest-stable.json' },
  { key: 'mailbox-webmail-ui', s3Key: 'packages/mailbox-webmail-ui/latest-stable.json' },
];

async function fetchVersion(client: S3Client, s3Key: string): Promise<string> {
  const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const body = await (resp.Body as any).transformToString();
  const parsed = JSON.parse(body);
  if (!parsed.version) throw new Error(`No .version in s3://${BUCKET}/${s3Key}`);
  return parsed.version as string;
}

async function main(): Promise<void> {
  const client = new S3Client({ region: REGION });
  const result: Record<string, string> = {};
  for (const { key, s3Key } of COMPONENTS) {
    process.stdout.write(`Resolving ${key} from s3://${BUCKET}/${s3Key} ... `);
    result[key] = await fetchVersion(client, s3Key);
    console.log(result[key]);
  }

  const outPath = path.join(__dirname, '..', 'artifact-versions.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`Written: ${outPath}`);

  const pkgOutPath = path.join(__dirname, '..', 'packages', 'mailbox', 'artifact-versions.json');
  fs.writeFileSync(pkgOutPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`Written: ${pkgOutPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
