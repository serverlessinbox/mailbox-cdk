import { CaughtError } from '../caught-error';

function sdkError(name: string, message: string, metadata?: { httpStatusCode?: number; requestId?: string }): Error {
  return Object.assign(new Error(message), { name, $metadata: metadata });
}

/**
 * Pins how a caught value is read as an SDK failure. Callers branch on the exception name to decide done,
 * retry or failed, and put the description in a result's reason, so a value that is not an `Error` must be
 * read as nameless rather than crash the catch, and the two descriptions must not drift.
 */
describe('CaughtError', () => {
  it('reads the name and message of a thrown Error', () => {
    const error = new CaughtError(sdkError('ResourceNotFoundException', 'not found'));

    expect(error.name).toBe('ResourceNotFoundException');
    expect(error.message).toBe('not found');
    expect(error.is('ResourceNotFoundException')).toBe(true);
    expect(error.is('NoSuchEntityException')).toBe(false);
  });

  it('treats a thrown value that is not an Error as nameless, even when it looks like one', () => {
    const lookalike = new CaughtError({ name: 'ResourceNotFoundException', message: 'not found' });
    const text = new CaughtError('just a string');

    expect(lookalike.name).toBeUndefined();
    expect(lookalike.is('ResourceNotFoundException')).toBe(false);
    expect(text.name).toBeUndefined();
    expect(text.message).toBeUndefined();
  });

  describe('messageIncludes', () => {
    it('finds text in the message of an Error', () => {
      expect(new CaughtError(sdkError('E', 'Stack does not exist')).messageIncludes('does not exist')).toBe(true);
      expect(new CaughtError(sdkError('E', 'other')).messageIncludes('does not exist')).toBe(false);
    });

    it('finds nothing in a value that is not an Error', () => {
      expect(new CaughtError('does not exist').messageIncludes('does not exist')).toBe(false);
    });
  });

  describe('describe', () => {
    it('is the name and message on one line', () => {
      expect(new CaughtError(sdkError('ResourceNotFoundException', 'not found', { requestId: 'req-1' })).describe()).toBe('ResourceNotFoundException: not found');
    });

    it('reads undefined: undefined for a value that is not an Error', () => {
      expect(new CaughtError('just a string').describe()).toBe('undefined: undefined');
    });
  });

  describe('describeWithMetadata', () => {
    it('adds the HTTP status and request id the SDK reported', () => {
      const error = new CaughtError(sdkError('ThrottlingException', 'Rate exceeded', { httpStatusCode: 400, requestId: 'req-1' }));

      expect(error.describeWithMetadata()).toBe('ThrottlingException: Rate exceeded (http=400 requestId=req-1)');
    });

    it('leaves out the metadata the SDK did not report', () => {
      expect(new CaughtError(sdkError('AccessDenied', 'no', { requestId: 'req-2' })).describeWithMetadata()).toBe('AccessDenied: no (requestId=req-2)');
      expect(new CaughtError(sdkError('AccessDenied', 'no', { httpStatusCode: 403 })).describeWithMetadata()).toBe('AccessDenied: no (http=403)');
      expect(new CaughtError(sdkError('AccessDenied', 'no')).describeWithMetadata()).toBe('AccessDenied: no');
    });

    it('describes a thrown string as an Error with that message', () => {
      expect(new CaughtError('boom').describeWithMetadata()).toBe('Error: boom');
    });

    it('names an Error without a name Error, and reads one without a message as its string form', () => {
      expect(new CaughtError(sdkError('', 'bad')).describeWithMetadata()).toBe('Error: bad');
      expect(new CaughtError(sdkError('Named', '')).describeWithMetadata()).toBe('Named: Named');
    });

    it('ignores metadata that is not shaped as the SDK reports it', () => {
      const error = Object.assign(new Error('x'), { $metadata: { httpStatusCode: 'abc', requestId: 7 } });

      expect(new CaughtError(error).describeWithMetadata()).toBe('Error: x');
    });
  });
});
