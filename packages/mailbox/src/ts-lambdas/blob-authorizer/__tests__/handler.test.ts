/**
 * Integration tests for the blob-authorizer Lambda@Edge handler.
 * These tests exercise the real handler, mocking only the volatile boundaries:
 * config extraction, JWT verification, and DynamoDB access.
 */

import * as crypto from 'crypto';

// Type-only imports: these do NOT create a runtime module reference, so they
// can't drift from whichever module instance a given test actually requires.
import type * as ConfigModule from '../config';
import type * as JwtModule from '../jwt';
import type { DynamoDBClient as DynamoDBClientType } from '@aws-sdk/client-dynamodb';
import type { handler as HandlerType } from '../index';

// Populated fresh in beforeEach from the SAME isolated module registry, so the
// handler under test and the mocks it resolves are always the same instances.
let configModule: typeof ConfigModule;
let jwtModule: typeof JwtModule;
let DynamoDBClient: (typeof DynamoDBClientType) & jest.Mock;
let handler: typeof HandlerType;

// Helper to generate a valid HMAC session token
function generateSessionToken(
  key: Buffer,
  tenantId: string,
  issuer: string,
  audience: string,
  accountIds: string[]
): string {
  const payload = `${tenantId}|${issuer}|${audience}|${accountIds.join(',')}`;
  const payloadBytes = Buffer.from(payload, 'utf-8');
  const hmac = crypto.createHmac('sha256', key).update(payloadBytes).digest();
  const payloadB64 = payloadBytes.toString('base64url');
  const hmacB64 = hmac.toString('base64url');
  return `${payloadB64}.${hmacB64}`;
}

// Helper to generate a per-blob MAC
function generateBlobMac(
  key: Buffer,
  tenantId: string,
  accountId: string,
  emailId: string
): string {
  const payload = `${tenantId}|${accountId}|${emailId}`;
  const macBytes = crypto.createHmac('sha256', key).update(payload).digest();
  return macBytes.toString('base64url');
}

// Helper to build and encode a blobId
function encodeBlobId(type: string, entityId: string, filename: string, mac?: string): string {
  let decodedBlobId: string;
  if (type === 'email' && mac !== undefined) {
    decodedBlobId = `eml:${entityId}:${filename}:${mac}`;
  } else if (type === 'contact') {
    decodedBlobId = `cnt:${entityId}:${filename}`;
  } else if (type === 'principal') {
    decodedBlobId = `prn:${entityId}:${filename}`;
  } else {
    throw new Error(`Unknown blob type: ${type}`);
  }
  return Buffer.from(decodedBlobId, 'utf-8').toString('base64url');
}

// Helper to build a CloudFront Lambda@Edge event
function buildEvent(
  accountId: string,
  blobId: string,
  authToken: string,
  jwtToken: string
): any {
  return {
    Records: [
      {
        cf: {
          request: {
            method: 'GET',
            uri: '/download',
            querystring: `accountId=${accountId}&blobId=${blobId}&type=application/pdf&name=test.pdf&auth=${authToken}`,
            headers: {
              authorization: [
                {
                  key: 'Authorization',
                  value: `Bearer ${jwtToken}`,
                },
              ],
              origin: [
                {
                  key: 'Origin',
                  value: 'https://example.com',
                },
              ],
            },
            origin: {
              s3: {
                customHeaders: {
                  'x-auth-key-store-table': [
                    {
                      key: 'x-auth-key-store-table',
                      value: 'auth-key-store',
                    },
                  ],
                  'x-region': [
                    {
                      key: 'x-region',
                      value: 'us-east-1',
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  };
}

describe('blob-authorizer handler', () => {
  beforeEach(() => {
    // Reset the module registry AND re-require the mocked modules + the handler
    // together, so they resolve the same fresh instances. This also clears
    // hmac.ts's module-level key cache and index.ts's module-level DynamoDB
    // client cache between tests, since both modules are freshly required.
    jest.resetModules();
    jest.doMock('../config');
    jest.doMock('../jwt');
    jest.doMock('@aws-sdk/client-dynamodb');
    configModule = require('../config');
    jwtModule = require('../jwt');
    ({ DynamoDBClient } = require('@aws-sdk/client-dynamodb'));
    ({ handler } = require('../index'));
  });

  describe('Case 1: Valid session token + valid MAC + safe filename', () => {
    it('forwards request with correct S3 key when all checks pass', async () => {
      // Setup test data
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      // Generate valid tokens
      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      const blobMac = generateBlobMac(keyBuffer, tenantId, accountId, emailId);
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMac);
      const jwtToken = 'valid.jwt.token';

      // Mock config
      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
        jwtAlgorithms: ['HS256'],
      });

      // Mock JWT extraction and verification
      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      // Mock DynamoDB client to return HMAC keys
      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      // Verify the request was forwarded (not an error response)
      expect(result).toHaveProperty('uri');
      expect(result.uri).toContain(tenantId);
      expect(result.uri).toContain(accountId);
      expect(result.uri).toContain(emailId);
      expect(result.uri).toContain(filename);
      // MAC should NOT be in the S3 key
      expect(result.uri).not.toContain(blobMac);
      expect(result.querystring).toBeUndefined();
    });
  });

  describe('Case 2: Tampered/garbage MAC', () => {
    it('returns 403 when MAC is tampered with', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      // Generate valid session token but TAMPERED blob MAC
      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      const validBlobMac = generateBlobMac(keyBuffer, tenantId, accountId, emailId);
      // Tamper with the MAC by flipping some bits
      const tamperedMac = Buffer.from(validBlobMac, 'base64url');
      tamperedMac[0] ^= 0xFF; // Flip all bits in first byte
      const tamperedMacB64 = tamperedMac.toString('base64url');

      const encodedBlobId = encodeBlobId('email', emailId, filename, tamperedMacB64);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result.status).toBe('403');
      expect(result.statusDescription).toContain('Access denied');
    });
  });

  describe('Case 3: MAC generated for different accountId', () => {
    it('returns 403 when MAC is for a different account', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const differentAccountId = 'account999';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      // Generate session token for account456, but MAC for account999
      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      const blobMacForDifferentAccount = generateBlobMac(
        keyBuffer,
        tenantId,
        differentAccountId,
        emailId
      );
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMacForDifferentAccount);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result.status).toBe('403');
    });
  });

  describe('Case 4: MAC generated for different emailId', () => {
    it('returns 403 when MAC is for a different email', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const differentEmailId = 'email999';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      // Generate session token with correct account, but MAC for different email
      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      const blobMacForDifferentEmail = generateBlobMac(
        keyBuffer,
        tenantId,
        accountId,
        differentEmailId
      );
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMacForDifferentEmail);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result.status).toBe('403');
    });
  });

  describe('Case 5: MAC with previous key (rotation)', () => {
    it('forwards request when MAC is signed with previous key', async () => {
      const currentKeyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const previousKeyBuffer = Buffer.from('rotation-previous-32byte-key', 'utf-8');
      const tenantId = 'rotation-tenant';
      const accountId = 'rotation-account';
      const emailId = 'rotation-email';
      const issuer = 'rotation-issuer';
      const audience = 'rotation-audience';
      const filename = 'document.pdf';

      // Generate session token with CURRENT key
      const sessionToken = generateSessionToken(
        currentKeyBuffer,
        tenantId,
        issuer,
        audience,
        [accountId]
      );
      // Generate blob MAC with PREVIOUS key
      const blobMacWithPreviousKey = generateBlobMac(previousKeyBuffer, tenantId, accountId, emailId);
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMacWithPreviousKey);
      const jwtToken = 'rotation-jwt-token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      // Mock DynamoDB to return both current and previous keys
      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: currentKeyBuffer.toString('hex'),
            },
            previous: {
              S: previousKeyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      // Should forward because previous key works for the blob MAC
      expect(result).toHaveProperty('uri');
      expect(result.uri).toContain(tenantId);
      expect(result.uri).toContain(accountId);
      expect(result.uri).toContain(emailId);
    });
  });

  describe('Case 6: eml: blobId with no MAC segment', () => {
    it('returns 403 for email blob missing MAC', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      // Build blobId WITHOUT MAC (no second colon after filename)
      const decodedBlobIdWithoutMac = `eml:${emailId}:${filename}`;
      const encodedBlobId = Buffer.from(decodedBlobIdWithoutMac, 'utf-8').toString('base64url');
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result.status).toBe('403');
      expect(result.statusDescription).toContain('invalid blob');
    });
  });

  describe('Case 7: Unsafe filename with / or ..', () => {
    it('returns 403 for filename containing forward slash', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const unsafeFilename = '../../../etc/passwd';

      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      const blobMac = generateBlobMac(keyBuffer, tenantId, accountId, emailId);
      const encodedBlobId = encodeBlobId('email', emailId, unsafeFilename, blobMac);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result.status).toBe('403');
      expect(result.statusDescription).toContain('Access denied');
    });
  });

  describe('Case 8: Invalid/absent session token', () => {
    it('returns 401 when authorization header is missing', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const filename = 'document.pdf';

      const sessionToken = generateSessionToken(
        keyBuffer,
        tenantId,
        'issuer',
        'audience',
        [accountId]
      );
      const blobMac = generateBlobMac(keyBuffer, tenantId, accountId, emailId);
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMac);

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      // Mock extractToken to return null (header missing/invalid)
      (jwtModule.extractToken as jest.Mock).mockReturnValue(null);

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, 'invalid');
      const result = await handler(event);

      expect(result.status).toBe('401');
      expect(result.statusDescription).toContain('Authorization');
    });
  });

  describe('Case 8b: Valid JWT + valid MAC but invalid HMAC token', () => {
    it('returns 403 when HMAC token is invalid even with valid JWT and blob MAC', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const emailId = 'email789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'document.pdf';

      // Generate valid blob MAC (valid session token not needed for this test)
      const blobMac = generateBlobMac(keyBuffer, tenantId, accountId, emailId);
      const encodedBlobId = encodeBlobId('email', emailId, filename, blobMac);
      const jwtToken = 'valid.jwt.token';

      // Create an invalid HMAC token by tampering with the valid one
      const invalidAuthToken = Buffer.from('tampered-invalid-auth-token', 'utf-8').toString('base64url');

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, invalidAuthToken, jwtToken);
      const result = await handler(event);

      // Should be rejected at HMAC verification stage, not at blob MAC stage
      expect(result.status).toBe('403');
      expect(result.statusDescription).toContain('Access denied');
    });
  });

  describe('Case 9: cnt: and prn: blobIds', () => {
    it('forwards cnt: (contact) blobId without MAC verification', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const accountId = 'account456';
      const contactId = 'contact789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'photo.jpg';

      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [accountId]);
      // Contact blobId has no MAC
      const encodedBlobId = encodeBlobId('contact', contactId, filename);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent(accountId, encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result).toHaveProperty('uri');
      expect(result.uri).toContain(tenantId);
      expect(result.uri).toContain(contactId);
      expect(result.uri).toContain(filename);
    });

    it('forwards prn: (principal) blobId without MAC verification', async () => {
      const keyBuffer = Buffer.from('rotation-current-32byte-key!', 'utf-8');
      const tenantId = 'tenant123';
      const principalId = 'principal789';
      const issuer = 'issuer.example.com';
      const audience = 'audience.example.com';
      const filename = 'avatar.png';

      // Principal requests don't require accountId authorization
      const sessionToken = generateSessionToken(keyBuffer, tenantId, issuer, audience, [
        'some-account',
      ]);
      const encodedBlobId = encodeBlobId('principal', principalId, filename);
      const jwtToken = 'valid.jwt.token';

      (configModule.extractConfig as jest.Mock).mockReturnValue({
        authKeyStoreTable: 'auth-key-store',
        region: 'us-east-1',
      });

      (jwtModule.extractToken as jest.Mock).mockReturnValue(jwtToken);
      (jwtModule.verifyJWTSignatureOnly as jest.Mock).mockResolvedValue({
        issuer,
        audience,
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({
          Item: {
            current: {
              S: keyBuffer.toString('hex'),
            },
          },
        }),
      };

      (DynamoDBClient as jest.Mock).mockImplementation(() => mockClient);

      const event = buildEvent('irrelevant-account', encodedBlobId, sessionToken, jwtToken);
      const result = await handler(event);

      expect(result).toHaveProperty('uri');
      expect(result.uri).toContain(tenantId);
      expect(result.uri).toContain(principalId);
      expect(result.uri).toContain(filename);
    });
  });
});
