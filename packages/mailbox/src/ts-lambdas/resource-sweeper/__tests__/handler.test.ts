import { starterHandler, workerHandler } from '../handler';

jest.mock('@aws-sdk/client-sfn');
jest.mock('@aws-sdk/client-acm');
jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('@aws-sdk/client-iam');

describe('ResourceSweeper handlers — smoke test wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:mailbox-sweeper';
  });

  afterEach(() => {
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
  });

  describe('starterHandler', () => {
    it('responds to smoke test probe without invoking the real handler', async () => {
      const probeEvent = { serverlessInboxSmokeTest: true };
      const result = await (starterHandler as any)(probeEvent, {});
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });

  describe('workerHandler', () => {
    it('responds to smoke test probe without invoking the real handler', async () => {
      const probeEvent = { serverlessInboxSmokeTest: true };
      const result = await (workerHandler as any)(probeEvent, {});
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });
});
