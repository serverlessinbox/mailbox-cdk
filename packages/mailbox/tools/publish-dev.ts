import { App } from 'aws-cdk-lib';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
  writeJson,
} from './_common';
import { MailboxEdgeStack } from '../src/edge/mailbox-edge-stack';

function s3HttpsUrl(bucket: string, region: string, key: string): string {
  // Virtual-hosted–style URL; simplest for CloudFormation TemplateURL.
  return `https://${bucket}.s3.${region}.amazonaws.com/${key.replace(/^\/+/, '')}`;
}

function parseRegions(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type BaseNoRegion = Omit<import('./_common').PublishBaseOptions, 'region'>;

function baseOptionsFromArgs(): BaseNoRegion {
  const args = parseArgs(process.argv.slice(2));

  const bucketBase = requireString(args, 'bucketBase');
  const mode = requireString(args, 'mode') as 'release' | 'dev';
  const version = requireString(args, 'version');
  const devTag = optionalString(args, 'devTag');
  const profile = optionalString(args, 'profile');

  if (mode !== 'release' && mode !== 'dev') {
    throw new Error('--mode must be release|dev');
  }

  return { bucketBase, mode, version, devTag, profile };
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

async function bundleNodeLambdaZip(entryPath: string, tmpDir: string): Promise<string> {
  const outJs = path.join(tmpDir, 'index.js');

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
      // AWS SDK v2 is available in the runtime
      'aws-sdk',
    ],
  });

  const zipPath = path.join(tmpDir, 'lambda.zip');
  run('zip', ['-j', zipPath, outJs]);
  return zipPath;
}

async function main() {
  const base = baseOptionsFromArgs();
  ensureAwsCliAvailable();

  const args = parseArgs(process.argv.slice(2));

  const domainName = requireString(args, 'domainName');
  const prefix = optionalString(args, 'prefix');
  const hostedZoneId = optionalString(args, 'hostedZoneId');
  const hostedZoneName = optionalString(args, 'hostedZoneName');

  // Regions where the regional custom resources must run.
  const regions = parseRegions(requireString(args, 'regions'));

  // Publication locations
  const edgeRegion = 'us-east-1';
  const edgeBucket = artifactBucketName(base.bucketBase, edgeRegion);
  const edgeBase = { ...base, region: edgeRegion };
  const edgePrefix = releasePrefix(edgeBase);

  // 1) Publish edge stack template
  const tmp = mkTempDir('mailbox-publish-dev-');
  const edgeTemplate = synthEdgeTemplate({ domainName, prefix, hostedZoneId, hostedZoneName });
  const edgeTemplatePath = path.join(tmp, 'edge.template.json');
  writeJson(edgeTemplatePath, edgeTemplate);

  const edgeTemplateKey = `${edgePrefix}/edge/template.json`;
  run('aws', ['s3', 'cp', edgeTemplatePath, `s3://${edgeBucket}/${edgeTemplateKey}`, '--content-type', 'application/json', ...awsArgs(edgeBase)]);

  const edgeTemplateUrl = s3HttpsUrl(edgeBucket, edgeRegion, edgeTemplateKey);

  // 2) Publish edge lambda(s) (us-east-1)
  const blobAuthorizerEntry = path.join(process.cwd(), 'src/modules/edge-functions/blob-authorizer/index.ts');
  if (!fs.existsSync(blobAuthorizerEntry)) {
    throw new Error(`Edge lambda entry not found: ${blobAuthorizerEntry}`);
  }

  const blobTmp = path.join(tmp, 'blob-authorizer');
  fs.mkdirSync(blobTmp, { recursive: true });
  const blobZip = await bundleNodeLambdaZip(blobAuthorizerEntry, blobTmp);

  const blobKey = `${edgePrefix}/edge/lambdas/blob-authorizer.zip`;
  run('aws', ['s3', 'cp', blobZip, `s3://${edgeBucket}/${blobKey}`, ...awsArgs(edgeBase)]);

  // 3) Publish regional custom-resource lambdas
  // Example: edge stack deployer custom resource handler
  const deployerEntry = path.join(process.cwd(), 'src/edge/mailbox-edge-deployer.handler.ts');
  if (!fs.existsSync(deployerEntry)) {
    throw new Error(`Regional custom resource entry not found: ${deployerEntry}`);
  }

  const regionalKeys: Array<{ region: string; bucket: string; key: string }> = [];

  for (const region of regions) {
    const bucket = artifactBucketName(base.bucketBase, region);
    const regionalBase = { ...base, region };
    const prefixKey = releasePrefix(regionalBase);

    const regionalTmp = path.join(tmp, `regional-${region}`);
    fs.mkdirSync(regionalTmp, { recursive: true });
    const zipPath = await bundleNodeLambdaZip(deployerEntry, regionalTmp);

    const key = `${prefixKey}/regional/lambdas/mailbox-edge-deployer.zip`;
    run('aws', ['s3', 'cp', zipPath, `s3://${bucket}/${key}`, ...awsArgs(regionalBase)]);

    regionalKeys.push({ region, bucket, key });

    // Write a manifest per region so stacks can resolve regional artifacts locally.
    const manifest = {
      mailboxCdkVersion: base.version,
      mode: base.mode,
      devTag: base.mode === 'dev' ? base.devTag ?? 'dev' : undefined,
      edge: {
        region: edgeRegion,
        bucket: edgeBucket,
        templateUrl: edgeTemplateUrl,
        certificateDomains: {
          admin: `admin.${prefix ? `${prefix}.` : ''}${domainName}`,
          webmail: `webmail.${prefix ? `${prefix}.` : ''}${domainName}`,
          auth: `auth.${prefix ? `${prefix}.` : ''}${domainName}`,
          cdn: `cdn.${prefix ? `${prefix}.` : ''}${domainName}`,
        },
        lambdas: {
          blobAuthorizer: {
            bucket: edgeBucket,
            key: blobKey,
          },
        },
      },
      regional: {
        region,
        bucket,
        lambdas: {
          mailboxEdgeDeployer: {
            bucket,
            key,
          },
        },
      },
    };

    const manifestPath = path.join(regionalTmp, 'manifest.json');
    writeJson(manifestPath, manifest);

    const manifestKey = `${prefixKey}/manifest.json`;
    run('aws', ['s3', 'cp', manifestPath, `s3://${bucket}/${manifestKey}`, '--content-type', 'application/json', ...awsArgs(regionalBase)]);

    // eslint-disable-next-line no-console
    console.log(`Updated manifest: s3://${bucket}/${manifestKey}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Uploaded edge template: ${edgeTemplateUrl}`);
  // eslint-disable-next-line no-console
  console.log(`Uploaded edge lambda: s3://${edgeBucket}/${blobKey}`);
  for (const r of regionalKeys) {
    // eslint-disable-next-line no-console
    console.log(`Uploaded regional lambda (${r.region}): s3://${r.bucket}/${r.key}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
