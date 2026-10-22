/**
 * Pins which JWTs the authorizer accepts: a token is accepted only when its signature verifies against the key
 * its issuer published in the auth key store, with an algorithm the distribution allows, inside its time
 * window and naming a subject. Every check here is the only thing between an attacker's token and a blob, so a
 * test per rejection keeps a loosened check from passing unnoticed. Tokens are signed with real keys; only the
 * auth key store is faked.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient }                     from 'aws-sdk-client-mock';
import * as crypto                        from 'crypto';

import { AUTH_KEY_STORE_TABLE }           from '../../__tests__/jmap-blob-download-helpers';
import type { SupportedAlgorithm }        from '../../cloudfront/origin-headers';
import { JwtVerifier }                    from '../jwt-verifier';

const ISSUER = 'https://idp.example.com/pool';
const KID    = 'kid-1';

interface SigningKey {
  readonly privateKey: crypto.KeyObject;
  readonly jwk:        crypto.JsonWebKey;
}

interface AlgorithmCase {
  readonly alg:        SupportedAlgorithm;
  readonly signingKey: SigningKey;
}

function rsaSigningKey(): SigningKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

function ecSigningKey(namedCurve: 'P-256' | 'P-384'): SigningKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

const RSA_KEY       = rsaSigningKey();
const ES256_KEY     = ecSigningKey('P-256');
const ES384_KEY     = ecSigningKey('P-384');
const OTHER_RSA_KEY = rsaSigningKey();

const SIGNATURE_DIGEST: Record<string, string> = {
  RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES256: 'sha256', ES384: 'sha384',
};

interface JwtOptions {
  readonly alg?:      string;
  readonly signWith?: SigningKey;
  readonly header?:   Record<string, unknown>;
  readonly payload?:  Record<string, unknown>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function jwtOf(options: JwtOptions = {}): string {
  const alg          = options.alg ?? 'RS256';
  const header       = { alg, kid: KID, ...options.header };
  const payload      = { iss: ISSUER, sub: 'user-1', client_id: 'client-1', exp: nowSeconds() + 3600, ...options.payload };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signWith     = options.signWith ?? RSA_KEY;
  const signature    = alg.startsWith('ES')
    ? crypto.sign(SIGNATURE_DIGEST[alg], Buffer.from(signingInput), { key: signWith.privateKey, dsaEncoding: 'ieee-p1363' })
    : alg === 'PS256'
      ? crypto.sign('sha256', Buffer.from(signingInput), { key: signWith.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
      : crypto.sign(SIGNATURE_DIGEST[alg] ?? 'sha256', Buffer.from(signingInput), signWith.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

describe('JwtVerifier', () => {
  const dynamodb = mockClient(DynamoDBClient);
  let verifier: JwtVerifier;

  function issuerPublishes(keys: unknown[], issuer: string = ISSUER): void {
    dynamodb
      .on(GetItemCommand, { TableName: AUTH_KEY_STORE_TABLE, Key: { pk: { S: 'jwks' }, sk: { S: issuer } } })
      .resolves({ Item: { jwks: { S: JSON.stringify({ keys }) } } });
  }

  function verify(token: string, allowedAlgorithms?: readonly SupportedAlgorithm[]): Promise<unknown> {
    return verifier.verifySignatureOnly(token, AUTH_KEY_STORE_TABLE, allowedAlgorithms);
  }

  beforeEach(() => {
    dynamodb.reset();
    verifier = new JwtVerifier(new DynamoDBClient({}));
    issuerPublishes([{ ...RSA_KEY.jwk, kid: KID }]);
  });

  describe('accepted tokens', () => {
    it('returns the subject, the issuer and the client id of an RS256 token with a valid signature', async () => {
      await expect(verify(jwtOf())).resolves.toEqual({ sub: 'user-1', issuer: ISSUER, audience: 'client-1' });
    });

    it.each<AlgorithmCase>([
      { alg: 'RS384', signingKey: RSA_KEY },
      { alg: 'RS512', signingKey: RSA_KEY },
      { alg: 'ES256', signingKey: ES256_KEY },
      { alg: 'ES384', signingKey: ES384_KEY },
    ])('accepts a $alg token when the distribution allows the algorithm', async ({ alg, signingKey }) => {
      issuerPublishes([{ ...signingKey.jwk, kid: KID }]);

      await expect(verify(jwtOf({ alg, signWith: signingKey }), [alg])).resolves.toMatchObject({ sub: 'user-1' });
    });

    it('returns the issuer without its trailing slashes, and looks up the key of that issuer', async () => {
      const token = jwtOf({ payload: { iss: `${ISSUER}//` } });

      await expect(verify(token)).resolves.toMatchObject({ issuer: ISSUER });
    });

    it('accepts a token that has no exp or nbf', async () => {
      const token = jwtOf({ payload: { exp: undefined } });

      await expect(verify(token)).resolves.toMatchObject({ sub: 'user-1' });
    });

    it('accepts a token that expired within the five minute clock tolerance', async () => {
      await expect(verify(jwtOf({ payload: { exp: nowSeconds() - 290 } }))).resolves.toMatchObject({ sub: 'user-1' });
    });

    it('accepts a token that becomes valid within the five minute clock tolerance', async () => {
      await expect(verify(jwtOf({ payload: { nbf: nowSeconds() + 290 } }))).resolves.toMatchObject({ sub: 'user-1' });
    });
  });

  describe('audience', () => {
    it('is the client id with surrounding whitespace removed', async () => {
      await expect(verify(jwtOf({ payload: { client_id: '  client-1 ', aud: 'api' } }))).resolves.toMatchObject({ audience: 'client-1' });
    });

    it('is the aud claim when there is no client id', async () => {
      await expect(verify(jwtOf({ payload: { client_id: undefined, aud: 'api' } }))).resolves.toMatchObject({ audience: 'api' });
    });

    it('is the first value of an aud list when there is no client id', async () => {
      await expect(verify(jwtOf({ payload: { client_id: undefined, aud: ['api-1', 'api-2'] } }))).resolves.toMatchObject({ audience: 'api-1' });
    });

    it('is the aud claim when the client id is only whitespace', async () => {
      await expect(verify(jwtOf({ payload: { client_id: '   ', aud: 'api' } }))).resolves.toMatchObject({ audience: 'api' });
    });

    it('is reported, not checked: a token for any other audience is accepted', async () => {
      await expect(verify(jwtOf({ payload: { client_id: 'some-other-client', aud: 'some-other-api' } }))).resolves.toMatchObject({ audience: 'some-other-client' });
    });

    it('is empty when the token names neither a client id nor an aud', async () => {
      await expect(verify(jwtOf({ payload: { client_id: undefined } }))).resolves.toMatchObject({ audience: '' });
    });
  });

  describe('rejected tokens', () => {
    it('rejects a token signed by a key other than the published one', async () => {
      await expect(verify(jwtOf({ signWith: OTHER_RSA_KEY }))).resolves.toBeNull();
    });

    it('rejects a token whose payload was changed after signing', async () => {
      const [header, , signature] = jwtOf().split('.');
      const forgedPayload         = Buffer.from(JSON.stringify({ iss: ISSUER, sub: 'admin', exp: nowSeconds() + 3600 })).toString('base64url');

      await expect(verify(`${header}.${forgedPayload}.${signature}`)).resolves.toBeNull();
    });

    it('rejects an algorithm the distribution does not allow, without reading the key store', async () => {
      issuerPublishes([{ ...ES256_KEY.jwk, kid: KID }]);

      await expect(verify(jwtOf({ alg: 'ES256', signWith: ES256_KEY }))).resolves.toBeNull();
      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(0);
    });

    it('rejects a token claiming one issuer but signed with the key of another issuer that uses the same kid', async () => {
      const issuerB = 'https://other.example.com/pool';
      issuerPublishes([{ ...OTHER_RSA_KEY.jwk, kid: KID }], issuerB);

      await expect(verify(jwtOf())).resolves.toMatchObject({ issuer: ISSUER });
      await expect(verify(jwtOf({ payload: { iss: issuerB } }))).resolves.toBeNull();
    });

    it('rejects a token with a critical header parameter it does not understand', async () => {
      await expect(verify(jwtOf({ header: { crit: ['x-unknown'], 'x-unknown': 1 } }))).resolves.toBeNull();
    });

    it('rejects a token whose iat is not a number', async () => {
      await expect(verify(jwtOf({ payload: { iat: 'yesterday' } }))).resolves.toBeNull();
    });

    it('rejects every token when the issuer published a key without a key type, even one signed by a valid key', async () => {
      issuerPublishes([{ ...RSA_KEY.jwk, kid: KID }, { kid: 'broken' }]);

      await expect(verify(jwtOf())).resolves.toBeNull();
    });

    it('allows RS256 and nothing else when the allowed list is empty', async () => {
      await expect(verify(jwtOf(), [])).resolves.toMatchObject({ sub: 'user-1' });

      issuerPublishes([{ ...ES256_KEY.jwk, kid: KID }]);
      await expect(verify(jwtOf({ alg: 'ES256', signWith: ES256_KEY }), [])).resolves.toBeNull();
    });

    it('rejects RS256 when the distribution allows only another algorithm', async () => {
      await expect(verify(jwtOf(), ['ES256'])).resolves.toBeNull();
    });

    it('rejects a token signed with an algorithm outside the supported set', async () => {
      await expect(verify(jwtOf({ alg: 'PS256' }))).resolves.toBeNull();
    });

    it('rejects a token with the alg none', async () => {
      const [, payload] = jwtOf().split('.');
      const header      = Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url');

      await expect(verify(`${header}.${payload}.`)).resolves.toBeNull();
    });

    it('rejects a token whose kid the issuer did not publish', async () => {
      await expect(verify(jwtOf({ header: { kid: 'unknown-kid' } }))).resolves.toBeNull();
    });

    it('rejects a token without a kid', async () => {
      await expect(verify(jwtOf({ header: { kid: undefined } }))).resolves.toBeNull();
    });

    it('rejects a token without an issuer', async () => {
      await expect(verify(jwtOf({ payload: { iss: undefined } }))).resolves.toBeNull();
    });

    it('rejects a token signed with a key that only another issuer published', async () => {
      const otherIssuer = 'https://other.example.com/pool';
      issuerPublishes([{ ...OTHER_RSA_KEY.jwk, kid: KID }], otherIssuer);

      await expect(verify(jwtOf({ payload: { iss: otherIssuer } }))).resolves.toBeNull();
    });

    it('rejects a token whose issuer has no published keys', async () => {
      dynamodb.on(GetItemCommand).resolves({});

      await expect(verify(jwtOf())).resolves.toBeNull();
    });

    it('rejects a token when the key store cannot be read', async () => {
      dynamodb.on(GetItemCommand).rejects(new Error('AccessDeniedException'));

      await expect(verify(jwtOf())).resolves.toBeNull();
    });

    it('rejects a token whose issuer published a malformed key set', async () => {
      dynamodb.on(GetItemCommand).resolves({ Item: { jwks: { S: '{"keys":"none"}' } } });

      await expect(verify(jwtOf())).resolves.toBeNull();
    });

    it('rejects a token that expired beyond the five minute clock tolerance', async () => {
      await expect(verify(jwtOf({ payload: { exp: nowSeconds() - 310 } }))).resolves.toBeNull();
    });

    it('rejects a token that becomes valid beyond the five minute clock tolerance', async () => {
      await expect(verify(jwtOf({ payload: { nbf: nowSeconds() + 310 } }))).resolves.toBeNull();
    });

    it('rejects a token without a subject', async () => {
      await expect(verify(jwtOf({ payload: { sub: undefined } }))).resolves.toBeNull();
    });

    it.each([
      { claim: 'an exp that is not a number', claims: { exp: '9999999999' } },
      { claim: 'an issuer that is not a string', claims: { iss: 7 } },
      { claim: 'a subject that is not a string', claims: { sub: 7 } },
    ])('rejects a token with $claim', async ({ claims }) => {
      await expect(verify(jwtOf({ payload: claims }))).resolves.toBeNull();
    });

    it.each([
      { shape: 'two parts', token: 'aGVhZGVy.cGF5bG9hZA' },
      { shape: 'four parts', token: 'a.b.c.d' },
      { shape: 'a header that is not JSON', token: `bm90LWpzb24.${Buffer.from('{}').toString('base64url')}.c2ln` },
      { shape: 'a payload that is not JSON', token: `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.bm90LWpzb24.c2ln` },
      { shape: 'a header without an alg', token: `${Buffer.from('{"kid":"kid-1"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.c2ln` },
      { shape: 'segments that are not base64url', token: '!!!.@@@.###' },
      { shape: 'a signature that is not base64url', token: `${jwtOf().split('.').slice(0, 2).join('.')}.***` },
      { shape: 'an empty string', token: '' },
    ])('rejects a token with $shape', async ({ token }) => {
      await expect(verify(token)).resolves.toBeNull();
    });
  });

  describe('key caches', () => {
    it('reads the key set of an issuer once for its tokens, from the jwks item of the given table', async () => {
      await verify(jwtOf());
      await verify(jwtOf());

      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(1);
      expect(dynamodb.commandCalls(GetItemCommand)[0].args[0].input).toEqual({
        TableName: AUTH_KEY_STORE_TABLE,
        Key:       { pk: { S: 'jwks' }, sk: { S: ISSUER } },
      });
    });

    it('keeps no key set that was missing, so keys the issuer publishes later are used', async () => {
      dynamodb.on(GetItemCommand).resolvesOnce({}).resolves({ Item: { jwks: { S: JSON.stringify({ keys: [{ ...RSA_KEY.jwk, kid: KID }] }) } } });

      await expect(verify(jwtOf())).resolves.toBeNull();
      await expect(verify(jwtOf())).resolves.toMatchObject({ sub: 'user-1' });
    });
  });
});
