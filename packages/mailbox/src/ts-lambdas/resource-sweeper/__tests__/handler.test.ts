import { starterHandler, workerHandler } from '../handler';

jest.mock('@aws-sdk/client-sfn');
jest.mock('@aws-sdk/client-acm');
jest.mock('@aws-sdk/client-lambda');

describe('ResourceSweeper handlers — smoke test wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
