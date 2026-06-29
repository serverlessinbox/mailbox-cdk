import * as cdk from 'aws-cdk-lib';
import { loadChannelVersions, loadTrackVersions } from '@serverlessinbox/artifact-registry';
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

  const artifactMode = process.env.ARTIFACT_MODE;

  let artifactVersions: Record<string, string>;
  let packages: Record<string, { kind: 'channel'; channel: string } | { kind: 'release'; version: string }>;

  if (artifactMode === 'track') {
    const result = await loadTrackVersions({
      bucketBase: 'mailbox-artifacts',
      artifactType: 'package',
      packages: packageRegions,
    });
    artifactVersions = result.versionMap;
    console.log(artifactVersions);
    packages = Object.fromEntries(
      Object.keys(packageRegions).map((name) => [
        name,
        { kind: 'release' as const, version: result.resolvedVersions[name] },
      ]),
    );
  } else {
    const versionMap = await loadChannelVersions({
      channel: 'dev',
      bucketBase: 'mailbox-artifacts',
      artifactType: 'package',
      packages: packageRegions,
    });
    artifactVersions = versionMap;
    packages = Object.fromEntries(
      Object.keys(packageRegions).map((name) => [
        name,
        { kind: 'channel' as const, channel: 'dev' },
      ]),
    );
  }

  const context = {
    artifacts: {
      bucketBase: 'mailbox-artifacts',
      packages,
    },
    artifactVersions,
  };

  const allowedRegions: string[] = ['eu-west-1'];
  const app = new cdk.App({ context });
  new MailboxStandardStack(app, 'MailboxStandard', {
    synthesizer: new cdk.BootstraplessSynthesizer(),
    allowedRegions,
  });
})();
