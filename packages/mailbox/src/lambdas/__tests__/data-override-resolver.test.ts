/**
 * DataOverrideResolverLambda tests. The Lambda must be able to describe the operator's override
 * table, which can be any table in the account, so DescribeTable is granted on every table; a missing
 * grant fails every override with AccessDenied. Its code comes from the `mailbox-cdk` package pin, so
 * a resolver without that pin must fail to synthesize rather than reference a missing artifact.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin } from '@serverlessinbox/artifact-registry-cdk';
import { DataOverrideResolverLambda } from '../data-override-resolver';

interface PolicyStatementJson {
  Action: string | string[];
  Effect: string;
  Resource: unknown;
}

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function resolverWithPins(stack: cdk.Stack, packages: Record<string, ArtifactPin>): PinnedArtifactResolver {
  return new PinnedArtifactResolver({
    packages,
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

describe('DataOverrideResolverLambda', () => {
  it('grants dynamodb:DescribeTable, and no other action, on every DynamoDB table', () => {
    const stack = createStack();
    new DataOverrideResolverLambda(stack, 'resolver', {
      artifactResolver: resolverWithPins(stack, { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } }),
    });

    const statements = Object.values(Template.fromStack(stack).findResources('AWS::IAM::Policy')).flatMap(
      (policy) => policy.Properties.PolicyDocument.Statement as PolicyStatementJson[],
    );

    expect(statements).toEqual([
      { Action: 'dynamodb:DescribeTable', Effect: 'Allow', Resource: expect.anything() },
    ]);
    expect(JSON.stringify(statements[0].Resource)).toMatch(/:dynamodb:.*:table\/\*/);
  });

  it('fails to synthesize naming the package the resolver holds no pin for', () => {
    const stack = createStack();

    expect(() => {
      new DataOverrideResolverLambda(stack, 'resolver', {
        artifactResolver: resolverWithPins(stack, { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } }),
      });
    }).toThrow("No resolved data for package 'mailbox-cdk'");
  });
});
