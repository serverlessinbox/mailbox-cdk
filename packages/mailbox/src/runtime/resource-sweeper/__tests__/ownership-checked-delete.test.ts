/**
 * Coverage for `OwnershipCheckedDelete`, the sweep every removal shares. A resource is deleted only after its
 * ownership read found no mismatch: a sweep that deleted on a mismatch would destroy a resource of another
 * stack. A resource that is gone counts as swept, but only under the error name the resource declares; any
 * other error ends the sweep as the resource says, so a permanent error is not retried forever and a
 * transient one is not given up on.
 */

import { LoggerBuffer, type LogLevel }                from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as t                                         from 'typanion';

import { OwnershipCheckedDelete, type OwnedResource } from '../ownership-checked-delete';
import type { TargetResult }                          from '../removal';
import { TargetResults }                              from '../target-results';

const MISMATCH = 'Root stack mismatch (expected a, got b)';

/** The fields of the error-level line for an unexpected removal error. */
const isErrorLogFields = t.isObject({
  errorName:    t.isString(),
  errorMessage: t.isString(),
  stack:        t.isString(),
});

interface FakeResource extends OwnedResource {
  readonly findRootStackMismatch: jest.Mock<Promise<string | undefined>, []>;
  readonly deleteResource:        jest.Mock<Promise<TargetResult>, []>;
}

function resourceWith(overrides: Partial<FakeResource> = {}): FakeResource {
  return {
    label:                 'Widget',
    goneErrorName:         'ResourceNotFoundException',
    otherErrors:           'failed',
    findRootStackMismatch: jest.fn<Promise<string | undefined>, []>().mockResolvedValue(undefined),
    deleteResource:        jest.fn<Promise<TargetResult>, []>().mockResolvedValue({ target: 'cert', status: 'SUCCESS' }),
    ...overrides,
  };
}

function failureNamed(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function sweep(resource: OwnedResource, logLevel: LogLevel = 'error') {
  const sweeper = new OwnershipCheckedDelete(new TargetResults('cert'), new LoggerBuffer(undefined, logLevel));
  return sweeper.sweep(resource);
}

describe('OwnershipCheckedDelete', () => {
  let consoleError: jest.SpyInstance<void, [unknown?, ...unknown[]]>;
  let consoleWarn:  jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn  = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers what the delete answers when the root stack owns the resource', async () => {
    const retry    = { target: 'cert', status: 'RETRY', reason: 'in use' } as const;
    const resource = resourceWith({ deleteResource: jest.fn().mockResolvedValue(retry) });

    await expect(sweep(resource)).resolves.toEqual(retry);

    expect(resource.findRootStackMismatch).toHaveBeenCalledTimes(1);
    expect(resource.deleteResource).toHaveBeenCalledTimes(1);
  });

  it('fails with the mismatch reason and does not delete when another stack owns the resource', async () => {
    const resource = resourceWith({ findRootStackMismatch: jest.fn().mockResolvedValue(MISMATCH) });

    await expect(sweep(resource)).resolves.toEqual({ target: 'cert', status: 'FAILED', reason: MISMATCH });

    expect(resource.deleteResource).not.toHaveBeenCalled();
  });

  it.each([
    ['while reading its ownership', { findRootStackMismatch: jest.fn().mockRejectedValue(failureNamed('ResourceNotFoundException', 'gone')) }],
    ['while deleting it', { deleteResource: jest.fn().mockRejectedValue(failureNamed('ResourceNotFoundException', 'gone')) }],
  ])('counts the resource as swept when it is found gone %s', async (_when, overrides) => {
    await expect(sweep(resourceWith(overrides))).resolves.toEqual({ target: 'cert', status: 'SUCCESS' });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not take the gone error of another service for the declared one', async () => {
    const resource = resourceWith({
      goneErrorName:         'NoSuchEntityException',
      findRootStackMismatch: jest.fn().mockRejectedValue(failureNamed('ResourceNotFoundException', 'gone')),
    });

    await expect(sweep(resource)).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('fails, naming the error, and logs it at error level for a resource whose other errors fail', async () => {
    const resource = resourceWith({ deleteResource: jest.fn().mockRejectedValue(failureNamed('AccessDeniedException', 'denied')) });

    await expect(sweep(resource)).resolves.toEqual({ target: 'cert', status: 'FAILED', reason: 'AccessDeniedException: denied' });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const fields: unknown  = consoleError.mock.calls[0]?.[1];
    const errors: string[] = [];
    if (!isErrorLogFields(fields, { errors })) {
      throw new Error(`The error-level line does not carry its fields: ${errors.join('; ')}`);
    }
    expect(fields.errorName).toBe('AccessDeniedException');
    expect(fields.errorMessage).toBe('denied');
    expect(fields.stack).toMatch(/^AccessDeniedException: denied\n\s+at /);
  });

  it('retries, naming the error, and warns for a resource whose other errors retry', async () => {
    const resource = resourceWith({
      otherErrors:    'retry',
      deleteResource: jest.fn().mockRejectedValue(failureNamed('InvalidParameterValueException', 'still replicated')),
    });

    await expect(sweep(resource, 'warn')).resolves.toEqual({
      target: 'cert',
      status: 'RETRY',
      reason: 'InvalidParameterValueException: still replicated',
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      'Widget deletion error (will retry)',
      { errorName: 'InvalidParameterValueException', errorMessage: 'still replicated' },
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
