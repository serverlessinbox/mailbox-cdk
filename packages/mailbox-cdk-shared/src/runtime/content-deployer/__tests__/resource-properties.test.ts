/**
 * Pins which resource properties the content-deployer Lambda accepts. The Lambda rejects a request whose
 * properties are malformed, so the field types of every source kind are enforced here, while it must
 * tolerate the extra keys CloudFormation adds, such as `ServiceToken`.
 */

import type * as t                                from 'typanion';

import type { ContentDeployerResourceProperties } from '../resource-properties-contract';
import { isContentDeployerResourceProperties }    from '../resource-properties';

import { dataSource, zipSource }                  from './content-deployer-helpers';

type SchemaProperties = t.InferType<typeof isContentDeployerResourceProperties>;

const schemaToContract = (properties: SchemaProperties): ContentDeployerResourceProperties => properties;
const contractToSchema = (properties: ContentDeployerResourceProperties): SchemaProperties => properties;

describe('isContentDeployerResourceProperties', () => {
  it('accepts a contract object with every field of every source kind populated', () => {
    const fullProperties: ContentDeployerResourceProperties = {
      targetBucket:      'my-bucket',
      deploymentNonce:   'nonce',
      sources:           [
        { kind: 'data', key: 'config.json', body: '{}', contentType: 'application/json', cacheControl: 'no-store' },
        { kind: 'zip', sourceBucket: 'src-bucket', sourceKey: 'app.zip', targetPrefix: 'app/', sourceVersionId: 'v1' },
      ],
      distributionId:    'E123ABC',
      invalidationPaths: ['/index.html'],
    };

    expect(isContentDeployerResourceProperties(contractToSchema(fullProperties))).toBe(true);
    expect(schemaToContract(fullProperties)).toBe(fullProperties);
  });

  describe('accepts', () => {
    it.each([
      ['a data source with only its required fields', { targetBucket: 'my-bucket', sources: [dataSource()] }],
      [
        'a data source with its optional fields',
        { targetBucket: 'my-bucket', sources: [dataSource({ contentType: 'text/html', cacheControl: 'no-store' })] },
      ],
      ['a zip source with only its required fields', { targetBucket: 'my-bucket', sources: [zipSource()] }],
      [
        'a zip source with a source version',
        { targetBucket: 'my-bucket', sources: [zipSource({ sourceVersionId: 'v123' })] },
      ],
      ['several sources of different kinds', { targetBucket: 'my-bucket', sources: [dataSource(), zipSource()] }],
      [
        'an invalidation without sources',
        { distributionId: 'E123ABC', invalidationPaths: ['/index.html', '/app/*'], deploymentNonce: 'nonce' },
      ],
      ['no properties at all', {}],
      ['the extra keys CloudFormation adds', { targetBucket: 'my-bucket', ServiceToken: 'arn:aws:lambda:x' }],
      [
        'extra keys inside a source',
        { sources: [dataSource({ addedLater: true }), zipSource({ addedLater: true })] },
      ],
    ])('%s', (_title, properties) => {
      expect(isContentDeployerResourceProperties(properties)).toBe(true);
    });
  });

  describe('rejects', () => {
    it.each([
      ['a string', 'not-an-object'],
      ['null', null],
      ['a number', 123],
    ])('%s instead of an object', (_title, value) => {
      expect(isContentDeployerResourceProperties(value)).toBe(false);
    });

    it.each([
      ['a targetBucket that is not a string', { targetBucket: 123 }],
      ['a deploymentNonce that is not a string', { deploymentNonce: 123 }],
      ['sources that are not an array', { sources: 'not-an-array' }],
      ['a distributionId that is not a string', { distributionId: 123 }],
      ['invalidationPaths with a non-string entry', { invalidationPaths: ['/valid', 123] }],
      ['a data-shaped source of an unknown kind', { sources: [dataSource({ kind: 'invalid' })] }],
      ['a zip-shaped source of an unknown kind', { sources: [zipSource({ kind: 'invalid' })] }],
      ['a data source without a key', { sources: [{ kind: 'data', body: 'x' }] }],
      ['a data source without a body', { sources: [{ kind: 'data', key: 'config.json' }] }],
      ['a data source whose body is not a string', { sources: [dataSource({ body: 123 })] }],
      ['a data source whose contentType is not a string', { sources: [dataSource({ contentType: 123 })] }],
      ['a data source whose cacheControl is not a string', { sources: [dataSource({ cacheControl: 123 })] }],
      ['a zip source without a sourceBucket', { sources: [{ kind: 'zip', sourceKey: 'a.zip', targetPrefix: 'p/' }] }],
      ['a zip source without a sourceKey', { sources: [{ kind: 'zip', sourceBucket: 'b', targetPrefix: 'p/' }] }],
      ['a zip source without a targetPrefix', { sources: [{ kind: 'zip', sourceBucket: 'b', sourceKey: 'a.zip' }] }],
      ['a zip source whose targetPrefix is not a string', { sources: [zipSource({ targetPrefix: 123 })] }],
      ['a zip source whose sourceVersionId is not a string', { sources: [zipSource({ sourceVersionId: 123 })] }],
    ])('%s', (_title, properties) => {
      expect(isContentDeployerResourceProperties(properties)).toBe(false);
    });
  });
});
