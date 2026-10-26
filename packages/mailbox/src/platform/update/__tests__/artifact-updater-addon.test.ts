/// <reference types="jest" />

/**
 * ArtifactUpdaterAddon: the admin API routes that reach the artifact updater.
 *
 * The routes must sit behind the admin authorizer, because they let the caller start an update
 * of deployed code; a route mounted without it is open to anyone who can reach the API.
 */

import { getAttLogicalId }                                         from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { Template }                                           from 'aws-cdk-lib/assertions';
import * as t                                                      from 'typanion';

import { isTemplateValue, resourcesOfType }                        from '../../../__tests__/template-resources';
import { routeOf }                                                 from '../../../core/apis/__tests__/apis-helpers';
import { newInlineFunction, newTestStack, synthesizeOnAdminApi }   from '../../__tests__/platform-helpers';
import { ArtifactUpdaterAddon }                                    from '../artifact-updater-addon';

const isIntegrationProperties = t.isPartial({ IntegrationUri: isTemplateValue });

describe('ArtifactUpdaterAddon', () => {
  let template: Template;

  beforeAll(() => {
    const stack = newTestStack('TestStack');

    template = synthesizeOnAdminApi(stack, new ArtifactUpdaterAddon(newInlineFunction(stack, 'updater')));
  });

  it.each(['POST', 'GET'])('routes %s requests under /artifact-updates through an authorizer', (method) => {
    const route = routeOf(template, `${method} /artifact-updates/{proxy+}`);

    expect(route.AuthorizationType).toBe('CUSTOM');
    expect(route.AuthorizerId).toBeDefined();
  });

  it('routes to the function it was given', () => {
    const [updaterLogicalId] = Object.keys(template.findResources('AWS::Lambda::Function')).filter((id) => id.startsWith('updater'));
    const integrationTargets = resourcesOfType(template, 'AWS::ApiGatewayV2::Integration', isIntegrationProperties).map((integration) =>
      getAttLogicalId(integration.properties.IntegrationUri),
    );

    expect(integrationTargets).toContain(updaterLogicalId);
  });
});
