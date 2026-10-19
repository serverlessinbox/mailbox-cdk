/// <reference types="jest" />

/**
 * Pins the one branch of the foundation a Mailbox resolves: a supplied artifact resolver is used
 * as is, and its `mailbox-cdk` version becomes the stack version every base tag carries. Ignoring
 * the supplied resolver would pin consumers to the package's baked versions instead of their own.
 */

import { MailboxContext } from '../mailbox-context';
import { newDeployerTestStack, TEST_ARTIFACT_VERSION } from './deployer-test-helpers';

describe('MailboxContext', () => {
  it('uses the supplied artifact resolver and its mailbox-cdk version', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    const context = MailboxContext.resolve(stack, { artifactResolver });

    expect(context.artifactResolver).toBe(artifactResolver);
    expect(context.stackVersion).toBe(TEST_ARTIFACT_VERSION);
  });
});
