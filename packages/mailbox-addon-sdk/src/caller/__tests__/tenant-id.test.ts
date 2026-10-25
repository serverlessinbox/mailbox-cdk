import { toTenantId } from '../tenant-id';

describe('toTenantId', () => {
  it('makes a tenant id of a value', () => {
    expect(toTenantId('tenant-1')).toBe('tenant-1');
  });

  it('refuses an empty value', () => {
    expect(() => toTenantId('')).toThrow('tenant id is empty');
  });
});
