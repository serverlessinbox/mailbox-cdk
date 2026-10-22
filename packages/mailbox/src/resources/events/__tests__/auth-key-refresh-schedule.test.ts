/// <reference types="jest" />
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                   from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }      from 'aws-cdk-lib';

import { AuthKeyRefreshSchedule }                    from '../auth-key-refresh-schedule';

describe('AuthKeyRefreshSchedule', () => {
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new AuthKeyRefreshSchedule(target, 'refresh-schedule', { target });

    template = Template.fromStack(stack);
  });

  it('invokes the target every 6 hours', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(6 hours)',
      State: 'ENABLED',
      Targets: [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] }, Id: 'Target0' }],
    });
    template.resourceCountIs('AWS::Lambda::Permission', 1);
  });
});
