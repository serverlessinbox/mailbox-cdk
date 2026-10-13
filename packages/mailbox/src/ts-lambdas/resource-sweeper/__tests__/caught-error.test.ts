/**
 * Coverage for `CaughtError`: the sweepers decide done / retry / failed on the AWS exception name of
 * whatever was thrown, so reading the name and message off an `Error` must work, and a thrown value
 * that is not an `Error` must be treated as a nameless failure rather than crash the handler's catch.
 */

import { CaughtError } from '../caught-error';

describe('CaughtError', () => {
  it('reads the name and message of a thrown Error', () => {
    const error = new CaughtError(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));

    expect(error.name).toBe('ResourceNotFoundException');
    expect(error.message).toBe('not found');
    expect(error.is('ResourceNotFoundException')).toBe(true);
    expect(error.is('NoSuchEntityException')).toBe(false);
    expect(error.describe()).toBe('ResourceNotFoundException: not found');
  });

  it('treats a thrown value that is not an Error as nameless', () => {
    const error = new CaughtError('just a string');

    expect(error.name).toBeUndefined();
    expect(error.message).toBeUndefined();
    expect(error.is('ResourceNotFoundException')).toBe(false);
  });
});
