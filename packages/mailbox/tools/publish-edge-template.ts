import { App, Stack } from 'aws-cdk-lib';
import * as path from 'node:path';
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
  writeJson,
  type PublishBaseOptions,
} from './_common';
import { MailboxEdgeStack } from '../src/edge/mailbox-edge-stack';

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

function synthEdgeTemplate(props: {
  domainName: string;
  prefix?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
}): any {
  const app = new App();

  const stack = new MailboxEdgeStack(app, 'MailboxEdge', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
      region: 'us-east-1',
    },
    domainName: props.domainName,
    prefix: props.prefix,
    hostedZoneId: props.hostedZoneId,
    hostedZoneName: props.hostedZoneName,
  });

  const assembly = app.synth();
  const artifact = assembly.getStackArtifact(stack.artifactId);
  return artifact.template;
}

async function main() {
  const base = baseOptionsFromArgs();

  // Edge template always goes to us-east-1 bucket regardless of base.region; require it explicitly.
  if (base.region !== 'us-east-1') {
    throw new Error('publish-edge-template must be run with --region us-east-1');
  }

  ensureAwsCliAvailable();

  const args = parseArgs(process.argv.slice(2));
  const domainName = requireString(args, 'domainName');
  const prefix = optionalString(args, 'prefix');
  const hostedZoneId = optionalString(args, 'hostedZoneId');
  const hostedZoneName = optionalString(args, 'hostedZoneName');

  const template = synthEdgeTemplate({ domainName, prefix, hostedZoneId, hostedZoneName });

  const tmp = mkTempDir('mailbox-edge-template-');
  const templatePath = path.join(tmp, 'template.json');

  writeJson(templatePath, template);

  const bucket = artifactBucketName(base.bucketBase, base.region);
  const prefixKey = releasePrefix(base);

  const templateKey = `${prefixKey}/edge/template.json`;
  const manifestKey = `${prefixKey}/manifest.json`;

  const manifest = {
    mailboxCdkVersion: base.version,
    mode: base.mode,
    devTag: base.mode === 'dev' ? base.devTag ?? 'dev' : undefined,
    edge: {
      template: {
        bucket,
        key: templateKey,
      },
    },
  };

  // Upload template
  run('aws', ['s3', 'cp', templatePath, `s3://${bucket}/${templateKey}`, '--content-type', 'application/json', ...awsArgs(base)]);

  // Upload/overwrite manifest
  const manifestPath = path.join(tmp, 'manifest.json');
  writeJson(manifestPath, manifest);
  run('aws', ['s3', 'cp', manifestPath, `s3://${bucket}/${manifestKey}`, '--content-type', 'application/json', ...awsArgs(base)]);

  // Print a helpful URL
  // eslint-disable-next-line no-console
  console.log(`Uploaded edge template: s3://${bucket}/${templateKey}`);
  // eslint-disable-next-line no-console
  console.log(`Updated manifest: s3://${bucket}/${manifestKey}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
