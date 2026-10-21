/**
 * Coverage for what the resource-sweeper starter config adds to the shared base config: the state machine
 * ARN. If it were not mandatory, a starter without it would only fail when it tried to start a sweep.
 */

import { env }         from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { loadStarter } from '../config';

const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

describe('resource-sweeper starter config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
  });

  it('loads the state machine ARN alongside the base variables', () => {
    process.env.LOG_LEVEL                         = 'info';
    process.env.SERVICE_NAME                      = 'sweeper-service';
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

    expect(env.tryLoad(loadStarter)).toEqual({
      config: { logLevel: 'info', serviceName: 'sweeper-service', sweeperStateMachineArn: STATE_MACHINE_ARN },
      error: undefined,
    });
  });

  it('reports the state machine ARN as missing when it is not set', () => {
    process.env.SERVICE_NAME = 'sweeper-service';

    expect(env.tryLoad(loadStarter).error).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
  });
});
