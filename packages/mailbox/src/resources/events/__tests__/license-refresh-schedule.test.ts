/// <reference types="jest" />
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                   from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }      from 'aws-cdk-lib';

import { LicenseRefreshSchedule }                    from '../license-refresh-schedule';

describe('LicenseRefreshSchedule', () => {
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new LicenseRefreshSchedule(target, 'refresh-schedule', { target, hour: '13', minute: '47' });

    template = Template.fromStack(stack);
  });

  it('invokes the target once a day at the given minute and hour', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(47 13 * * ? *)',
      State: 'ENABLED',
      Targets: [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] }, Id: 'Target0' }],
    });
    template.resourceCountIs('AWS::Lambda::Permission', 1);
  });
});
