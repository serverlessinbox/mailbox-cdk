import * as handler from '../handler';
import * as cfnStack from '../cfn-stack';
import * as cfnResponse from '../cfn-response';
import { SfnInvokeEvent } from '../types';

jest.mock('../cfn-response');

// Mock only the I/O operations, not the status checking logic
jest.mock('../cfn-stack', () => ({
  ...jest.requireActual('../cfn-stack'),
  describeStack: jest.fn(),
  describeRecentFailureEvents: jest.fn(),
  makeCfClientFromOp: jest.fn(),
}));

const mockDescribeStack = cfnStack.describeStack as jest.MockedFunction<typeof cfnStack.describeStack>;
const mockDescribeRecentFailureEvents = cfnStack.describeRecentFailureEvents as jest.MockedFunction<typeof cfnStack.describeRecentFailureEvents>;
const mockMakeCfClientFromOp = cfnStack.makeCfClientFromOp as jest.MockedFunction<typeof cfnStack.makeCfClientFromOp>;
const mockPutCfnResponse = cfnResponse.putCfnResponse as jest.MockedFunction<typeof cfnResponse.putCfnResponse>;

describe('stack deployer handler - DELETE_* hard-fail on non-Delete operations', () => {
  const baseEvent: SfnInvokeEvent = {
    mode: 'check',
    cfn: {
      ResponseURL: 'https://example.com/cfn-response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc',
      RequestId: 'test-request-id',
      LogicalResourceId: 'TestResource',
    },
    op: {
      requestType: 'Create',
      stackName: 'test-stack',
      templateUrl: 'https://example.com/template.json',
    },
    attempt: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockMakeCfClientFromOp.mockReturnValue({} as any);
  });

  it('non-Delete check with DELETE_IN_PROGRESS should respond FAILED and done: true', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'DELETE_IN_PROGRESS',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([]);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        physicalResourceId: 'test-stack',
        reason: expect.stringMatching(/being deleted.*DELETE_IN_PROGRESS/s),
      })
    );
  });

  it('non-Delete check with DELETE_COMPLETE should respond FAILED', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'DELETE_COMPLETE',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([]);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        physicalResourceId: 'test-stack',
        reason: expect.stringContaining('being deleted'),
      })
    );
  });

  it('non-Delete check with DELETE_FAILED should respond FAILED', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'DELETE_FAILED',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([]);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringContaining('being deleted'),
      })
    );
  });

  it('non-Delete check with stack missing should respond FAILED "does not exist"', async () => {
    mockDescribeStack.mockResolvedValue(undefined);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringContaining('does not exist'),
      })
    );
  });

  it('non-Delete check at attempt >= MAX_POLL_ATTEMPTS with in-progress status should respond FAILED (cap fires)', async () => {
    const eventAtCap = { ...baseEvent, attempt: 135 };
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'CREATE_IN_PROGRESS',
      Outputs: [],
    });

    const result = await handler.workerHandler(eventAtCap, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringMatching(/did not reach a terminal state after 135 attempts.*CREATE_IN_PROGRESS/s),
      })
    );
  });

  it('non-Delete check at attempt >= MAX_POLL_ATTEMPTS + 1 should respond FAILED', async () => {
    const eventBeyondCap = { ...baseEvent, attempt: 136 };
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'UPDATE_IN_PROGRESS',
      Outputs: [],
    });

    const result = await handler.workerHandler(eventBeyondCap, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringContaining('did not reach a terminal state after 136 attempts'),
      })
    );
  });

  it('delete check at the cap should still respond SUCCESS (unchanged)', async () => {
    const deleteEvent: SfnInvokeEvent = {
      ...baseEvent,
      op: { ...baseEvent.op, requestType: 'Delete' },
      attempt: 135,
    };
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'DELETE_IN_PROGRESS',
      Outputs: [],
    });

    const result = await handler.workerHandler(deleteEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        reason: expect.stringContaining('deletion still in progress'),
      })
    );
  });

  it('non-Delete check with CREATE_COMPLETE should respond SUCCESS and done: true', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'CREATE_COMPLETE',
      Outputs: [{ OutputKey: 'TestKey', OutputValue: 'TestValue' }],
    });

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        data: { TestKey: 'TestValue' },
      })
    );
  });

  it('non-Delete check with UPDATE_IN_PROGRESS should return done: false (continue polling)', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'UPDATE_IN_PROGRESS',
      Outputs: [],
    });

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: false, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).not.toHaveBeenCalled();
  });

  it('non-Delete check with CREATE_FAILED should respond FAILED', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'CREATE_FAILED',
      StackStatusReason: 'Resource creation failed',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([]);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      })
    );
  });

  it('includes recent failure events in DELETE_* hard-fail response', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'DELETE_IN_PROGRESS',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'TestResource (AWS::S3::Bucket) CREATE_FAILED: Access Denied',
    ]);

    const result = await handler.workerHandler(baseEvent, {});

    expect(result).toEqual({ done: true, deleteRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringMatching(/Recent events:.*Access Denied/s),
      })
    );
  });
});
