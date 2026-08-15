/**
 * Stack Deployer Handler Tests
 *
 * Unit tests for handleCfn's ExecutionAlreadyExists handling:
 * - RUNNING execution: return without response (existing execution handles it)
 * - Terminal execution: retry with suffixed name (-r2, -r3, etc., up to -r5)
 * - Retry exhaustion: putCfnResponse with FAILED
 * - Delete + ExecutionAlreadyExists: putCfnResponse with SUCCESS (safety net)
 * - MANUAL_FINALIZE logging: emitted with stack, logical, type, requestId, responseUrl, curl hint
 */

import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import type { CfnCustomResourceEvent } from '../types';

const sfnMock = mockClient(SFNClient);

jest.mock('../cfn-response', () => ({
  putCfnResponse: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { putCfnResponse } = require('../cfn-response');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../handler');

describe('stack-deployer handler - ExecutionAlreadyExists handling', () => {
  beforeEach(() => {
    sfnMock.reset();
    jest.clearAllMocks();
    process.env.AWS_REGION = 'us-east-1';
    process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:MailboxDataDeployer-abc123';
    jest.spyOn(console, 'log').mockImplementation(() => {
      // Silent
    });
    jest.spyOn(console, 'error').mockImplementation(() => {
      // Silent
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {
      // Silent
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return without response when existing execution is RUNNING', async () => {
    const baseEvent: CfnCustomResourceEvent = {
      RequestType: 'Create',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid',
      RequestId: 'request-123',
      LogicalResourceId: 'MailboxDeployer',
      ResourceType: 'AWS::CloudFormation::CustomResource',
      ResourceProperties: {
        stackName: 'test-data-stack',
        templateUrl: 'https://example.com/template.json',
      },
    };

    const context = { logStreamName: '/aws/lambda/test' };

    // Mock StartExecution to throw ExecutionAlreadyExists
    sfnMock.on(StartExecutionCommand).rejects({
      name: 'ExecutionAlreadyExists',
      message: 'Execution already exists',
    });

    // Mock DescribeExecution to return RUNNING
    sfnMock.on(DescribeExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123',
      status: 'RUNNING',
    });

    await handler.starterHandler(baseEvent, context);

    // Should NOT call putCfnResponse because the existing execution will handle it
    expect(putCfnResponse).not.toHaveBeenCalled();
  });

  it('should retry with suffixed name when existing execution is terminal', async () => {
    const baseEvent: CfnCustomResourceEvent = {
      RequestType: 'Create',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid',
      RequestId: 'request-123',
      LogicalResourceId: 'MailboxDeployer',
      ResourceType: 'AWS::CloudFormation::CustomResource',
      ResourceProperties: {
        stackName: 'test-data-stack',
        templateUrl: 'https://example.com/template.json',
      },
    };

    const context = { logStreamName: '/aws/lambda/test' };

    sfnMock.on(StartExecutionCommand)
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      })
      .resolvesOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123-r2',
      });

    sfnMock.on(DescribeExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123',
      status: 'SUCCEEDED',
    });

    await handler.starterHandler(baseEvent, context);

    // Should NOT call putCfnResponse because retry succeeded and started a new execution
    expect(putCfnResponse).not.toHaveBeenCalled();

    // Verify StartExecution was called twice (original + retry with -r2)
    const calls = sfnMock.commandCalls(StartExecutionCommand);
    expect(calls.length).toBe(2);
  });

  it('should respond FAILED on retry exhaustion', async () => {
    const baseEvent: CfnCustomResourceEvent = {
      RequestType: 'Create',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid',
      RequestId: 'request-123',
      LogicalResourceId: 'MailboxDeployer',
      ResourceType: 'AWS::CloudFormation::CustomResource',
      ResourceProperties: {
        stackName: 'test-data-stack',
        templateUrl: 'https://example.com/template.json',
      },
    };

    const context = { logStreamName: '/aws/lambda/test' };

    sfnMock.on(StartExecutionCommand)
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      })
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      })
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      })
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      })
      .rejectsOnce({
        name: 'ExecutionAlreadyExists',
        message: 'Execution already exists',
      });

    sfnMock.on(DescribeExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123',
      status: 'FAILED',
    });

    await handler.starterHandler(baseEvent, context);

    // Should call putCfnResponse with FAILED status
    expect(putCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: expect.stringContaining('Could not start execution after 5 retries'),
      })
    );

    // Verify StartExecution was called 5 times (original + 4 retries: -r2, -r3, -r4, -r5)
    const calls = sfnMock.commandCalls(StartExecutionCommand);
    expect(calls.length).toBe(5);
  });

  it('should respond SUCCESS for Delete with ExecutionAlreadyExists', async () => {
    const baseEvent: CfnCustomResourceEvent = {
      RequestType: 'Delete',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid',
      RequestId: 'request-123',
      LogicalResourceId: 'MailboxDeployer',
      ResourceType: 'AWS::CloudFormation::CustomResource',
      ResourceProperties: {
        stackName: 'test-data-stack',
        templateUrl: 'https://example.com/template.json',
      },
    };

    const context = { logStreamName: '/aws/lambda/test' };

    sfnMock.on(StartExecutionCommand).rejects({
      name: 'ExecutionAlreadyExists',
      message: 'Execution already exists',
    });

    await handler.starterHandler(baseEvent, context);

    // Should call putCfnResponse with SUCCESS
    expect(putCfnResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        reason: expect.stringContaining('Delete already in progress'),
      })
    );
  });

  it('should emit MANUAL_FINALIZE logging marker', async () => {
    const baseEvent: CfnCustomResourceEvent = {
      RequestType: 'Create',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid',
      RequestId: 'request-123',
      LogicalResourceId: 'MailboxDeployer',
      ResourceType: 'AWS::CloudFormation::CustomResource',
      ResourceProperties: {
        stackName: 'test-data-stack',
        templateUrl: 'https://example.com/template.json',
      },
    };

    const context = { logStreamName: '/aws/lambda/test' };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    sfnMock.on(StartExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MailboxDataDeployer-abc123:request-123',
    });

    await handler.starterHandler(baseEvent, context);

    // Verify MANUAL_FINALIZE marker appears in logs
    const logs = consoleSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(logs).toContain('MANUAL_FINALIZE');
    expect(logs).toContain('stack=test-data-stack');
    expect(logs).toContain('logical=MailboxDeployer');
    expect(logs).toContain('type=Create');
    expect(logs).toContain('requestId=request-123');
    expect(logs).toContain('responseUrl=https://example.com/response');
    expect(logs).toContain('hint=curl');
  });
});
