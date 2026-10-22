/**
 * Coverage for the handler file's wiring with a valid config: a Create or Update hands the request's
 * properties to the TableOverrideResolver and answers CloudFormation with its table ARNs; a Delete
 * answers SUCCESS without resolving anything.
 *
 * Flush: an unexpected error flushes the trace exactly once before it is answered, an
 * `ExpectedFailure` is answered without a flush, and a success never flushes. A handler that flushed
 * for an expected failure would write the trace of every rejected request; one that did not flush an
 * unexpected error would leave the bug without its trace.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

process.env['SERVICE_NAME'] = 'data-override-resolver';

import { ExpectedFailure, LoggerBuffer }                                                             from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { handler }                                                                                   from '../handler';
import { TableOverrideResolver, type ResolvedTableArns }                                             from '../table-override-resolver';

import { captureCfnResponse, createEvent, deleteEvent, lambdaContext, PROPERTIES_WITHOUT_OVERRIDES } from './data-override-resolver-helpers';

// wrapHandler PUTs the CFN response over real `https`; captureCfnResponse routes it into memory.
jest.mock('https', () => ({ request: jest.fn() }));

const RESOLVED: ResolvedTableArns = {
  configTableArn:       'arn:aws:dynamodb:eu-west-1:123456789012:table/config',
  itemTableArn:         'arn:aws:dynamodb:eu-west-1:123456789012:table/item',
  changelogTableArn:    'arn:aws:dynamodb:eu-west-1:123456789012:table/changelog',
  auditLogTableArn:     'arn:aws:dynamodb:eu-west-1:123456789012:table/auditlog',
  mailFeedbackTableArn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/mailfeedback',
};

describe('handler with a valid config', () => {
  let resolve: jest.SpyInstance;
  let flush: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    resolve = jest.spyOn(TableOverrideResolver.prototype, 'resolve').mockResolvedValue(RESOLVED);
    flush   = jest.spyOn(LoggerBuffer.prototype, 'flush');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands the request properties to the resolver and answers SUCCESS with its ARNs under the logical resource id', async () => {
    const cfnResponse = captureCfnResponse();

    await handler(createEvent(), lambdaContext());

    expect(resolve).toHaveBeenCalledWith(PROPERTIES_WITHOUT_OVERRIDES);
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'DataOverrideResolver', Data: RESOLVED });
    expect(flush).not.toHaveBeenCalled();
  });

  it('answers SUCCESS to a Delete without resolving any table', async () => {
    const cfnResponse = captureCfnResponse();

    await handler(deleteEvent(), lambdaContext());

    expect(resolve).not.toHaveBeenCalled();
    expect(cfnResponse().Status).toBe('SUCCESS');
  });

  it('flushes once and answers FAILED with the error when the resolver throws an unexpected error', async () => {
    resolve.mockRejectedValue(new Error('describe blew up'));
    const cfnResponse = captureCfnResponse();

    await handler(createEvent(), lambdaContext());

    expect(flush).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('describe blew up', { service: 'data-override-resolver' });
    expect(cfnResponse()).toMatchObject({ Status: 'FAILED', Reason: expect.stringContaining('describe blew up') });
  });

  it('answers FAILED with the reason and does not flush when the resolver throws an ExpectedFailure', async () => {
    resolve.mockRejectedValue(new ExpectedFailure('itemTable: override table x does not exist'));
    const cfnResponse = captureCfnResponse();

    await handler(createEvent(), lambdaContext());

    expect(flush).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('itemTable: override table x does not exist', { service: 'data-override-resolver' });
    expect(cfnResponse()).toMatchObject({ Status: 'FAILED', Reason: expect.stringContaining('itemTable: override table x does not exist') });
  });
});
