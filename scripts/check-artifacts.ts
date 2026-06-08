#!/usr/bin/env ts-node

/**
 * Guards the release pipeline by verifying that all component latest-stable.json
 * files exist in S3 before the build proceeds. Exits 1 with a descriptive error
 * if any are missing.
 */

import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const BUCKET = 'mailbox-artifacts-eu-west-1';
const REGION = 'eu-west-1';

const REQUIRED: string[] = [
  'packages/mailbox-go/latest-stable.json',
  'packages/mailbox-admin-ui/latest-stable.json',
  'packages/mailbox-webmail-ui/latest-stable.json',
];

async function main(): Promise<void> {
  const client = new S3Client({ region: REGION });
  const missing: string[] = [];
  for (const key of REQUIRED) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      console.log(`OK: s3://${BUCKET}/${key}`);
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        missing.push(key);
        console.error(`MISSING: s3://${BUCKET}/${key}`);
      } else {
        throw err;
      }
    }
  }
  if (missing.length > 0) {
    console.error(`\nRelease blocked: ${missing.length} component artifact(s) missing from S3.`);
    console.error('Publish the following components before releasing mailbox-cdk:');
    missing.forEach(k => console.error(`  s3://${BUCKET}/${k}`));
    process.exit(1);
  }
  console.log('\nAll component artifacts present — proceeding with release.');
}

main().catch(err => { console.error(err); process.exit(1); });
