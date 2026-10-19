import { sanitizeStackName } from '../sanitize-name';

/**
 * Pins the character rules of the stack-name slug: it feeds S3 bucket names, which reject uppercase
 * letters, underscores, doubled and edge hyphens.
 */
describe('sanitizeStackName', () => {
  it.each([
    ['lowercases', 'MyStack', 'mystack'],
    ['turns characters outside a-z0-9- into hyphens', 'my_stack.name', 'my-stack-name'],
    ['collapses hyphen runs', 'my--stack___name', 'my-stack-name'],
    ['drops leading and trailing hyphens', '--my-stack--', 'my-stack'],
  ])('%s', (_rule, input, expected) => {
    expect(sanitizeStackName(input)).toBe(expected);
  });
});
