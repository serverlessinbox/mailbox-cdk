import type { CloudFormationCustomResourceUpdateEvent, Context } from 'aws-lambda';
import { isParentStackRollingBack } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

// wrapHandler uses https module, so mock it to capture responses
const mockSentResponseBodies: string[] = [];
jest.mock('https', () => ({
  ...jest.requireActual<typeof import('https')>('https'),
  request: (_options: unknown, onResponse: (res: { statusCode: number; headers: Record<string, string> }) => void) => {
    const chunks: string[] = [];
    return {
      on: () => undefined,
      write: (chunk: string) => {
        chunks.push(chunk);
      },
      end: () => {
        mockSentResponseBodies.push(chunks.join(''));
        onResponse({ statusCode: 200, headers: {} });
      },
    };
  },
}));

// mailbox-cognito has no dependency on @aws-sdk/client-cloudformation (the boundary
// isParentStackRollingBack itself talks to), so — unlike the mailbox-cdk-shared
// handler suites, which mock CloudFormationClient directly — this suite mocks the
// helper function itself and lets everything else in the handler run for real.
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  ...jest.requireActual('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
  isParentStackRollingBack: jest.fn(),
}));

// Import handler after mocking
import { handler } from '../index';

const mockIsParentStackRollingBack = isParentStackRollingBack as jest.MockedFunction<
  typeof isParentStackRollingBack
>;

const FUNCTION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:bootstrap-user';
const STACK_ID = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid';
const RESPONSE_URL = 'https://cloudformation-custom-resource-response.example.com/response';

const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'bootstrap-user',
  functionVersion: '$LATEST',
  invokedFunctionArn: FUNCTION_ARN,
  memoryLimitInMB: '256',
  awsRequestId: 'aws-request-id',
  logGroupName: '/aws/lambda/bootstrap-user',
  logStreamName: 'log-stream',
  getRemainingTimeInMillis: () => 60000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

function baseEvent(overrides: Record<string, unknown> = {}): CloudFormationCustomResourceUpdateEvent {
  return {
    RequestType: 'Update',
    ServiceToken: FUNCTION_ARN,
    ResponseURL: RESPONSE_URL,
    StackId: STACK_ID,
    RequestId: 'unique-id',
    ResourceType: 'Custom::BootstrapUser',
    LogicalResourceId: 'BootstrapUserResource',
    // Missing userPoolId forces the handler's own validation to throw, driving it
    // into the rollback-suppression branch without any real Cognito call.
    ResourceProperties: {
      ServiceToken: FUNCTION_ARN,
    },
    PhysicalResourceId: 'physical-id',
    OldResourceProperties: {
      ServiceToken: FUNCTION_ARN,
    },
    ...overrides,
  };
}

/**
 * Invokes the real handler and returns the parsed CFN response body sent via
 * the mocked https module — captures what wrapHandler sends.
 */
async function invokeAndCaptureResponse(event: CloudFormationCustomResourceUpdateEvent): Promise<any> {
  mockSentResponseBodies.length = 0;

  // The handler may throw after sending a FAILED response (wrapHandler catches it),
  // or may return after sending SUCCESS (for rollback suppression).
  await (handler as any)(event, context).catch(() => undefined);

  expect(mockSentResponseBodies).toHaveLength(1);
  return JSON.parse(mockSentResponseBodies[0]);
}

describe('bootstrap-user handler rollback behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('on Update with Cognito failure and parent rolling back', () => {
    it('sends SUCCESS response with the unchanged PhysicalResourceId', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });

    it('includes password marker in Data on rollback suppression', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('SUCCESS');
      expect(response.Data?.temporaryPassword).toBe('(password set at install time)');
    });
  });

  describe('on Update with Cognito failure and parent not rolling back', () => {
    it('sends FAILED response when not rolling back', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(false);

      const event = baseEvent({ RequestType: 'Update' });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('Invalid ResourceProperties');
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

      const event: any = baseEvent({ RequestType: 'Create', PhysicalResourceId: undefined });
      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      // Rollback suppression must never even consult the detector for a Create failure.
      expect(mockIsParentStackRollingBack).not.toHaveBeenCalled();
    });
  });
});
