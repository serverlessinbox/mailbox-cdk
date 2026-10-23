/// <reference types="jest" />

/**
 * Pipeline log group regression guard: synthesizes the full Mailbox construct and asserts every
 * Lambda function's LoggingConfig resolves to one of the pipeline log groups, no such group name
 * begins with `aws/`, and each carries the support-scoping tag.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';
import * as t                                            from 'typanion';

import { Mailbox }                                       from '../mailbox';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';
import { isTemplateValue, resourcesOfType }              from './template-resources';

const isLogGroupProperties = t.isPartial({
  LogGroupName: t.isOptional(t.isOneOf([
    t.isString(),
    t.isPartial({ 'Fn::Join': t.isTuple([t.isString(), t.isArray(isTemplateValue)]) }),
  ])),
  Tags:         t.isOptional(t.isArray(t.isPartial({ Key: t.isString(), Value: t.isOptional(isTemplateValue) }))),
});

const isFunctionProperties = t.isPartial({
  LoggingConfig: t.isOptional(t.isPartial({
    LogGroup: t.isOptional(t.isPartial({ Ref: t.isString() })),
  })),
});

describe('Mailbox stack pipeline log groups', () => {
  function synth() {
    const app   = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxPipelineLogGroups', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    return Template.fromStack(stack);
  }

  it('every Lambda function resolves to one of the pipeline log groups', () => {
    const template    = synth();
    const logGroupIds = new Set(resourcesOfType(template, 'AWS::Logs::LogGroup', isLogGroupProperties).map((group) => group.logicalId));
    const functions   = resourcesOfType(template, 'AWS::Lambda::Function', isFunctionProperties);
    expect(functions.length).toBeGreaterThan(5);

    for (const functionResource of functions) {
      expect(logGroupIds.has(String(functionResource.properties.LoggingConfig?.LogGroup?.Ref))).toBe(true);
    }
  });

  it('no synthesized log group name begins with "aws/"', () => {
    const groups = resourcesOfType(synth(), 'AWS::Logs::LogGroup', isLogGroupProperties);

    for (const group of groups) {
      // The name is built via Fn::Join from literal parts; the first part is the literal prefix.
      const name         = group.properties.LogGroupName;
      const firstLiteral = typeof name === 'string' ? name : name?.['Fn::Join'][1][0];
      expect(String(firstLiteral).startsWith('aws/')).toBe(false);
    }
  });

  it('each pipeline log group carries the serverless-inbox:root-stack tag', () => {
    const pipelineGroups = resourcesOfType(synth(), 'AWS::Logs::LogGroup', isLogGroupProperties)
      .filter((group) => group.logicalId.toLowerCase().includes('loggroup'));

    expect(pipelineGroups.length).toBeGreaterThan(0);

    for (const group of pipelineGroups) {
      const hasRootStackTag = (group.properties.Tags ?? []).some((tag) => tag.Key === 'serverless-inbox:root-stack');
      expect(hasRootStackTag).toBe(true);
    }
  });

});
