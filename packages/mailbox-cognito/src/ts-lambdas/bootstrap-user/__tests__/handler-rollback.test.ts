import { isParentStackRollingBack } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

// mailbox-cognito has no dependency on @aws-sdk/client-cloudformation (the boundary
// isParentStackRollingBack itself talks to), so — unlike the mailbox-cdk-shared
// handler suites, which mock CloudFormationClient directly — this suite mocks the
// helper function itself and lets everything else in the handler run for real.
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  ...jest.requireActual('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
  isParentStackRollingBack: jest.fn(),
}));

// Mock the HTTPS module before importing the handler (matches index.test.ts).
jest.mock('node:https');

// Import the handler after mocking, so its module-level `sendResponse` uses the mock.
import { handler } from '../index';

const mockIsParentStackRollingBack = isParentStackRollingBack as jest.MockedFunction<
  typeof isParentStackRollingBack
>;

describe('bootstrap-user handler rollback behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function baseEvent(overrides: Record<string, unknown> = {}) {
    return {
      RequestType: 'Update',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
      RequestId: 'unique-id',
      ResourceType: 'Custom::BootstrapUser',
      LogicalResourceId: 'BootstrapUserResource',
      // Missing userPoolId forces the handler's own validation to throw, driving it
      // into the rollback-suppression branch without any real Cognito call.
      ResourceProperties: {},
      PhysicalResourceId: 'physical-id',
      ...overrides,
    };
  }

  /**
   * Invokes the real handler and returns the parsed CFN response body sent via
   * the mocked `node:https` request's `write` call — mirrors index.test.ts.
   */
  async function invokeAndCaptureResponse(event: ReturnType<typeof baseEvent>): Promise<any> {
    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };

    // eslint-disable-next-line global-require
    const httpsModule = require('node:https');
    httpsModule.request.mockImplementation((_opts: any, callback: any) => {
      if (callback) {
        callback({ statusCode: 200, resume: jest.fn() });
      }
      return mockRequest;
    });

    // The handler re-throws after sending a FAILED response (so the Lambda invocation
    // itself is recorded as failed) — expected on every non-suppressed failure path.
    await (handler as any)(event, {}).catch(() => undefined);

    const writeCall = (mockRequest.write as jest.Mock).mock.calls[0];
    return JSON.parse(writeCall[0]);
  }

  describe('on Update with Cognito failure and parent rolling back', () => {
    it('sends SUCCESS response with the unchanged PhysicalResourceId', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with Cognito failure and parent not rolling back', () => {
    it('sends FAILED response when not rolling back', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(false);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('Missing required property: userPoolId');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with Cognito failure and DescribeStacks error', () => {
    it('treats as not rolling back and sends FAILED', async () => {
      // isParentStackRollingBack itself already swallows a DescribeStacks error into
      // `false` (see stack-rollback-detector.ts) — the handler sees exactly that.
      mockIsParentStackRollingBack.mockResolvedValue(false);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Create with failure and parent rolling back', () => {
    it('sends FAILED — rollback suppression only applies to Update', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      const event = baseEvent({ RequestType: 'Create', PhysicalResourceId: undefined });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      // Rollback suppression must never even consult the detector for a Create failure.
      expect(mockIsParentStackRollingBack).not.toHaveBeenCalled();
    });
  });
});
