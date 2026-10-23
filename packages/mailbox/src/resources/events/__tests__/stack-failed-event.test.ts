/// <reference types="jest" />

/**
 * StackFailedEvent: the rule that reports a failed or rolled-back stack. It matches only this stack's
 * terminal statuses, and the rule and the target's invoke permission are retained on every operation,
 * because the target must still exist after a failed create to report that rollback.
 */

import { Match, Template }                          from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime }                  from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack }     from 'aws-cdk-lib';

import { StackFailedEvent }                         from '../stack-failed-event';

const RETAINED = { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' };

describe('StackFailedEvent', () => {
  let stack: Stack;
  let event: StackFailedEvent;
  let template: Template;

  beforeEach(() => {
    stack        = new Stack(new App(), 'TestStack', { synthesizer: new BootstraplessSynthesizer() });
    const target = new Function(stack, 'target', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });

    event    = new StackFailedEvent(target, 'stack-failed', { target });
    template = Template.fromStack(stack);
  });

  it('matches the five terminal stack statuses of this stack only', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source:        ['aws.cloudformation'],
        'detail-type': ['CloudFormation Stack Status Change'],
        detail:        {
          'stack-id':       [{ Ref: 'AWS::StackId' }],
          'status-details': {
            status: Match.arrayEquals(['ROLLBACK_COMPLETE', 'ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_FAILED', 'DELETE_FAILED']),
          },
        },
      },
    });
  });

  it('invokes the target under the id it exposes as ruleTargetId', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Id: event.ruleTargetId, Arn: Match.anyValue() }],
    });
  });

  it('retains the rule and the target\'s invoke permission on every operation', () => {
    expect(Object.values(template.findResources('AWS::Events::Rule'))).toEqual([expect.objectContaining(RETAINED)]);
    expect(Object.values(template.findResources('AWS::Lambda::Permission'))).toEqual([expect.objectContaining(RETAINED)]);
  });
});
