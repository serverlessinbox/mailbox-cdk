/**
 * Pins what `StackUpdateAddon` decides for the stack-update Lambda: where the release pointer and the
 * template are read from (the registry bucket of the deployment region, written with the region
 * intrinsic, never a literal), which release line it follows, and that the Lambda is wired to the
 * template-version parameter the addon creates. A literal region would pin a customer template to
 * the region it was synthesized in.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                     from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import * as dynamodb                            from 'aws-cdk-lib/aws-dynamodb';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { AuditEventsQueue }                     from '../../../resources/queues/audit-events-queue';
import { DataTable }                            from '../../../resources/tables/data-tables';
import { StackUpdateAddon }                     from '../stack-update-addon';

const REGION = { Ref: 'AWS::Region' };

interface SynthesizedAddon {
  readonly addon:    StackUpdateAddon;
  readonly template: Template;
}

function synthesize(distTag?: string): SynthesizedAddon {
  const stack = new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const packages: Record<string, ArtifactPin> = {
    'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  const addon                                 = new StackUpdateAddon(stack, 'stack-update-addon', {
    configTable:      new DataTable(dynamodb.Table.fromTableArn(stack, 'config-table', 'arn:aws:dynamodb:us-west-2:123456789012:table/config')),
    auditEventsQueue: new AuditEventsQueue(stack, 'audit-queue'),
    artifactResolver: new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    templateName:     'mailbox-standard',
    templateVersion:  '1.0.0',
    distTag,
  });
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
});
