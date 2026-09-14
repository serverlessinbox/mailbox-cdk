// Set env vars before importing the handler (which loads config at module scope)
process.env['MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';

import * as handler from '../handler';
import * as cfnStack from '../cfn-stack';
import * as cfnResponse from '../cfn-response';
import { SfnInvokeEvent } from '../types';

jest.mock('../cfn-response');
jest.mock('@aws-sdk/client-sfn');

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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
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

    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringMatching(/Recent events:.*Access Denied/s),
      })
    );
  });
});

describe('stack deployer handler - root stack name length validation', () => {
  const baseCfnEvent = {
    RequestType: 'Create' as const,
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123',
    RequestId: 'test-request-id-123',
    LogicalResourceId: 'StackDeployer',
    ResourceType: 'AWS::CloudFormation::CustomResource',
    ResourceProperties: {
      stackName: 'edge-stack',
      templateUrl: 'https://example.com/template.json',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';
  });

  afterEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  it('Create request with too-long root stack name should respond FAILED and not call StartExecutionCommand', async () => {
    // Stack name exceeds 24 chars (25 chars here: "this-is-a-very-long-names")
    const longNameEvent = {
      ...baseCfnEvent,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/this-is-a-very-long-names/abc123',
    };

    await handler.starterHandler(longNameEvent, {});

    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringMatching(/exceeds maximum length.*24.*CloudFormation truncates/),
      })
    );

    // Verify StartExecutionCommand was NOT called
    const sfnModule = require('@aws-sdk/client-sfn');
    expect(sfnModule.SFNClient.prototype.send).not.toHaveBeenCalled();
  });

  it('Create request with valid-length root stack name should call StartExecutionCommand', async () => {
    const validNameEvent = {
      ...baseCfnEvent,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/valid-short-name/abc123',
    };

    // Mock the SFN client send method
    const sfnModule = require('@aws-sdk/client-sfn');
    sfnModule.SFNClient.prototype.send = jest.fn().mockResolvedValue({});

    await handler.starterHandler(validNameEvent, {});

    expect(mockPutCfnResponse).not.toHaveBeenCalled();
    expect(sfnModule.SFNClient.prototype.send).toHaveBeenCalled();
  });

  it('Update request with too-long root stack name should NOT be blocked', async () => {
    const updateEvent = {
      ...baseCfnEvent,
      RequestType: 'Update' as const,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/this-is-a-very-long-names/abc123',
    };

    // Mock the SFN client send method
    const sfnModule = require('@aws-sdk/client-sfn');
    sfnModule.SFNClient.prototype.send = jest.fn().mockResolvedValue({});

    await handler.starterHandler(updateEvent, {});

    // Should NOT respond with FAILED due to name length
    if (mockPutCfnResponse.mock.calls.length > 0) {
      expect(mockPutCfnResponse).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          reason: expect.stringMatching(/exceeds maximum length/),
        })
      );
    }

    // Should proceed to StartExecutionCommand
    expect(sfnModule.SFNClient.prototype.send).toHaveBeenCalled();
  });

  it('Delete request with too-long root stack name should NOT be blocked', async () => {
    const deleteEvent = {
      ...baseCfnEvent,
      RequestType: 'Delete' as const,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/this-is-a-very-long-names/abc123',
    };

    // Mock the SFN client send method
    const sfnModule = require('@aws-sdk/client-sfn');
    sfnModule.SFNClient.prototype.send = jest.fn().mockResolvedValue({});

    await handler.starterHandler(deleteEvent, {});

    // Should NOT respond with FAILED due to name length
    if (mockPutCfnResponse.mock.calls.length > 0) {
      expect(mockPutCfnResponse).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          reason: expect.stringMatching(/exceeds maximum length/),
        })
      );
    }

    // Should proceed to StartExecutionCommand
    expect(sfnModule.SFNClient.prototype.send).toHaveBeenCalled();
  });

  it('Create request at exactly the max length (24 chars) should be allowed', async () => {
    // "exactly-twenty-four-char" is exactly 24 characters
    const maxLengthEvent = {
      ...baseCfnEvent,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/exactly-twenty-four-char/abc123',
    };

    // Mock the SFN client send method
    const sfnModule = require('@aws-sdk/client-sfn');
    sfnModule.SFNClient.prototype.send = jest.fn().mockResolvedValue({});

    await handler.starterHandler(maxLengthEvent, {});

    // Should NOT respond with FAILED
    expect(mockPutCfnResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringMatching(/exceeds maximum length/),
      })
    );

    // Should proceed to StartExecutionCommand
    expect(sfnModule.SFNClient.prototype.send).toHaveBeenCalled();
  });
});

describe('stack deployer handler - KMS transient-error retry (Create operations)', () => {
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

  it('(a) ROLLBACK_IN_PROGRESS + matching KMS signature + Create: wait for rollback (no delete/recreate)', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_IN_PROGRESS',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: KMS validation error: com.amazonaws.services.kms.model.NotFoundException: Key does not exist',
    ]);

    const result = await handler.workerHandler(baseEvent, {});

    // Should return done: false (continue polling) without calling putCfnResponse
    expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 0 });
    expect(mockPutCfnResponse).not.toHaveBeenCalled();
  });

  it('(b) ROLLBACK_COMPLETE + matching KMS signature + budget remaining: recreate and increment count', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_COMPLETE',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'ItemTable (AWS::DynamoDB::Table) CREATE_FAILED: KMS NotFoundException when validating alias/aws/dynamodb',
    ]);

    const baseEventWithCreateCount = {
      ...baseEvent,
      createRetryCount: 0,
    };

    const result = await handler.workerHandler(baseEventWithCreateCount as SfnInvokeEvent, {});

    // Should return done: false with incremented createRetryCount
    expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 1 });
    expect(mockPutCfnResponse).not.toHaveBeenCalled();
  });

  it('(c) Budget exhausted (createRetryCount=3): falls through to FAILED path', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_COMPLETE',
      StackStatusReason: 'The following resource(s) failed to create: [DynamoDBTable]',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: KMS validation error: NotFoundException',
    ]);

    const baseEventWithMaxRetries = {
      ...baseEvent,
      createRetryCount: 3,
    };

    const result = await handler.workerHandler(baseEventWithMaxRetries as SfnInvokeEvent, {});

    // Should respond FAILED (createRetryCount exhausted)
    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 3 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      })
    );
  });

  it('(d) Non-matching KMS signature: falls through to FAILED path (regression guard)', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'CREATE_FAILED',
      StackStatusReason: 'The following resource(s) failed to create: [S3Bucket]',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'S3Bucket (AWS::S3::Bucket) CREATE_FAILED: Access Denied',
    ]);

    const result = await handler.workerHandler(baseEvent, {});

    // Should respond FAILED immediately (no KMS signature match)
    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      })
    );
  });

  it('(e) requestType=Update: new branches never fire (unchanged FAILED path)', async () => {
    const updateEvent: SfnInvokeEvent = {
      ...baseEvent,
      op: {
        ...baseEvent.op,
        requestType: 'Update',
      },
    };

    mockDescribeStack.mockResolvedValue({
      StackStatus: 'UPDATE_FAILED',
      StackStatusReason: 'The following resource(s) failed to update: [DynamoDBTable]',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'DynamoDBTable (AWS::DynamoDB::Table) UPDATE_FAILED: KMS NotFoundException',
    ]);

    const result = await handler.workerHandler(updateEvent, {});

    // Should respond FAILED immediately (Update request, not Create)
    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      })
    );
  });

  it('ROLLBACK_FAILED + matching KMS signature + budget remaining: should also trigger recreate', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_FAILED',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'ItemTable (AWS::DynamoDB::Table) CREATE_FAILED: KMS validation error: NotFoundException for alias/aws/dynamodb',
    ]);

    const baseEventWithRetryCount = {
      ...baseEvent,
      createRetryCount: 1,
    };

    const result = await handler.workerHandler(baseEventWithRetryCount as SfnInvokeEvent, {});

    // Should return done: false with incremented createRetryCount
    expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 2 });
    expect(mockPutCfnResponse).not.toHaveBeenCalled();
  });

  it('ROLLBACK_COMPLETE + matching KMS signature at retry budget boundary (createRetryCount=2): should recreate', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_COMPLETE',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'Table (AWS::DynamoDB::Table) CREATE_FAILED: KMS NotFoundException',
    ]);

    const baseEventAtBoundary = {
      ...baseEvent,
      createRetryCount: 2, // Still within budget (< 3)
    };

    const result = await handler.workerHandler(baseEventAtBoundary as SfnInvokeEvent, {});

    // Should return done: false with incremented createRetryCount (now 3)
    expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 3 });
    expect(mockPutCfnResponse).not.toHaveBeenCalled();
  });

  it('ROLLBACK_COMPLETE + matching KMS signature exceeding budget: should NOT retry', async () => {
    mockDescribeStack.mockResolvedValue({
      StackStatus: 'ROLLBACK_COMPLETE',
      StackStatusReason: 'Failed to create stack',
      Outputs: [],
    });
    mockDescribeRecentFailureEvents.mockResolvedValue([
      'DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: KMS NotFoundException',
    ]);

    const baseEventOverBudget = {
      ...baseEvent,
      createRetryCount: 3, // At budget limit
    };

    const result = await handler.workerHandler(baseEventOverBudget as SfnInvokeEvent, {});

    // Should respond FAILED (budget exhausted)
    expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 3 });
    expect(mockPutCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      })
    );
  });
});

describe('stack deployer handlers — smoke test wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';
  });

  afterEach(() => {
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  describe('starterHandler', () => {
    it('responds to smoke test probe without invoking the CFN handler', async () => {
      const probeEvent = { serverlessInboxSmokeTest: true };

      const result = await (handler.starterHandler as any)(probeEvent, {});

      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
      expect(mockPutCfnResponse).not.toHaveBeenCalled();
    });
  });

  describe('workerHandler', () => {
    it('responds to smoke test probe without invoking the SFN handler', async () => {
      const probeEvent = { serverlessInboxSmokeTest: true };

      const result = await (handler.workerHandler as any)(probeEvent, {});

      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });
});

describe('stack deployer handlers — config error handling', () => {
  const baseCfnEvent = {
    RequestType: 'Create' as const,
    ResponseURL: 'https://example.com/cfn-response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/abc123',
    RequestId: 'test-request-id-123',
    LogicalResourceId: 'StackDeployer',
    ResourceType: 'AWS::CloudFormation::CustomResource',
    ResourceProperties: {
      stackName: 'test-edge-stack',
      templateUrl: 'https://example.com/template.json',
    },
  };

  const baseSfnEvent: SfnInvokeEvent = {
    mode: 'start',
    cfn: {
      ResponseURL: 'https://example.com/cfn-response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc',
      RequestId: 'test-request-id',
      LogicalResourceId: 'TestResource',
    },
    op: {
      requestType: 'Create',
      stackName: 'test-sfn-stack',
      templateUrl: 'https://example.com/template.json',
    },
  };

  describe('starterHandler with bad config', () => {
    it('Create event with bad LOG_LEVEL should send FAILED response', async () => {
      jest.isolateModules(() => {
        process.env.LOG_LEVEL = 'verbose'; // Invalid log level
        process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        // Re-require the handler to reload with bad config
        const handlerModule = require('../handler');

        return handlerModule.starterHandler(baseCfnEvent, {}).then(() => {
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'FAILED',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });

    it('Delete event with bad LOG_LEVEL should send SUCCESS response', async () => {
      jest.isolateModules(() => {
        process.env.LOG_LEVEL = 'verbose'; // Invalid log level
        process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        const handlerModule = require('../handler');

        return handlerModule.starterHandler(
          { ...baseCfnEvent, RequestType: 'Delete' },
          {}
        ).then(() => {
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'SUCCESS',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });

    it('Create event with missing MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN should send FAILED response', async () => {
      jest.isolateModules(() => {
        delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN; // Missing required var

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        const handlerModule = require('../handler');

        return handlerModule.starterHandler(baseCfnEvent, {}).then(() => {
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'FAILED',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });

    it('Delete event with missing MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN should send SUCCESS response', async () => {
      jest.isolateModules(() => {
        delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN; // Missing required var

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        const handlerModule = require('../handler');

        return handlerModule.starterHandler(
          { ...baseCfnEvent, RequestType: 'Delete' },
          {}
        ).then(() => {
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'SUCCESS',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });
  });

  describe('workerHandler with bad config', () => {
    it('Create event with bad LOG_LEVEL should send FAILED response and return done: true', async () => {
      jest.isolateModules(() => {
        process.env.LOG_LEVEL = 'verbose'; // Invalid log level
        process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        const handlerModule = require('../handler');

        return handlerModule.workerHandler(baseSfnEvent, {}).then((result: any) => {
          expect(result).toEqual({ done: true });
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'FAILED',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });

    it('Delete event with bad LOG_LEVEL should send SUCCESS response and return done: true', async () => {
      jest.isolateModules(() => {
        process.env.LOG_LEVEL = 'verbose'; // Invalid log level
        process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';

        jest.clearAllMocks();
        const cfnResponse = require('../cfn-response');
        cfnResponse.putCfnResponse.mockResolvedValue(undefined);

        const handlerModule = require('../handler');

        return handlerModule.workerHandler(
          { ...baseSfnEvent, op: { ...baseSfnEvent.op, requestType: 'Delete' } },
          {}
        ).then((result: any) => {
          expect(result).toEqual({ done: true });
          expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'SUCCESS',
              reason: expect.stringContaining('Configuration error'),
            })
          );
        });
      });
    });

    // Regression coverage for the 2026-09-13 incident: the worker's CDK wrapper
    // (stack-deployer-worker.ts) never sets MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN — only the
    // starter's wrapper does. The worker must load successfully without it. Before the fix (a
    // single shared Config with stateMachineArn mandatory for both handlers), this environment
    // made every worker invocation respond with "Configuration error" and never reach real work.
    it('handles a check event normally with MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN absent (the worker Lambda\'s real environment)', async () => {
      jest.resetModules();
      delete process.env.LOG_LEVEL; // earlier tests in this describe leave 'verbose' set
      delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN; // never set on the worker
      process.env.SERVICE_NAME = 'stack-deployer-worker';

      jest.clearAllMocks();
      const cfnResponse = require('../cfn-response');
      cfnResponse.putCfnResponse.mockResolvedValue(undefined);
      const cfnStack = require('../cfn-stack');
      cfnStack.makeCfClientFromOp.mockReturnValue({} as any);
      cfnStack.describeStack.mockResolvedValue({
        StackStatus: 'CREATE_COMPLETE',
        Outputs: [],
      });
      cfnStack.describeRecentFailureEvents.mockResolvedValue([]);

      const handlerModule = require('../handler');

      const checkEvent = { ...baseSfnEvent, mode: 'check' as const };
      const result = await handlerModule.workerHandler(checkEvent, {});

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(cfnResponse.putCfnResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS' }),
      );
      expect(cfnResponse.putCfnResponse).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('Configuration error') }),
      );

      delete process.env.SERVICE_NAME;
      process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';
    });

    it('workerHandler smoke test probe succeeds with MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN absent', async () => {
      jest.resetModules();
      delete process.env.LOG_LEVEL; // earlier tests in this describe leave 'verbose' set
      delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN; // never set on the worker
      process.env.SERVICE_NAME = 'stack-deployer-worker';

      const handlerModule = require('../handler');

      const result = await handlerModule.workerHandler({ serverlessInboxSmokeTest: true }, {});
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });

      delete process.env.SERVICE_NAME;
      process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:stack-deployer';
    });
  });

});
