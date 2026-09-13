/// <reference types="jest" />

/**
 * Unit tests for smoke test probe: invokeSmokeTest.
 *
 * Tests various invocation outcomes (pass, fail, unprobeable) by mocking LambdaClient.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  InvokeCommand,
} from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { invokeSmokeTest } from '../smoke-test';

describe('invokeSmokeTest', () => {
  const lambdaMock = mockClient(LambdaClient);
  const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test-lambda';

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
  });

  it('returns pass when response contains serverlessInboxSmokeTestOk: true', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: true }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('pass');
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
    expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({
      FunctionName: functionArn,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({ serverlessInboxSmokeTest: true }),
    });
  });

  it('returns fail when response contains serverlessInboxSmokeTestOk: false', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: false }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('fail');
  });

  it('returns fail when FunctionError is present (function crashed)', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      FunctionError: 'Unhandled',
      Payload: JSON.stringify({ errorMessage: 'process exited' }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('fail');
  });

  it('returns unprobeable when API-level error (AccessDenied) is thrown', async () => {
    const error = new Error('User: arn:aws:iam::123456789012:user/test is not authorized');
    error.name = 'AccessDenied';

    lambdaMock.on(InvokeCommand).rejects(error);

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when API-level error (ResourceNotFound) is thrown', async () => {
    const error = new Error('Function not found');
    error.name = 'ResourceNotFoundException';

    lambdaMock.on(InvokeCommand).rejects(error);

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when response payload is unparseable (malformed JSON)', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: '{ invalid json' as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when response payload is missing serverlessInboxSmokeTestOk field', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ someOtherField: 'data' }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when response payload is not an object', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify('not an object') as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when response Payload is null', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      // Payload intentionally missing
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('returns unprobeable when serverlessInboxSmokeTestOk has wrong type (string instead of boolean)', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: 'true' }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('unprobeable');
  });

  it('handles string Payload (alternative response format)', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: true }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    const verdict = await invokeSmokeTest(client, functionArn, logger);

    expect(verdict).toBe('pass');
  });

  it('passes the correct probe payload to InvokeCommand', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: true }) as any,
    });

    const logger = new LoggerBuffer();
    const client = new LambdaClient({ region: 'us-east-1' });
    await invokeSmokeTest(client, functionArn, logger);

    const invokeCall = lambdaMock.commandCalls(InvokeCommand)[0];
    const payload = JSON.parse(invokeCall.args[0].input.Payload as string);
    expect(payload).toEqual({ serverlessInboxSmokeTest: true });
  });
});
