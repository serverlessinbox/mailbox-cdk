import { S3Uploader } from '@serverlessinbox/artifact-tools/uploader';
import { readFileSync } from 'fs';


const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const artifactVersions = JSON.parse(readFileSync('artifact-versions.json', 'utf8'));

const components = {
  'mailbox-go':         { version: artifactVersions['mailbox-go'] },
  'mailbox-admin-ui':   { version: artifactVersions['mailbox-admin-ui'] },
  'mailbox-webmail-ui': { version: artifactVersions['mailbox-webmail-ui'] },
  'mailbox-cdk-edge':   { version },
};

const uploader = new S3Uploader({ region: 'eu-west-1' });
const edgeUploader = new S3Uploader({ region: 'us-east-1' });

await edgeUploader.upload(
  'mailbox-artifacts-us-east-1',
  `packages/mailbox-cdk-edge/v${version}/template.json`,
  'packages/mailbox/dist/edge/template.json',
);

const manifest = { version, publishedAt: new Date().toISOString(), components };
await uploader.uploadJson('mailbox-artifacts-eu-west-1', `packages/mailbox-cdk/v${version}/manifest.json`, manifest);
  await uploader.writeVersionPointers('mailbox-artifacts-eu-west-1', 'packages/mailbox-cdk', version);

}

