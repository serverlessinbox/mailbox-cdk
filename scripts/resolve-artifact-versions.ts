import { S3Uploader } from '@serverlessinbox/artifact-tools/uploader';
import { writeFileSync } from 'fs';

const uploader = new S3Uploader({ region: 'eu-west-1' });
const bucket = 'mailbox-artifacts-eu-west-1';

const [go, adminUi, webmail] = await Promise.all([
  uploader.readJson(bucket, 'packages/mailbox-go/latest-stable.json'),
  uploader.readJson(bucket, 'packages/mailbox-admin-ui/latest-stable.json'),
  uploader.readJson(bucket, 'packages/mailbox-webmail-ui/latest-stable.json'),
]);

const versions = {
  'mailbox-go':         (go as any).version,
  'mailbox-admin-ui':   (adminUi as any).version,
  'mailbox-webmail-ui': (webmail as any).version,
};

writeFileSync('artifact-versions.json', JSON.stringify(versions, null, 2));
console.log('artifact-versions.json written:', versions);
