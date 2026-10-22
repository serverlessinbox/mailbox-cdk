/// <reference types="jest" />
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                   from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }      from 'aws-cdk-lib';

import { StackDeployedEvent }                        from '../stack-deployed-event';

describe('StackDeployedEvent', () => {
  let template: Template;

  beforeEach(() => {
    const stack  = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    new StackDeployedEvent(target, 'stack-deployed', { target });

    template = Template.fromStack(stack);
  });

  it('matches the status changes to CREATE_COMPLETE and UPDATE_COMPLETE of the stack that contains it', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.cloudformation'],
        'detail-type': ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [{ Ref: 'AWS::StackId' }],
          'status-details': { status: ['CREATE_COMPLETE', 'UPDATE_COMPLETE'] },
        },
      },
      State: 'ENABLED',
    });
  });

  it('invokes the target', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^target'), 'Arn'] }, Id: 'Target0' }],
    });
    template.resourceCountIs('AWS::Lambda::Permission', 1);
  });
});
