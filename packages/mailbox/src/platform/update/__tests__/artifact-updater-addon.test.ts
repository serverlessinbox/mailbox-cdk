/// <reference types="jest" />

/**
 * ArtifactUpdaterAddon: the admin API routes that reach the artifact updater.
 *
 * The routes must sit behind the admin authorizer, because they let the caller start an update
 * of deployed code; a route registered without it is open to anyone who can reach the API.
 */

import { getAttLogicalId }                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                     from 'aws-cdk-lib/assertions';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpApi }                                      from 'aws-cdk-lib/aws-apigatewayv2';
import * as t                                           from 'typanion';

import { isTemplateValue, resourcesOfType }             from '../../../__tests__/template-resources';
import { newInlineFunction, newTestStack }              from '../../__tests__/platform-helpers';
import { ArtifactUpdaterAddon }                         from '../artifact-updater-addon';

const isRouteProperties       = t.isPartial({ RouteKey: t.isString(), AuthorizationType: t.isOptional(t.isString()) });
const isIntegrationProperties = t.isPartial({ IntegrationUri: isTemplateValue });

type RouteProperties = t.InferType<typeof isRouteProperties>;

describe('ArtifactUpdaterAddon', () => {
  let template: Template;
  let routes: RouteProperties[];

  beforeAll(() => {
    const stack      = newTestStack('TestStack');
    const updater    = newInlineFunction(stack, 'updater');
    const authorizer = new HttpLambdaAuthorizer('authorizer', newInlineFunction(stack, 'authorizer'), {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
    });

    new ArtifactUpdaterAddon(updater).addRoutes(new HttpApi(stack, 'api'), authorizer);

    template = Template.fromStack(stack);
    routes   = resourcesOfType(template, 'AWS::ApiGatewayV2::Route', isRouteProperties).map((route) => route.properties);
  });

  it.each(['POST', 'GET'])('routes %s requests under /artifact-updates through the authorizer', (method) => {
    expect(routes).toContainEqual(
      expect.objectContaining({ RouteKey: `${method} /artifact-updates/{proxy+}`, AuthorizationType: 'CUSTOM' }),
    );
  });

  it('routes to the function it was given', () => {
    const [updaterLogicalId] = Object.keys(template.findResources('AWS::Lambda::Function')).filter((id) => id.startsWith('updater'));
    const integrationTargets = resourcesOfType(template, 'AWS::ApiGatewayV2::Integration', isIntegrationProperties).map((integration) =>
      getAttLogicalId(integration.properties.IntegrationUri),
    );

    expect(integrationTargets).toEqual([updaterLogicalId]);
  });
});
