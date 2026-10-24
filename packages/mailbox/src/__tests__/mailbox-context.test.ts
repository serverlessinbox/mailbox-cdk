/// <reference types="jest" />

/**
 * Pins the two branches of the foundation a Mailbox resolves. A supplied artifact resolver is used as
 * is, so its `mailbox-cdk` version becomes the stack version every base tag carries. Without one, the
 * resolver is pinned from the versions the package ships with, so consumers that pass nothing still
 * deploy the release they were built against. The vendor link is keyed by the root-stack identity tag,
 * and the encryption plan is the one the KMS settings it is given resolve to.
 */

import { ServerlessInboxTagKeys }                      from '@serverlessinbox/mailbox-cdk-shared';
import { TableEncryption }                             from 'aws-cdk-lib/aws-dynamodb';

import { MailboxKmsMode }                              from '../core/mailbox-kms-mode';
import { loadMailboxArtifactVersions }                 from '../mailbox-artifact-versions';
import { MailboxContext }                              from '../mailbox-context';

import { newDeployerTestStack, TEST_ARTIFACT_VERSION } from './deployer-test-helpers';

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

  it('resolves the encryption plan from the KMS settings it is given', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    const context = MailboxContext.resolve(stack, { artifactResolver, kms: { mode: MailboxKmsMode.NONE } });

    expect(context.encryptionPlan.dynamoTables).toEqual({ encryption: TableEncryption.DEFAULT });
  });
});
