/// <reference types="jest" />

/**
 * JobSweepSchedule tests: the rule that invokes the sweeper at the interval it is given, read from the synthesized
 * rule and its target.
 */

import { Template }                                                 from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime }                from 'aws-cdk-lib/aws-lambda';
import * as cdk                                                     from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration }                  from 'aws-cdk-lib';

import { JobSweepSchedule }                                         from '../job-sweep-schedule';

function arrangeSchedule(interval: Duration) {
  const stack  = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const target = new LambdaFunction(stack, 'sweeper', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code:    Code.fromInline('exports.handler = async () => undefined;'),
  });
  new JobSweepSchedule(stack, 'sweep-schedule', { target, interval });

  return { stack, template: Template.fromStack(stack), target };
}

describe('JobSweepSchedule', () => {
  it('invokes its target at the rate of the interval it is given', () => {
    const { template } = arrangeSchedule(Duration.minutes(15));

    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' });
  });

  it('targets the function it is given', () => {
    const { stack, template, target } = arrangeSchedule(Duration.minutes(15));
    const targetArn: unknown          = stack.resolve(target.functionArn);

    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Arn: targetArn }],
    });
  });
});
