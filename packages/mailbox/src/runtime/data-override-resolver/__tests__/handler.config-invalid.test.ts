/**
 * Coverage for the handler file when the config is invalid (an unrecognised LOG_LEVEL): a Create must
 * answer FAILED naming the variable instead of killing the process before CloudFormation gets a
 * response, which would hold the stack for the custom resource's whole service timeout, and it must
 * not resolve any table with a half-valid config. A Delete answers SUCCESS: a stack left in
 * DELETE_FAILED cannot be updated, so its config could never be fixed.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

process.env['SERVICE_NAME'] = 'data-override-resolver';
process.env['LOG_LEVEL']    = 'verbose';

import { handler }                                                     from '../handler';
import { TableOverrideResolver }                                       from '../table-override-resolver';

import { captureCfnResponse, createEvent, deleteEvent, lambdaContext } from './data-override-resolver-helpers';

jest.mock('https', () => ({ request: jest.fn() }));

describe('handler with an invalid config', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers a Create with FAILED naming the invalid variable, without resolving any table', async () => {
    const resolve = jest.spyOn(TableOverrideResolver.prototype, 'resolve');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const cfnResponse = captureCfnResponse();

    await handler(createEvent(), lambdaContext());

    expect(resolve).not.toHaveBeenCalled();
    const response = cfnResponse();
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('LOG_LEVEL');
  });

  it('answers a Delete with SUCCESS, so a stack that cannot be updated can still be deleted', async () => {
    const resolve = jest.spyOn(TableOverrideResolver.prototype, 'resolve');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const cfnResponse = captureCfnResponse();

    await handler(deleteEvent(), lambdaContext());

    expect(resolve).not.toHaveBeenCalled();
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'DataOverrideResolver' });
  });
});
