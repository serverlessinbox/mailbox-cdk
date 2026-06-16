import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { loadChannelVersions, readArtifactVersions } from '@serverlessinbox/artifact-tools';
import { MailboxStandardStack } from './mailbox-standard-stack';

void (async () => {
  const packageRegions: Record<string, string> = {
    'mailbox-go':              'eu-west-1',
    'mailbox-cdk':             'eu-west-1',
    'mailbox-cdk-edge':        'us-east-1',
    'mailbox-admin-ui':        'eu-west-1',
    'mailbox-webmail-ui':      'eu-west-1',
    'mailbox-cognito-lambdas': 'eu-west-1',
  };

  const versionMap = await loadChannelVersions({
    channel: 'dev',
    bucketBase: 'mailbox-artifacts',
    artifactType: 'package',
    packages: packageRegions,
  });
  console.log('Loaded artifact versions:', versionMap);

  const context = {
    artifacts: {
      bucketBase: 'mailbox-artifacts',
      packages: Object.fromEntries(
        Object.keys(packageRegions).map((name) => [
          name,
          { kind: 'channel' as const, channel: 'dev' },
        ]),
      ),
    },
    artifactVersions: versionMap,
  };

  const allowedRegions: string[] = [
    'eu-west-1',
  ];

  const app = new cdk.App({ context });

  new MailboxStandardStack(app, 'MailboxStandard', {
    synthesizer: new cdk.BootstraplessSynthesizer(),
    allowedRegions,
  });
})();
