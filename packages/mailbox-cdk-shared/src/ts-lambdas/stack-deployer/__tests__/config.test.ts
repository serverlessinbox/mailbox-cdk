import * as env from '../../shared/env';
import { loadStarter, loadWorker } from '../config';

/**
 * Pins the variables each config adds to the shared base: the state machine the starter runs, and the region
 * each function runs in, which the runtime injects. A missing region must be reported, because a function that
 * guessed one would read and run stack operations in a region the stack does not live in.
 */
describe('stack-deployer worker config', () => {
  beforeEach(() => {
    delete process.env.AWS_REGION;
    process.env.SERVICE_NAME = 'deployer-service';
  });

  afterEach(() => {
    delete process.env.AWS_REGION;
    delete process.env.SERVICE_NAME;
  });

  it('reads the region beside the shared base', () => {
    process.env.AWS_REGION = 'eu-west-1';

    const result = env.tryLoad(loadWorker);

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({ logLevel: 'error', serviceName: 'deployer-service', region: 'eu-west-1' });
  });

  it('reports the region as missing when it is not set', () => {
    const result = env.tryLoad(loadWorker);

    expect(result.error).toBe('AWS_REGION is not set');
  });
});

describe('stack-deployer starter config', () => {
  beforeEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
    process.env.AWS_REGION = 'eu-west-1';
    process.env.SERVICE_NAME = 'deployer-service';
  });

  afterEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
    delete process.env.AWS_REGION;
    delete process.env.SERVICE_NAME;
  });

  it('reads the state machine ARN and the region beside the shared base', () => {
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

    const result = env.tryLoad(loadStarter);

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({
      logLevel: 'error',
      serviceName: 'deployer-service',
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
      region: 'eu-west-1',
    });
  });

  it('reports the state machine ARN as missing when it is not set', () => {
    const result = env.tryLoad(loadStarter);

    expect(result.error).toBe('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN is not set');
  });

  it('reports the region as missing when it is not set', () => {
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';
    delete process.env.AWS_REGION;

    const result = env.tryLoad(loadStarter);

    expect(result.error).toBe('AWS_REGION is not set');
  });
});
