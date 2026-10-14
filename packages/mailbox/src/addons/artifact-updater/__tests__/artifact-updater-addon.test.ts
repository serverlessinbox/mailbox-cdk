/// <reference types="jest" />

/**
 * ArtifactUpdaterAddon: the admin API routes that reach the artifact updater.
 *
 * The routes must sit behind the admin authorizer, because they let the caller start an update
 * of deployed code; a route registered without it is open to anyone who can reach the API.
 */

import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { getAttLogicalId } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ArtifactUpdaterAddon } from '../artifact-updater-addon';

function inlineFunction(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
}

describe('ArtifactUpdaterAddon', () => {
  let template: Template;
  let routes: Array<Record<string, unknown>>;

  beforeAll(() => {
    const stack = new Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const updater = inlineFunction(stack, 'updater');
    const authorizer = new HttpLambdaAuthorizer('authorizer', inlineFunction(stack, 'authorizer'), {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
    });

    new ArtifactUpdaterAddon(updater).addRoutes(new HttpApi(stack, 'api'), authorizer);

    template = Template.fromStack(stack);
    routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((route) => route.Properties);
  });

  it.each(['POST', 'GET'])('routes %s requests under /artifact-updates through the authorizer', (method) => {
    expect(routes).toContainEqual(
      expect.objectContaining({ RouteKey: `${method} /artifact-updates/{proxy+}`, AuthorizationType: 'CUSTOM' }),
    );
  });

  it('routes to the function it was given', () => {
    const [updaterLogicalId] = Object.keys(template.findResources('AWS::Lambda::Function')).filter((id) => id.startsWith('updater'));
    const integrationTargets = Object.values(template.findResources('AWS::ApiGatewayV2::Integration')).map((integration) =>
      getAttLogicalId(integration.Properties.IntegrationUri),
    );

    expect(integrationTargets).toEqual([updaterLogicalId]);
  });
});
