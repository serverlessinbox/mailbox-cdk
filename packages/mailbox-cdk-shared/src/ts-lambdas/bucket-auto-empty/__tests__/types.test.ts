import { isBucketAutoEmptyResourceProperties } from '../types';

describe('isBucketAutoEmptyResourceProperties', () => {
  describe('valid inputs', () => {
    it('should validate with a bucketName string', () => {
      const input = {
        bucketName: 'my-bucket',
      };
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(true);
    });

    it('should validate with undefined bucketName', () => {
      const input = {};
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(true);
    });

    it('should allow extra properties', () => {
      const input = {
        bucketName: 'my-bucket',
        extraProp: 'ignored',
      };
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('should reject non-object input', () => {
      expect(isBucketAutoEmptyResourceProperties('not-an-object')).toBe(false);
      expect(isBucketAutoEmptyResourceProperties(null)).toBe(false);
      expect(isBucketAutoEmptyResourceProperties(undefined)).toBe(false);
      expect(isBucketAutoEmptyResourceProperties(123)).toBe(false);
    });

    it('should reject if bucketName is not a string', () => {
      const input = {
        bucketName: 123,
      };
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(false);
    });

    it('should reject if bucketName is an array', () => {
      const input = {
        bucketName: ['bucket'],
      };
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(false);
    });

    it('should reject if bucketName is an object', () => {
      const input = {
        bucketName: { name: 'bucket' },
      };
      expect(isBucketAutoEmptyResourceProperties(input)).toBe(false);
    });
  });
});
