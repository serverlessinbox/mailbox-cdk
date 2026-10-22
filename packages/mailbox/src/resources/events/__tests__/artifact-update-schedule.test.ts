import { Match, Template }                                from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                        from 'aws-cdk-lib/aws-lambda';
/// <reference types="jest" />
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';

import { ArtifactUpdateSchedule }                         from '../artifact-update-schedule';

describe('ArtifactUpdateSchedule', () => {
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new ArtifactUpdateSchedule(target, 'update-schedule', { target, interval: Duration.hours(3) });

    template = Template.fromStack(stack);
  });

  it('invokes the target at the given interval', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(3 hours)',
      State: 'ENABLED',
      Targets: [Match.objectLike({ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] } })],
    });
  });

  it('lets EventBridge invoke the target', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', { Action: 'lambda:InvokeFunction', Principal: 'events.amazonaws.com' });
  });
});
