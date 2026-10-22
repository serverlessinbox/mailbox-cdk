import { InvalidOwnInput } from '../invalid-own-input';

/**
 * Pins what the error of invalid input from our own components shows when a handler flushes: the failing
 * fields and the input that arrived, with nothing secret in it, because the message ends up in the log and in
 * the reason CloudFormation shows.
 */
describe('InvalidOwnInput', () => {
  it('names the subject and every failing field, then shows the input', () => {
    const failure = new InvalidOwnInput('Invalid ResourceProperties', ['.bucketName must be a string', '.sources must be an array'], { bucketName: 5 });

    expect(failure.message).toBe('Invalid ResourceProperties: .bucketName must be a string; .sources must be an array. Input: {"bucketName":5}');
    expect(failure.input).toEqual({ bucketName: 5 });
  });

  it('is a plain error, not an expected failure, named after itself', () => {
    const failure = new InvalidOwnInput('Invalid ResourceProperties', ['.x'], {});

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure.name).toBe('InvalidOwnInput');
  });

  it('redacts every value whose key looks secret, at any depth, in the message and in the input it carries', () => {
    const failure = new InvalidOwnInput('Invalid ResourceProperties', ['.userPoolId is missing'], {
      temporaryPassword: 'Sup3r-secret!',
      ResponseURL:       'https://example.com/signed?X-Amz-Signature=abc',
      nested:            { ServiceToken: 'arn:aws:lambda:x', clientSecret: 'shh', kept: 'visible' },
      list:              [{ apiToken: 'tok' }, 'plain'],
    });

    expect(failure.input).toEqual({
      temporaryPassword: '[redacted]',
      ResponseURL:       '[redacted]',
      nested:            { ServiceToken: '[redacted]', clientSecret: '[redacted]', kept: 'visible' },
      list:              [{ apiToken: '[redacted]' }, 'plain'],
    });
    expect(failure.message).not.toMatch(/Sup3r-secret|X-Amz-Signature|arn:aws:lambda:x|shh|tok"/);
    expect(failure.message).toContain('"kept":"visible"');
  });

  it('shows an input that is not an object as it is', () => {
    expect(new InvalidOwnInput('Invalid worker payload', ['must be an object'], 'oops').message).toBe('Invalid worker payload: must be an object. Input: "oops"');
  });
});
