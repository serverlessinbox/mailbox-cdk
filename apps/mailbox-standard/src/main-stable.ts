import * as cdk from 'aws-cdk-lib';
import { loadTrackVersions } from '@serverlessinbox/artifact-registry';
import { MailboxStandardStack } from './mailbox-standard-stack';

void (async () => {
  const packageRegions: Record<string, string> = {
    'mailbox-go': 'eu-west-1',
    'mailbox-cdk': 'eu-west-1',
    'mailbox-cdk-edge': 'us-east-1',
    'mailbox-admin-ui': 'eu-west-1',
    'mailbox-webmail-ui': 'eu-west-1',
    'mailbox-cognito': 'eu-west-1',
  };

  const result = await loadTrackVersions({
    bucketBase: 'mailbox-artifacts',
    artifactType: 'package',
    packages: packageRegions,
  });
  console.log('Loaded artifact versions:', result.resolvedVersions);

  const context = {
    artifacts: {
      bucketBase: 'mailbox-artifacts',
      packages: Object.fromEntries(
        Object.keys(packageRegions).map((name) => [
          name,
          { kind: 'release' as const, version: result.resolvedVersions[name] },
        ]),
      ),
    },
    artifactVersions: result.versionMap,
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
