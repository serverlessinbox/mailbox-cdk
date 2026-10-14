/**
 * Pins how the authorizer reads its configuration from the custom origin headers of the distribution's S3
 * origin. The CDN construct writes `x-auth-key-store-table`, `x-region` and `x-jwt-algorithms`; a function that
 * misread them would verify tokens against the wrong table, region or algorithms, or serve with none.
 */

import { extractConfig } from '../config';
import { AUTH_KEY_STORE_TABLE, originRequestOf } from './jmap-blob-download-helpers';

describe('extractConfig', () => {
  it('reads the table, region and algorithm list from the custom origin headers', () => {
    const request = originRequestOf({
      customHeaders: {
        'x-auth-key-store-table': AUTH_KEY_STORE_TABLE,
        'x-region': 'eu-central-1',
        'x-jwt-algorithms': 'RS256, ES256 ,,ES384',
      },
    });

    expect(extractConfig(request)).toEqual({
      authKeyStoreTable: AUTH_KEY_STORE_TABLE,
      region: 'eu-central-1',
      jwtAlgorithms: ['RS256', 'ES256', 'ES384'],
    });
  });

  it('defaults the region to us-east-1 and leaves the algorithm list unset when their headers are absent', () => {
    const request = originRequestOf({ customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE } });

    expect(extractConfig(request)).toEqual({
      authKeyStoreTable: AUTH_KEY_STORE_TABLE,
      region: 'us-east-1',
      jwtAlgorithms: undefined,
    });
  });

  it('defaults the region when its header is empty', () => {
    const request = originRequestOf({ customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': '' } });

    expect(extractConfig(request)?.region).toBe('us-east-1');
  });

  it('has no configuration without an auth key store table', () => {
    expect(extractConfig(originRequestOf({ customHeaders: { 'x-region': 'eu-west-1' } }))).toBeNull();
  });

  it('has no configuration without custom origin headers', () => {
    expect(extractConfig(originRequestOf({ customHeaders: null }))).toBeNull();
  });
});
