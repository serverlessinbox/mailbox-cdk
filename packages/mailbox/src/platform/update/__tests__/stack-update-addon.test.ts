/**
 * Pins what `StackUpdateAddon` decides for the stack-update Lambda: where the release pointer and the
 * template are read from (the registry bucket of the deployment region, written with the region
 * intrinsic, never a literal), which release line it follows, and that the Lambda is wired to the
 * template-version parameter the addon creates. A literal region would pin a customer template to
 * the region it was synthesized in.
 */

import { getAttLogicalId }                                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                                              from 'aws-cdk-lib/assertions';
import * as dynamodb                                                    from 'aws-cdk-lib/aws-dynamodb';
import type { Stack }                                                   from 'aws-cdk-lib';
import * as t                                                           from 'typanion';

import { isTemplateValue, resourcesOfType }                             from '../../../__tests__/template-resources';
import { routeOf }                                                      from '../../../core/apis/__tests__/apis-helpers';
import { AuditEventsQueue }                                             from '../../../resources/queues/audit-events-queue';
import { DataTable }                                                    from '../../../resources/tables/data-tables';
import { newArtifactResolver, newTestStack, synthesizeOnAdminApi }      from '../../__tests__/platform-helpers';
import { StackUpdateAddon }                                             from '../stack-update-addon';

const REGION   = { Ref: 'AWS::Region' };
const STACK_ID = { Ref: 'AWS::StackId' };

const isIntegrationProperties = t.isPartial({ IntegrationUri: isTemplateValue });

interface SynthesizedAddon {
  readonly addon:    StackUpdateAddon;
  readonly template: Template;
}

function newAddon(stack: Stack, distTag?: string): StackUpdateAddon {
  return new StackUpdateAddon(stack, 'stack-update-addon', {
    configTable:      new DataTable(dynamodb.Table.fromTableArn(stack, 'config-table', 'arn:aws:dynamodb:us-west-2:123456789012:table/config')),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-queue'),
    artifactResolver: newArtifactResolver(stack),
    templateName:     'mailbox-standard',
    templateVersion:  '1.0.0',
    distTag,
  });
}

function synthesize(distTag?: string): SynthesizedAddon {
  const stack = newTestStack('TestStack');
  const addon = newAddon(stack, distTag);
  return { addon, template: Template.fromStack(stack) };
}

function lambdaEnvironment(template: Template, variables: Record<string, unknown>): void {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike(variables) },
  });
}

describe('StackUpdateAddon', () => {
  it('reports stack updates as available', () => {
    expect(synthesize().addon.uiConfig).toEqual({ stackUpdate: { available: true } });
  });

  it('reads the release pointer and the template from the registry bucket of the deployment region', () => {
    lambdaEnvironment(synthesize().template, {
      POINTER_BUCKET:        { 'Fn::Join': ['', ['test-artifacts-', REGION]] },
      TEMPLATE_URL_TEMPLATE: {
        'Fn::Join': [
          '',
          [
            'https://test-artifacts-',
            REGION,
            '.s3.',
            REGION,
            '.amazonaws.com/serverlessinbox/templates/mailbox-standard/releases/v{version}/{objectName}',
          ],
        ],
      },
    });
  });

  it('follows the stable release line when no dist-tag is given', () => {
    lambdaEnvironment(synthesize().template, {
      POINTER_KEY: 'serverlessinbox/templates/mailbox-standard/releases/stable.json',
    });
  });

  it('follows the release line of the dist-tag it is given', () => {
    lambdaEnvironment(synthesize('beta').template, {
      POINTER_KEY: 'serverlessinbox/templates/mailbox-standard/releases/beta.json',
    });
  });

  it('stores the template version in a parameter the Lambda is told the name of', () => {
    const { template }  = synthesize();
    const [parameterId] = Object.keys(template.findResources('AWS::SSM::Parameter'));

    template.hasResourceProperties('AWS::SSM::Parameter', { Value: '1.0.0' });
    lambdaEnvironment(template, { TEMPLATE_VERSION_PARAM_NAME: { Ref: parameterId } });
  });

  it('passes its own stack id to the handler as the root stack it prepares change sets for', () => {
    lambdaEnvironment(synthesize().template, { ROOT_STACK_ARN: STACK_ID });
  });
});

describe('StackUpdateAddon routes', () => {
  let template: Template;

  beforeAll(() => {
    const stack = newTestStack('TestStack');

    template = synthesizeOnAdminApi(stack, newAddon(stack));
  });

  it('serves POST /stack-update/{proxy+} behind an authorizer and no other method', () => {
    const route = routeOf(template, 'POST /stack-update/{proxy+}');

    expect(route.AuthorizationType).toBe('CUSTOM');
    expect(route.AuthorizerId).toBeDefined();
    template.resourcePropertiesCountIs('AWS::ApiGatewayV2::Route', { RouteKey: Match.stringLikeRegexp('/stack-update/') }, 1);
  });

  it('routes that path to the stack-update Lambda', () => {
    const [lambdaId]         = Object.keys(template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: { ROOT_STACK_ARN: Match.anyValue() } } },
    }));
    const integrationTargets = resourcesOfType(template, 'AWS::ApiGatewayV2::Integration', isIntegrationProperties).map((integration) =>
      getAttLogicalId(integration.properties.IntegrationUri),
    );

    expect(integrationTargets).toContain(lambdaId);
  });
});
