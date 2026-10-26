/// <reference types="jest" />

/**
 * Pins the two branches of the foundation a Mailbox resolves. A supplied artifact resolver is used as
 * is, so its `mailbox-cdk` version becomes the stack version every base tag carries. Without one, the
 * resolver is pinned from the versions the package ships with, so consumers that pass nothing still
 * deploy the release they were built against. The vendor link is keyed by the root-stack identity tag,
 * the deployer type comes from the CDK context, and everything under the scope is tagged.
 */

import { DEPLOYER_TYPE_CONTEXT_KEY, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                   from 'aws-cdk-lib/assertions';
import { CfnBucket }                                         from 'aws-cdk-lib/aws-s3';
import { App, Stack }                                        from 'aws-cdk-lib';

import { loadMailboxArtifactVersions }                       from '../mailbox-artifact-versions';
import { MailboxContext }                                    from '../mailbox-context';

import { newDeployerTestStack, TEST_ARTIFACT_VERSION }       from './deployer-test-helpers';

describe('MailboxContext', () => {
  it('uses the supplied artifact resolver and its mailbox-cdk version', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    const context = MailboxContext.resolve(stack, { artifactResolver });

    expect(context.artifactResolver).toBe(artifactResolver);
    expect(context.stackVersion).toBe(TEST_ARTIFACT_VERSION);
  });

  it('pins the shipped mailbox-cdk version when no resolver is supplied', () => {
    const { stack } = newDeployerTestStack();

    const context = MailboxContext.resolve(stack, {});

    expect(context.stackVersion).toBe(loadMailboxArtifactVersions()['mailbox-cdk'].version);
  });

  it('keys the vendor link by the root-stack identity tag', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    const context = MailboxContext.resolve(stack, { artifactResolver });

    expect(context.vendorLink.stackIdentityTagKey).toBe(ServerlessInboxTagKeys.rootStack);
  });

  it('takes the deployer type from the CDK context', () => {
    const { artifactResolver } = newDeployerTestStack();
    const stack                = new Stack(new App({ context: { [DEPLOYER_TYPE_CONTEXT_KEY]: 'marketplace' } }), 'ctx-stack');

    const context = MailboxContext.resolve(stack, { artifactResolver });

    expect(context.deployerType).toBe('marketplace');
  });

  it('tags every resource under the scope with the Mailbox as the root stack', () => {
    const { stack, artifactResolver } = newDeployerTestStack();
    new CfnBucket(stack, 'Tagged');

    MailboxContext.resolve(stack, { artifactResolver });

    Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([{ Key: ServerlessInboxTagKeys.rootStack, Value: { Ref: 'AWS::StackName' } }]),
    });
  });
});
