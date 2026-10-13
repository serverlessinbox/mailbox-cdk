import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { CloudFormationPolicyStatement } from './iam-test-helpers';

export const TEST_ACCOUNT = '111122223333';
export const TEST_REGION = 'us-west-2';
export const TEST_ARTIFACT_VERSION = '0.0.1-test';

export interface DeployerTestStack {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver pinning every package the sub-stack deployers resolve artifacts from. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack = new Stack(new App(), 'test-stack', {
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: {
      mailbox: { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-edge': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.EDGE },
    },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

/** Renders a synthesized value that may hold intrinsic functions as a string, each intrinsic as `<token>`. */
export function renderWithTokens(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const join = (value as { 'Fn::Join'?: [string, unknown[]] })['Fn::Join'];
  if (join === undefined) {
    return '<token>';
  }
  const [separator, parts] = join;
  return parts.map(renderWithTokens).join(separator);
}

/** Every statement across every IAM policy of the template that includes `action`. */
export function statementsForAction(template: Template, action: string): CloudFormationPolicyStatement[] {
  const statements: CloudFormationPolicyStatement[] = [];
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
    statements.push(...policy.Properties.PolicyDocument.Statement);
  }
  return statements.filter((statement) => [statement.Action].flat().includes(action));
}
