/// <reference types="jest" />

/**
 * Pins what the construct of the DCR Lambda gives the function: the environment its configuration loads from, the
 * timeout and memory it runs with, and the access it grants itself. The Lambda is unauthenticated, so its role
 * must hold `CreateUserPoolClient` and `DeleteUserPoolClient` on the one user pool and nothing broader, and a
 * variable missing or renamed here stops the Lambda at cold start.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { resourcesOf, statementsForAction }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { env }                                  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { IIdentityProvisioner }            from '@serverlessinbox/mailbox';
import { Template }                             from 'aws-cdk-lib/assertions';
import { UserPool }                             from 'aws-cdk-lib/aws-cognito';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import * as t                                   from 'typanion';

import { load }                                 from '../../../runtime/jmap-oauth-dcr/config';
import { JmapOAuthDcrLambda }                   from '../jmap-oauth-dcr-lambda';

const USER_POOL_ID  = 'us-west-2_abcdefgh';
const USER_POOL_ARN = 'arn:aws:cognito-idp:us-west-2:123456789012:userpool/us-west-2_abcdefgh';

const isLambdaFunction = t.isPartial({ Properties: t.isPartial({ Environment: t.isPartial({ Variables: t.isRecord(t.isString()) }) }) });

describe('JmapOAuthDcrLambda', () => {
  const identityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  jest.fn(),
  };
  let template: Template;
  let lambda: JmapOAuthDcrLambda;
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnvironment    = { ...process.env };
    const stack            = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const artifactResolver = new PinnedArtifactResolver({
      packages:         { 'mailbox-cognito': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    lambda   = new JmapOAuthDcrLambda(stack, 'dcr-lambda', {
      artifactResolver,
      identityProvisioner,
      userPool: UserPool.fromUserPoolArn(stack, 'user-pool', USER_POOL_ARN),
    });
    template = Template.fromStack(stack);
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('runs for 30 seconds with 256 MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 30, MemorySize: 256 });
  });

  it('sets the variables its configuration loads from', () => {
    const [lambdaFunction]: unknown[] = Object.values(template.findResources('AWS::Lambda::Function'));
    const errors: string[]            = [];
    if (!isLambdaFunction(lambdaFunction, { errors })) {
      throw new Error(`The Lambda has no environment that is a set of strings: ${errors.join('; ')}`);
    }
    process.env = { ...lambdaFunction.Properties.Environment.Variables };

    expect(env.tryLoad(load)).toMatchObject({
      config: { userPoolId: USER_POOL_ID, identityProvisionerFunctionName: 'identity-provisioner' },
      error:  undefined,
    });
  });

  it('grants itself invoke access to the identity provisioner', () => {
    expect(identityProvisioner.grantInvoke).toHaveBeenCalledWith(lambda);
  });

  it('may create and delete clients in the one user pool only', () => {
    expect(statementsForAction(template, 'cognito-idp:CreateUserPoolClient').map((statement) => resourcesOf(statement))).toEqual([[USER_POOL_ARN]]);
    expect(statementsForAction(template, 'cognito-idp:DeleteUserPoolClient').map((statement) => resourcesOf(statement))).toEqual([[USER_POOL_ARN]]);
  });
});
