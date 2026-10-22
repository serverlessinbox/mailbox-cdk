/**
 * Coverage for the handler file's wiring with a valid config: the starter hands a custom-resource
 * request to its `SweepStarter` and answers CloudFormation, and the worker hands a removal payload
 * to its `SweepWorker`.
 *
 * Each starter invocation must get its own logger: a `LoggerBuffer` keeps its unflushed entries for
 * its whole life, so one shared by warm invocations would flush an earlier request's trace when a
 * later request fails.
 *
 * Flush: an unexpected error flushes the trace exactly once before it is answered, an
 * `ExpectedFailure` is answered without a flush, and a success never flushes. A handler that flushed
 * for an expected failure would write the trace of every rejected request; one that did not flush an
 * unexpected error would leave the bug without its trace.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

const STATE_MACHINE_ARN                          = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';
process.env['SERVICE_NAME']                      = 'resource-sweeper';
process.env['AWS_REGION']                        = 'us-west-2';
process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = STATE_MACHINE_ARN;

import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand }     from '@aws-sdk/client-sfn';
import { ExpectedFailure, LoggerBuffer }                               from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                  from 'aws-sdk-client-mock';

import { starterHandler, workerHandler }                               from '../handler';
import { SweepStarter }                                                from '../sweep-starter';
import { SweepWorker }                                                 from '../sweep-worker';

import { captureCfnResponse, createEvent, lambdaContext, updateEvent } from './sweep-helpers';

// wrapHandler PUTs the CFN response over real `https`; captureCfnResponse routes it into memory.
jest.mock('https', () => ({ request: jest.fn() }));

const sfnMock = mockClient(SFNClient);
const acmMock = mockClient(ACMClient);

describe('starterHandler with a valid config', () => {
  it('hands the request to the SweepStarter and answers SUCCESS with the removal resource id', async () => {
    sfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    const cfnResponse = captureCfnResponse();

    await starterHandler(updateEvent(), lambdaContext());

    expect(sfnMock.commandCalls(StartExecutionCommand)[0].args[0].input.stateMachineArn).toBe(STATE_MACHINE_ARN);
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'mailbox-deferred-removal' });
  });
});

describe('starterHandler logger scope', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not carry one request\'s trace into the next: a failing request flushes only its own', async () => {
    sfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    captureCfnResponse();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleDebug           = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const eventWithoutProperties = createEvent();
    Reflect.deleteProperty(eventWithoutProperties, 'ResourceProperties');

    await starterHandler(updateEvent(), lambdaContext());
    expect(consoleDebug).not.toHaveBeenCalled();

    await starterHandler(eventWithoutProperties, lambdaContext());

    const invocationStarts = consoleDebug.mock.calls.filter(([message]) => message === 'Starter invoked');
    expect(invocationStarts).toHaveLength(1);
  });
});

describe('workerHandler with a valid config', () => {
  it('hands the removal payload to the SweepWorker and returns its output', async () => {
    acmMock.reset();
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'test-stack' }],
    });
    acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
    acmMock.on(DeleteCertificateCommand).resolves({});

    const output = await workerHandler({
      removalType:   'cert',
      certArn:       'arn:aws:acm:us-east-1:123456789012:certificate/test',
      rootStackName: 'test-stack',
      rootStackId:   'guid-1',
    });

    expect(output).toEqual({ status: 'SUCCESS' });
    expect(acmMock.commandCalls(DeleteCertificateCommand)).toHaveLength(1);
  });
});

const CERT_PAYLOAD = {
  removalType:   'cert',
  certArn:       'arn:aws:acm:us-east-1:123456789012:certificate/test',
  rootStackName: 'test-stack',
  rootStackId:   'guid-1',
} as const;

describe('handler flush', () => {
  let flush: jest.SpyInstance;

  beforeEach(() => {
    sfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    acmMock.reset();
    acmMock.on(ListTagsForCertificateCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'test-stack' }],
    });
    acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
    acmMock.on(DeleteCertificateCommand).resolves({});
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    flush = jest.spyOn(LoggerBuffer.prototype, 'flush');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('starterHandler', () => {
    it('flushes once and answers FAILED with the error when the starter throws an unexpected error', async () => {
      jest.spyOn(SweepStarter.prototype, 'handle').mockRejectedValue(new Error('planner blew up'));
      const cfnResponse = captureCfnResponse();

      await starterHandler(updateEvent(), lambdaContext());

      expect(flush).toHaveBeenCalledTimes(1);
      const response = cfnResponse();
      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('planner blew up');
    });

    it('answers FAILED with the reason and does not flush when the starter throws an ExpectedFailure', async () => {
      jest.spyOn(SweepStarter.prototype, 'handle').mockRejectedValue(new ExpectedFailure('request rejected on purpose'));
      const cfnResponse = captureCfnResponse();

      await starterHandler(updateEvent(), lambdaContext());

      expect(flush).not.toHaveBeenCalled();
      const response = cfnResponse();
      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('request rejected on purpose');
    });

    it('does not flush when the request succeeds', async () => {
      const cfnResponse = captureCfnResponse();

      await starterHandler(updateEvent(), lambdaContext());

      expect(flush).not.toHaveBeenCalled();
      expect(cfnResponse().Status).toBe('SUCCESS');
    });
  });

  describe('workerHandler', () => {
    it('flushes once and rethrows the same error when the worker throws an unexpected error', async () => {
      const failure = new Error('sweeper blew up');
      jest.spyOn(SweepWorker.prototype, 'handle').mockRejectedValue(failure);

      await expect(workerHandler(CERT_PAYLOAD)).rejects.toBe(failure);

      expect(flush).toHaveBeenCalledTimes(1);
    });

    it('rethrows the same ExpectedFailure without a flush', async () => {
      const failure = new ExpectedFailure('sweep refused');
      jest.spyOn(SweepWorker.prototype, 'handle').mockRejectedValue(failure);

      await expect(workerHandler(CERT_PAYLOAD)).rejects.toBe(failure);

      expect(flush).not.toHaveBeenCalled();
    });

    it('does not flush when the sweep succeeds', async () => {
      await expect(workerHandler(CERT_PAYLOAD)).resolves.toEqual({ status: 'SUCCESS' });

      expect(flush).not.toHaveBeenCalled();
    });
  });
});
