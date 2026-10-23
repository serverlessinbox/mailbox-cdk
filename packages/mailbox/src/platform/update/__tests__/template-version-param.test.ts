/**
 * Pins the SSM parameter `TemplateVersionParam` renders: the template version as its value, in the
 * standard tier. A different tier or value changes what the stack-update Lambda reads and what the
 * deployment is billed for.
 */

import { Template }                      from 'aws-cdk-lib/assertions';

import { newTestStack }                  from '../../__tests__/platform-helpers';
import { TemplateVersionParam }          from '../template-version-param';

describe('TemplateVersionParam', () => {
  it('stores the template version as the value of a standard-tier string parameter', () => {
    const stack = newTestStack('TestStack');

    new TemplateVersionParam(stack, 'template-version', { templateVersion: 'v0.0.53' });

    Template.fromStack(stack).hasResourceProperties('AWS::SSM::Parameter', {
      Type:  'String',
      Value: 'v0.0.53',
      Tier:  'Standard',
    });
  });
});
