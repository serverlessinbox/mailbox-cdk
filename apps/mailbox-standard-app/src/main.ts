import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { loadChannelVersions } from '@serverlessinbox/artifact-registry';
import { MailboxStandardStack } from './mailbox-standard-stack';
import { packageRegions } from './package-regions';

void (async () => {
  const artifactMode = process.env.ARTIFACT_MODE;

  let artifactVersions: Record<string, string>;
  let packages: Record<string, { kind: 'channel'; channel: string } | { kind: 'release'; version: string }>;

  if (artifactMode === 'track') {
    const trackVersionsPath = path.resolve(__dirname, '..', 'track-versions.json');
    let result: { versionMap: Record<string, string>; resolvedVersions: Record<string, string> };
    try {
      const raw = fs.readFileSync(trackVersionsPath, 'utf8');
      result = JSON.parse(raw) as {
        versionMap: Record<string, string>;
        resolvedVersions: Record<string, string>;
      };
    } catch (err) {
      throw new Error(
        `Failed to read track-versions.json at ${trackVersionsPath}. ` +
          `Run \`yarn load-track-versions\` first to generate it. (${(err as Error).message})`,
      );
    }
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
