import { errorMessage } from '../error-message';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('ENOENT: no such file'))).toBe('ENOENT: no such file');
  });

  it('returns the string form of a thrown value that is not an Error', () => {
    expect(errorMessage('plain failure')).toBe('plain failure');
  });
});
