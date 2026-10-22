/// <reference types="jest" />

/**
 * Pins what a service that fetches an artifact object with the grantee's identity is allowed to read: exactly
 * the one object the resolver locates, so a template or Lambda zip is readable and no other object of the bucket is.
 */

import { Template }                               from 'aws-cdk-lib/assertions';

import { newDeployerTestStack, newWorkerStandIn } from '../../../__tests__/deployer-infra-helpers';
import { statementsForAction }                    from '../../../cdk-test-support';
import { ArtifactObject }                         from '../artifact-object';

describe('ArtifactObject', () => {
  it('lets the grantee read the object the resolver locates, and no other', () => {
    const { stack, artifactResolver } = newDeployerTestStack();
    const grantee                     = newWorkerStandIn(stack, 'grantee');

    new ArtifactObject(artifactResolver, 'mailbox-cdk-shared', 'lambdas/function.zip').grantRead(grantee);

    const statements = statementsForAction(Template.fromStack(stack), 's3:GetObject');
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toEqual(['s3:GetObject', 's3:GetObjectVersion']);
    expect(statements[0].Resource).toEqual(stack.resolve(artifactResolver.getArn('mailbox-cdk-shared', 'lambdas/function.zip')));
  });
});
