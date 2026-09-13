import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('stack-deployer config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'deployer-service';
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        serviceName: 'deployer-service',
        stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
      },
      error: undefined,
    });
  });

  it('reports error when mandatory var missing', () => {
    const result = env.tryLoad(load);
    expect(result.error).toContain('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN');
  });

  it('uses defaults when all optionals absent', () => {
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
        stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
      },
      error: undefined,
    });
  });
});
