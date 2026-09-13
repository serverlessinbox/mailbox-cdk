import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('resource-sweeper config', () => {
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

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'sweeper-service';
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        serviceName: 'sweeper-service',
        sweeperStateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
      },
      error: undefined,
    });
  });

  it('reports error when mandatory var missing', () => {
    const result = env.tryLoad(load);
    expect(result.error).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
  });

  it('uses defaults when all optionals absent', () => {
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
        sweeperStateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
      },
      error: undefined,
    });
  });
});
