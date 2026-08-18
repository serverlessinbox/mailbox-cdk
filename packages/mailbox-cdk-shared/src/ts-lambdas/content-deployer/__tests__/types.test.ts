import { isContentDeployerResourceProperties } from '../types';

describe('isContentDeployerResourceProperties', () => {
  describe('valid inputs', () => {
    it('should validate a data source with required fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'config.json',
            body: '{"version": 1}',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate a data source with optional fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'index.html',
            body: '<html></html>',
            contentType: 'text/html',
            cacheControl: 'max-age=3600',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate a zip source with required fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'zip',
            sourceBucket: 'artifacts-bucket',
            sourceKey: 'bundle.zip',
            targetPrefix: 'app/',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate a zip source with optional sourceVersionId', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'zip',
            sourceBucket: 'artifacts-bucket',
            sourceKey: 'bundle.zip',
            targetPrefix: 'app/',
            sourceVersionId: 'v123',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate properties with both targetBucket and invalidation fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'index.html',
            body: '<html></html>',
          },
        ],
        distributionId: 'E123ABC',
        invalidationPaths: ['/index.html', '/app/*'],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate with optional sources and invalidation fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        distributionId: 'E123ABC',
        invalidationPaths: ['/'],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

    it('should validate with multiple sources', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'config.json',
            body: '{"version": 1}',
          },
          {
            kind: 'zip',
            sourceBucket: 'artifacts-bucket',
            sourceKey: 'bundle.zip',
            targetPrefix: 'app/',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(true);
    });

  });

  describe('invalid inputs', () => {
    it('should reject non-object input', () => {
      expect(isContentDeployerResourceProperties('not-an-object')).toBe(false);
      expect(isContentDeployerResourceProperties(null)).toBe(false);
      expect(isContentDeployerResourceProperties(undefined)).toBe(false);
      expect(isContentDeployerResourceProperties(123)).toBe(false);
    });

    it('should reject if targetBucket is not a string', () => {
      const input = {
        targetBucket: 123,
        sources: [],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject if sources is not an array', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: 'not-an-array',
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject a data source with missing required fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'config.json',
            // missing: body
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject a data source with invalid body type', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'data',
            key: 'config.json',
            body: 123, // should be string
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject a zip source with missing required fields', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'zip',
            sourceBucket: 'artifacts-bucket',
            sourceKey: 'bundle.zip',
            // missing: targetPrefix
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject a zip source with invalid field type', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'zip',
            sourceBucket: 'artifacts-bucket',
            sourceKey: 'bundle.zip',
            targetPrefix: 123, // should be string
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject a source with invalid kind', () => {
      const input = {
        targetBucket: 'my-bucket',
        sources: [
          {
            kind: 'invalid',
            key: 'something',
          },
        ],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject if invalidationPaths is not an array of strings', () => {
      const input = {
        targetBucket: 'my-bucket',
        distributionId: 'E123ABC',
        invalidationPaths: ['/valid', 123], // contains non-string
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });

    it('should reject if distributionId is not a string', () => {
      const input = {
        targetBucket: 'my-bucket',
        distributionId: 123,
        invalidationPaths: ['/'],
      };
      expect(isContentDeployerResourceProperties(input)).toBe(false);
    });
  });
});
