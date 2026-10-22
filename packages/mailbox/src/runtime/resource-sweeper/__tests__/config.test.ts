/**
 * Coverage for what the resource-sweeper configs add to the shared base config. The starter adds the state
 * machine ARN: if it were not mandatory, a starter without it would only fail when it tried to start a sweep.
 * Both add the region their AWS clients are built in: if it were not mandatory, a function without it would
 * build clients that fail on their first call instead of failing at the configuration.
 */

import { env, toRegion }           from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { loadStarter, loadWorker } from '../config';

const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';
const VARIABLES         = ['LOG_LEVEL', 'SERVICE_NAME', 'AWS_REGION', 'MAILBOX_SWEEPER_STATE_MACHINE_ARN'];

describe('resource-sweeper configs', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of VARIABLES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  it('loads the state machine ARN and the region alongside the base variables for the starter', () => {
    process.env.LOG_LEVEL                         = 'info';
    process.env.SERVICE_NAME                      = 'sweeper-service';
    process.env.AWS_REGION                        = 'eu-west-1';
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

    expect(env.tryLoad(loadStarter)).toEqual({
      config: {
        logLevel:               'info',
        serviceName:            'sweeper-service',
        region:                 toRegion('eu-west-1'),
        sweeperStateMachineArn: STATE_MACHINE_ARN,
      },
      error:  undefined,
    });
  });

  it('reports the state machine ARN as missing when it is not set', () => {
    process.env.SERVICE_NAME = 'sweeper-service';
    process.env.AWS_REGION   = 'eu-west-1';

    expect(env.tryLoad(loadStarter).error).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
  });

  it('loads the region alongside the base variables for the worker, which needs no state machine ARN', () => {
    process.env.SERVICE_NAME = 'sweeper-service';
    process.env.AWS_REGION   = 'eu-west-1';

    expect(env.tryLoad(loadWorker)).toEqual({
      config: { logLevel: 'error', serviceName: 'sweeper-service', region: toRegion('eu-west-1') },
      error:  undefined,
    });
  });

  it('reports the region as missing for the worker and the starter when it is not set', () => {
    process.env.SERVICE_NAME                      = 'sweeper-service';
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

    expect(env.tryLoad(loadWorker).error).toContain('AWS_REGION');
    expect(env.tryLoad(loadStarter).error).toContain('AWS_REGION');
  });
});
