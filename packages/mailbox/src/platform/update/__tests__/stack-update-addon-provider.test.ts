/**
 * Pins what `StackUpdateAddonProvider` decides when the Admin API asks it for its addons: that it
 * returns the one stack-update addon, that the addon is created under the scope the Admin API passes,
 * and that the settings it was given (dist-tag, template name, template version) reach the addon.
 */

import { Template, Match }                                             from 'aws-cdk-lib/assertions';
import type { Stack }                                                  from 'aws-cdk-lib';
import { Construct }                                                   from 'constructs';

import { newAdminApiAddonContext, newArtifactResolver, newTestStack }  from '../../__tests__/platform-helpers';
import { StackUpdateAddonProvider }                                    from '../stack-update-addon-provider';
import type { StackUpdateAddonProviderProps }                          from '../stack-update-addon-provider';

function providerProps(stack: Stack, overrides: Partial<StackUpdateAddonProviderProps> = {}): StackUpdateAddonProviderProps {
  return {
    artifactResolver: newArtifactResolver(stack),
    templateName:     'mailbox-standard',
    templateVersion:  '1.0.0',
    ...overrides,
  };
}

function createAddonsUnder(stack: Stack, scope: Construct, props: StackUpdateAddonProviderProps) {
  return new StackUpdateAddonProvider(props).createAdminApiAddons(scope, newAdminApiAddonContext(stack));
}

function lambdaEnvironment(template: Template, variables: Record<string, unknown>): void {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike(variables) },
  });
}

describe('StackUpdateAddonProvider', () => {
  it('returns one addon that reports stack updates as available', () => {
    const stack  = newTestStack('TestStack');
    const addons = createAddonsUnder(stack, stack, providerProps(stack));

    expect(addons).toHaveLength(1);
    expect(addons[0].uiConfig).toEqual({ stackUpdate: { available: true } });
  });

  it('creates the addon under the scope the Admin API passes it', () => {
    const stack = newTestStack('TestStack');
    const scope = new Construct(stack, 'admin-api-scope');

    createAddonsUnder(stack, scope, providerProps(stack));

    expect(scope.node.tryFindChild('stack-update-addon')).toBeDefined();
    expect(stack.node.tryFindChild('stack-update-addon')).toBeUndefined();
  });

  it('follows the release line of the dist-tag it is given', () => {
    const stack = newTestStack('TestStack');

    createAddonsUnder(stack, stack, providerProps(stack, { distTag: 'beta' }));

    lambdaEnvironment(Template.fromStack(stack), {
      POINTER_KEY: 'serverlessinbox/templates/mailbox-standard/releases/beta.json',
    });
  });

  it('reads the template it is given by name, and stores the template version it is given', () => {
    const stack = newTestStack('TestStack');

    createAddonsUnder(stack, stack, providerProps(stack, { templateName: 'mailbox-custom', templateVersion: '2.3.1' }));

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', { Value: '2.3.1' });
    lambdaEnvironment(template, {
      POINTER_KEY: 'serverlessinbox/templates/mailbox-custom/releases/stable.json',
    });
  });
});
