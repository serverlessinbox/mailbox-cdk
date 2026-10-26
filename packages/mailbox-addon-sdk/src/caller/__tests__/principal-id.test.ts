import { toPrincipalId } from '../principal-id';

describe('toPrincipalId', () => {
  it('makes a principal id of a value', () => {
    expect(toPrincipalId('principal-1')).toBe('principal-1');
  });

  it('refuses an empty value', () => {
    expect(() => toPrincipalId('')).toThrow('principal id is empty');
  });
});
