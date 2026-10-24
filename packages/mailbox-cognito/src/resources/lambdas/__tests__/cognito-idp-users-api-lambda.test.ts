/// <reference types="jest" />

/**
 * Pins what the construct of the IdP users API Lambda gives the function: the environment the function reads
 * at cold start, the timeout and memory it runs with, and that it grants itself the access it needs. A variable
 * missing or renamed here stops the Lambda at cold start; the group lists must be absent, not empty, when the
 * user pool defines none.
 */

import { ArtifactZone, PinnedArtifactResolver }                         from '@serverlessinbox/artifact-registry-cdk';
import type { IAuditEventsQueue, IIdentityProvisioner }                 from '@serverlessinbox/mailbox';
import { Match, Template }                                              from 'aws-cdk-lib/assertions';
import { UserPool }                                                     from 'aws-cdk-lib/aws-cognito';
import { App, BootstraplessSynthesizer, Stack }                         from 'aws-cdk-lib';

import type { ICognitoIdpUsersPoolConfig }                              from '../../../cognito-idp-users-pool-config';
import { CognitoIdpUsersApiLambda, type CognitoIdpUsersApiLambdaProps } from '../cognito-idp-users-api-lambda';

const USER_POOL_ARN = 'arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_abcdefgh';

describe('CognitoIdpUsersApiLambda', () => {
  const grantAdminAccess                          = jest.fn();
  const auditEventsQueue: IAuditEventsQueue       = {
    queueUrl:  'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
    queueArn:  'arn:aws:sqs:us-west-2:123456789012:audit-events',
    grantSend: jest.fn(),
  };
  const identityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  jest.fn(),
  };

  function synthesize(groups: Pick<CognitoIdpUsersApiLambdaProps, 'adminGroups' | 'userGroups'>): { template: Template; lambda: CognitoIdpUsersApiLambda } {
    const stack            = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const artifactResolver = new PinnedArtifactResolver({
      packages:         { 'mailbox-cognito': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const pool: ICognitoIdpUsersPoolConfig = { userPool: UserPool.fromUserPoolArn(stack, 'user-pool', USER_POOL_ARN), grantAdminAccess };
    const lambda                           = new CognitoIdpUsersApiLambda(stack, 'idp-users', { artifactResolver, auditEventsQueue, identityProvisioner, pool, ...groups });
    return { template: Template.fromStack(stack), lambda };
  }

  function expectEnvironment(template: Template, variables: unknown): void {
    template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: variables } });
  }

  it('runs for 15 seconds with 256 MB', () => {
    const { template } = synthesize({});

    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 15, MemorySize: 256 });
  });

  it('reads the pool, the queue, the provisioner and the groups from its environment, the groups as JSON arrays', () => {
    const { template } = synthesize({ adminGroups: ['admin', 'staff'], userGroups: ['user'] });

    expectEnvironment(template, Match.exact({
      USER_POOL_ID:                       'us-west-2_abcdefgh',
      AUDIT_EVENTS_QUEUE_URL:             'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
      IDENTITY_PROVISIONER_FUNCTION_NAME: 'identity-provisioner',
      ADMIN_GROUPS:                       '["admin","staff"]',
      USER_GROUPS:                        '["user"]',
      SERVICE_NAME:                       'cognito-idp-users-api',
    }));
  });

  it('leaves the group variables out when the user pool defines no groups, and keeps an empty list when it defines an empty one', () => {
    const withoutGroups = synthesize({}).template;
    expectEnvironment(withoutGroups, Match.not(Match.objectLike({ ADMIN_GROUPS: Match.anyValue() })));
    expectEnvironment(withoutGroups, Match.not(Match.objectLike({ USER_GROUPS: Match.anyValue() })));
    expectEnvironment(synthesize({ adminGroups: [], userGroups: [] }).template, Match.objectLike({ ADMIN_GROUPS: '[]', USER_GROUPS: '[]' }));
  });

  it('grants itself administrative access to the pool, send access to the queue and invoke access to the provisioner', () => {
    const { lambda } = synthesize({});

    expect(grantAdminAccess).toHaveBeenCalledWith(lambda);
    expect(auditEventsQueue.grantSend).toHaveBeenCalledWith(lambda);
    expect(identityProvisioner.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
