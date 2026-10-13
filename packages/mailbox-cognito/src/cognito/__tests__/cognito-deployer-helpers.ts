import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

export const TEST_ARTIFACT_VERSION = '0.0.1-test';

/** One statement of a synthesized IAM policy document. */
export interface PolicyStatementJson {
  readonly Action: string | string[];
  readonly Resource: unknown;
  readonly Condition?: Record<string, Record<string, unknown>>;
}

export interface DeployerTestStack {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver pinning the packages the cognito deployer resolves artifacts from. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack = new Stack(new App(), 'test-stack', {
    env: { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: {
      'mailbox-cognito': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
    },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

export function allStatements(template: Template): PolicyStatementJson[] {
  const statements: PolicyStatementJson[] = [];
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
    statements.push(...policy.Properties.PolicyDocument.Statement);
  }
  return statements;
}

/** Every statement across every IAM policy of the template that includes `action`. */
export function statementsForAction(template: Template, action: string): PolicyStatementJson[] {
  return allStatements(template).filter((statement) => [statement.Action].flat().includes(action));
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
