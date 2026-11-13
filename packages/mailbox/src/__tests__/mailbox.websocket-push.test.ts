/// <reference types="jest" />

/**
 * Mailbox-level WebSocket push for the mail-import runner. The runner is built by the jobs section, and the Mailbox
 * points it at the endpoints' state-change fan-out once the endpoints exist. This synthesizes the full Mailbox and asserts the
 * runner function carries the state-change fan-out's name, so removing that wiring from the Mailbox turns this red.
 */

import { Template }                                      from 'aws-cdk-lib/assertions';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Mailbox }                                       from '../mailbox';

import { resourcesOfType }                               from './iam-test-helpers';
import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

interface FunctionProperties {
  readonly Environment: { readonly Variables: Record<string, unknown> };
}

describe('Mailbox mail-import runner WebSocket push', () => {
  it('gives the runner function the state-change fan-out name in its environment', () => {
    const app = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxWebSocketPush', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    const runners = resourcesOfType<FunctionProperties>(Template.fromStack(stack), 'AWS::Lambda::Function')
      .filter((properties) => 'IMPORT_MESSAGES_PER_SECOND' in properties.Environment.Variables);
    expect(runners).toHaveLength(1);
    expect(runners[0].Environment.Variables).toHaveProperty('WEBSOCKET_BROADCAST_FUNCTION_NAME');
  });

  it.each([
    ['user-api', 'MAIL_IMPORT_RUNNER_FUNCTION_NAME'],
    ['job-sweeper', 'JOB_STALE_AFTER'],
  ])('gives the %s function the state-change fan-out name in its environment', (_name, marker) => {
    const app = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxWebSocketPushNotice', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    const functions = resourcesOfType<FunctionProperties>(Template.fromStack(stack), 'AWS::Lambda::Function')
      .filter((properties) => marker in properties.Environment.Variables);
    expect(functions).toHaveLength(1);
    expect(functions[0].Environment.Variables).toHaveProperty('WEBSOCKET_BROADCAST_FUNCTION_NAME');
  });

  it('gives the state-change fan-out the item, config and token table names it reads', () => {
    const app = new App({
      context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
    });
    const stack = new cdk.Stack(app, 'TestMailboxStateChangeFanout', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new Mailbox(stack, 'mailbox', {
      authProvider: createMockAuthProvider(),
    });

    const fanouts = resourcesOfType<FunctionProperties>(Template.fromStack(stack), 'AWS::Lambda::Function')
      .filter((properties) => properties.Environment.Variables.SERVICE_NAME === 'state-change-fanout');
    expect(fanouts).toHaveLength(1);
    expect(fanouts[0].Environment.Variables).toHaveProperty('ITEM_TABLE_NAME');
    expect(fanouts[0].Environment.Variables).toHaveProperty('CONFIG_TABLE_NAME');
    expect(fanouts[0].Environment.Variables).toHaveProperty('PAT_TABLE_NAME');
  });
});
