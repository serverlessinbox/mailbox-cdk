/// <reference types="jest" />

/**
 * Pins what the IdP users addon gives the admin API and its Lambda: the route behind the authorizer, and the
 * groups of the user pool handed to the Lambda. The route decides what the API exposes and under which path, and
 * the groups decide how the Lambda reads the roles of a caller. The UI config the addon publishes is tested beside it.
 */

import { ArtifactZone, PinnedArtifactResolver }                                                                   from '@serverlessinbox/artifact-registry-cdk';
import type { IAuditEventsQueue, IIdentityProvisioner }                                                           from '@serverlessinbox/mailbox';
import { Match, Template }                                                                                        from 'aws-cdk-lib/assertions';
import { HttpLambdaAuthorizer, HttpLambdaResponseType }                                                           from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpApi }                                                                                                from 'aws-cdk-lib/aws-apigatewayv2';
import { Code, Function as LambdaFunction, Runtime }                                                              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }                                                                   from 'aws-cdk-lib';

import { CognitoIdpUsersAdminApiAddon }                                                                           from '../cognito-idp-users-addon';
import type { CognitoIdpUsersAuthorizationConfig, ICognitoIdpUsersPoolConfig }                                    from '../cognito-idp-users-pool-config';

const USER_POOL_ID = 'us-west-2_abcdefgh';

describe('CognitoIdpUsersAdminApiAddon', () => {
  const auditEventsQueue: IAuditEventsQueue       = {
    queueUrl:  'https://sqs.us-west-2.amazonaws.com/123456789012/audit-events',
    queueArn:  'arn:aws:sqs:us-west-2:123456789012:audit-events',
    grantSend: () => {},
  };
  const identityProvisioner: IIdentityProvisioner = {
    functionArn:  'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    functionName: 'identity-provisioner',
    grantInvoke:  () => {},
  };

  function synthesize(options: { authorization?: CognitoIdpUsersAuthorizationConfig; basePath?: string }): Template {
    const { authorization }                = options;
    const stack                            = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const artifactResolver                 = new PinnedArtifactResolver({
      packages:         { 'mailbox-cognito': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
    const pool: ICognitoIdpUsersPoolConfig = {
      userPoolId:       USER_POOL_ID,
      grantAdminAccess: () => {},
      ...(authorization ? { authorizationConfig: () => authorization } : {}),
    };

    const addon = new CognitoIdpUsersAdminApiAddon(stack, 'addon', { artifactResolver, auditEventsQueue, identityProvisioner, pool, basePath: options.basePath });

    const authorizerFunction = new LambdaFunction(stack, 'authorizer-stub', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code:    Code.fromInline('exports.handler = async () => {};'),
    });
    addon.addRoutes(new HttpApi(stack, 'api'), new HttpLambdaAuthorizer('authorizer', authorizerFunction, { responseTypes: [HttpLambdaResponseType.SIMPLE] }));
    return Template.fromStack(stack);
  }

  it('hands the Lambda the groups of the user pool as JSON arrays', () => {
    const template = synthesize({ authorization: { adminGroups: ['admin'], userGroups: ['user', 'viewer'] } });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { USER_POOL_ID, ADMIN_GROUPS: '["admin"]', USER_GROUPS: '["user","viewer"]' } },
    });
  });

  it.each(['ADMIN_GROUPS', 'USER_GROUPS'])('hands the Lambda no %s variable when the user pool offers no authorization config', (variable) => {
    const template = synthesize({});

    template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: { USER_POOL_ID } } });
    const lambdasWithVariable = template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: { USER_POOL_ID, [variable]: Match.anyValue() } } },
    });
    expect(Object.keys(lambdasWithVariable)).toHaveLength(0);
  });

  it.each([
    { basePath: undefined, routeKey: 'POST /idp-users/{proxy+}' },
    { basePath: '/custom/idp-api/v2', routeKey: 'POST /custom/idp-api/v2/{proxy+}' },
  ])('routes $routeKey through the authorizer to the Lambda', ({ basePath, routeKey }) => {
    const template = synthesize({ basePath });

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey:          routeKey,
      AuthorizationType: 'CUSTOM',
      AuthorizerId:      Match.anyValue(),
      Target:            Match.anyValue(),
    });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
  });
});
