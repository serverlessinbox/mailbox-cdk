/**
 * Pins how the authorizer reads its configuration from the custom origin headers of the distribution's S3
 * origin. The CDN construct writes `x-auth-key-store-table`, `x-region` and `x-jwt-algorithms`; a function that
 * misread them would verify tokens against the wrong table, region or algorithms, or serve with none. Each
 * header that is missing or invalid must be named in the rejection, without its value, because the rejection
 * is what an operator reads to find the broken distribution setting; a default for the region would hide it.
 */

import { extractConfig }                         from '../config';

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
      config: {
        authKeyStoreTable: AUTH_KEY_STORE_TABLE,
        region: 'eu-central-1',
        jwtAlgorithms: ['RS256', 'ES256', 'ES384'],
      },
    });
  });

  it('leaves the algorithm list unset when its header is absent', () => {
    const request = originRequestOf({ customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': 'us-gov-east-1' } });

    expect(extractConfig(request)).toEqual({
      config: { authKeyStoreTable: AUTH_KEY_STORE_TABLE, region: 'us-gov-east-1', jwtAlgorithms: undefined },
    });
  });

  it('names the missing custom origin headers', () => {
    expect(extractConfig(originRequestOf({ customHeaders: null }))).toEqual({
      problem: 'the custom origin headers of the S3 origin are missing',
    });
  });

  it.each([
    ['absent', { 'x-region': 'eu-west-1' }],
    ['empty', { 'x-auth-key-store-table': '', 'x-region': 'eu-west-1' }],
  ])('names x-auth-key-store-table when it is %s', (_name, customHeaders) => {
    expect(extractConfig(originRequestOf({ customHeaders }))).toEqual({
      problem: 'header x-auth-key-store-table is missing or empty',
    });
  });

  it.each([
    ['absent', { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE }],
    ['empty', { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': '' }],
  ])('names x-region when it is %s, and does not default it', (_name, customHeaders) => {
    expect(extractConfig(originRequestOf({ customHeaders }))).toEqual({
      problem: 'header x-region is missing or empty',
    });
  });

  it.each(['EU-WEST-1', 'eu-west', 'eu_west_1', 'eu-west-1; drop', 'not a region'])(
    'names x-region, without its value, when it is the malformed %j',
    (region) => {
      const reading = extractConfig(originRequestOf({ customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': region } }));

      expect(reading).toEqual({ problem: 'header x-region is not an AWS region code' });
    },
  );

  it.each(['PS256', 'RS256,none', ' , '])('names x-jwt-algorithms, without its value, when it is %j', (algorithms) => {
    const reading = extractConfig(originRequestOf({
      customHeaders: { 'x-auth-key-store-table': AUTH_KEY_STORE_TABLE, 'x-region': 'eu-west-1', 'x-jwt-algorithms': algorithms },
    }));

    expect(reading).toEqual({ problem: 'header x-jwt-algorithms is not a comma-separated list of supported algorithms' });
  });
});
