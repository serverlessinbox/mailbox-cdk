jest.mock('@aws-sdk/client-sfn');
jest.mock('@aws-sdk/client-acm');
jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('@aws-sdk/client-iam');
jest.mock('../targets/cert', () => ({
  sweepCert: jest.fn().mockResolvedValue({ status: 'done', target: 'cert' }),
}));

// The handler loads its config at module scope, so the env must be set before it is imported.
process.env['SERVICE_NAME'] = 'resource-sweeper';
process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123456789012:stateMachine:mailbox-sweeper';

import { starterHandler, workerHandler } from '../handler';

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

describe('ResourceSweeper workerHandler — MAILBOX_SWEEPER_STATE_MACHINE_ARN absent (regression, 2026-09-13)', () => {
  // The worker's CDK wrapper (resource-sweeper-worker.ts) never sets
  // MAILBOX_SWEEPER_STATE_MACHINE_ARN — only the starter's wrapper does. The worker must load
  // and run successfully without it. Before the fix (a single shared Config with
  // sweeperStateMachineArn mandatory for both handlers), this environment made every worker
  // invocation throw "Configuration error" and never reach real work.
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
    process.env.SERVICE_NAME = 'resource-sweeper-worker';
  });

  afterEach(() => {
    delete process.env.SERVICE_NAME;
  });

  it('smoke test probe succeeds', async () => {
    const handlerModule = require('../handler');
    const result = await handlerModule.workerHandler({ serverlessInboxSmokeTest: true }, {});
    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('a real cert-removal invocation succeeds and never reports a Configuration error', async () => {
    const handlerModule = require('../handler');

    const result = await handlerModule.workerHandler({
      removalType: 'cert',
      certArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
      rootStackName: 'test-stack',
    });

    expect(result).toEqual({ status: 'SUCCESS' });
  });
});
