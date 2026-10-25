import { createValidator } from '../validation';

/* Pins the order of createValidator: parse first, then the extra check on what parse returned. */

describe('createValidator', () => {
  it('answers the parsed value', () => {
    const validate = createValidator((req) => ({ wrapped: req }));

    expect(validate('body')).toEqual({ wrapped: 'body' });
  });

  it('runs the check on the parsed value and still answers it', () => {
    const check    = jest.fn<void, [{ wrapped: unknown }]>();
    const validate = createValidator((req) => ({ wrapped: req }), check);

    const value = validate('body');

    expect(check).toHaveBeenCalledWith({ wrapped: 'body' });
    expect(value).toEqual({ wrapped: 'body' });
  });

  it('lets a failing check reject the body', () => {
    const validate = createValidator((req) => req, () => {
      throw new Error('check failed');
    });

    expect(() => validate('body')).toThrow('check failed');
  });

  it('does not run the check when parsing fails', () => {
    const check    = jest.fn<void, [unknown]>();
    const validate = createValidator(() => {
      throw new Error('parse failed');
    }, check);

    expect(() => validate('body')).toThrow('parse failed');
    expect(check).not.toHaveBeenCalled();
  });
});
