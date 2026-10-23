/// <reference types="jest" />

/**
 * ArtifactUpdateSchedule: the rule that invokes the update function at the configured interval. The
 * schedule expression and the target are what the update cadence depends on.
 */

import { Match, Template }                                from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                        from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';

import { defaultCfnResource }                             from '../../../utils/cfn-resource';
import { ArtifactUpdateSchedule }                         from '../artifact-update-schedule';

describe('ArtifactUpdateSchedule', () => {
  let targetId: string;
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new ArtifactUpdateSchedule(target, 'update-schedule', { target, interval: Duration.hours(3) });

    targetId = stack.getLogicalId(defaultCfnResource(target));
    template = Template.fromStack(stack);
  });

  it('invokes the target at the given interval', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(3 hours)',
      State:              'ENABLED',
      Targets:            [Match.objectLike({ Arn: { 'Fn::GetAtt': [targetId, 'Arn'] } })],
    });
  });
});
