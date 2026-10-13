import * as env from '../../shared/env';
import { loadStarter } from '../config';

/**
 * Pins the one variable the starter config adds to the shared base: the state machine the starter runs. The
 * worker config adds nothing to the base and has no test.
 */
describe('stack-deployer starter config', () => {
  beforeEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
    process.env.SERVICE_NAME = 'deployer-service';
  });

  afterEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
    delete process.env.SERVICE_NAME;
  });

  it('reads the state machine ARN beside the shared base', () => {
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

    const result = env.tryLoad(loadStarter);

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({
      logLevel: 'error',
      serviceName: 'deployer-service',
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
    });
  });

  it('reports the state machine ARN as missing when it is not set', () => {
    const result = env.tryLoad(loadStarter);

    expect(result.error).toBe('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is not set');
  });
});
