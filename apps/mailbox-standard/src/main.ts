import * as cdk from 'aws-cdk-lib';
import { loadChannelVersions } from '@serverlessinbox/artifact-tools';
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

  const versions = await loadChannelVersions({
    channel: 'dev',
    bucketBase: 'mailbox-artifacts',
    packages: packageRegions,
  });

  const context = {
    deployer: 'cfn',
    artifacts: {
      bucketBase: 'mailbox-artifacts',
      packages: Object.fromEntries(
        Object.keys(packageRegions).map((name) => [
          name,
          { kind: 'release' as const, version: versions[name] },
        ]),
      ),
    },
  };

  const app = new cdk.App({ context });

  new MailboxStandardStack(app, 'MailboxStandard', {
    synthesizer: new cdk.BootstraplessSynthesizer(),
  });
})();
