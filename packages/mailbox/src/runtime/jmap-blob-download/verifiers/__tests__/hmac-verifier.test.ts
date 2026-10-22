/**
 * Pins the verification of the two HMAC-signed values a blob download carries, against keys read from the auth
 * key store: the session token that lists the accounts a bearer may read, and the MAC of an email blob id. A
 * verifier that accepted a value signed by any other key, or kept a rotated-out key, would let a forged token
 * or blob id through; one that read the store on every request would add a DynamoDB read to every download.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient }                     from 'aws-sdk-client-mock';

import { HmacVerifier }                   from '../hmac-verifier';

import {
  AUTH_KEY_STORE_TABLE,
  blobMacSignedBy,
  OTHER_AUTH_KEY_STORE_TABLE,
  sessionTokenOverPayload,
  sessionTokenSignedBy,
} from '../../__tests__/jmap-blob-download-helpers';

const CURRENT_KEY  = Buffer.from('current-signing-key-32-bytes-long', 'utf-8');
const PREVIOUS_KEY = Buffer.from('previous-signing-key-32-bytes-ok', 'utf-8');
const OTHER_KEY    = Buffer.from('an-unrelated-key-nobody-rotated-', 'utf-8');

const MAC_PAYLOAD = 'tenant-1|account-1|email-1';

describe('HmacVerifier', () => {
  const dynamodb = mockClient(DynamoDBClient);
  let verifier: HmacVerifier;

  function storeHoldsKeys(current: Buffer, previous?: Buffer): void {
    dynamodb.on(GetItemCommand).resolves({
      Item: {
        current: { S: current.toString('hex') },
        ...(previous ? { previous: { S: previous.toString('hex') } } : {}),
      },
    });
  }

  beforeEach(() => {
    dynamodb.reset();
    verifier = new HmacVerifier(new DynamoDBClient({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('verifySessionToken', () => {
    it('returns the payload of a token signed by the current key', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const token = sessionTokenSignedBy(CURRENT_KEY, 'tenant-1', 'https://issuer.example.com', 'client-1', ['acc-1', 'acc-2']);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toEqual({
        tenantId:   'tenant-1',
        issuer:     'https://issuer.example.com',
        audience:   'client-1',
        accountIds: ['acc-1', 'acc-2'],
      });
    });

    it('reads the signing keys from the hmac / blob-url-signing item of the given table', async () => {
      storeHoldsKeys(CURRENT_KEY);

      await verifier.verifySessionToken(sessionTokenSignedBy(CURRENT_KEY, 't', 'i', 'a', []), AUTH_KEY_STORE_TABLE);

      expect(dynamodb.commandCalls(GetItemCommand)[0].args[0].input).toEqual({
        TableName: AUTH_KEY_STORE_TABLE,
        Key:       { pk: { S: 'hmac' }, sk: { S: 'blob-url-signing' } },
      });
    });

    it('returns the payload of a token signed by the previous key while a rotation is in flight', async () => {
      storeHoldsKeys(CURRENT_KEY, PREVIOUS_KEY);
      const token = sessionTokenSignedBy(PREVIOUS_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toMatchObject({ tenantId: 'tenant-1' });
    });

    it('returns an empty account list for a token that lists no account', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const token = sessionTokenSignedBy(CURRENT_KEY, 'tenant-1', 'issuer', 'aud', []);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toMatchObject({ accountIds: [] });
    });

    it('rejects a token signed by a key that is neither current nor previous', async () => {
      storeHoldsKeys(CURRENT_KEY, PREVIOUS_KEY);
      const token = sessionTokenSignedBy(OTHER_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toBeNull();
    });

    it('rejects a token signed by the previous key when the store holds no previous key', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const token = sessionTokenSignedBy(PREVIOUS_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toBeNull();
    });

    it('rejects a token whose payload was changed after signing', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const [, signature] = sessionTokenSignedBy(CURRENT_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']).split('.');
      const forgedPayload = Buffer.from('tenant-1|issuer|aud|acc-1,acc-2', 'utf-8').toString('base64url');

      await expect(verifier.verifySessionToken(`${forgedPayload}.${signature}`, AUTH_KEY_STORE_TABLE)).resolves.toBeNull();
    });

    it('rejects a correctly signed token that has a second dot after its signature', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const token = sessionTokenSignedBy(CURRENT_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']);

      await expect(verifier.verifySessionToken(`${token}.`, AUTH_KEY_STORE_TABLE)).resolves.toBeNull();
    });

    it.each([
      ['three fields', 'tenant-1|issuer|aud'],
      ['five fields', 'tenant-1|issuer|aud|acc-1|extra'],
    ])('rejects a correctly signed token whose payload has %s', async (_name, payload) => {
      storeHoldsKeys(CURRENT_KEY);

      await expect(
        verifier.verifySessionToken(sessionTokenOverPayload(CURRENT_KEY, payload), AUTH_KEY_STORE_TABLE),
      ).resolves.toBeNull();
    });

    it('rejects every token when the store holds no signing keys', async () => {
      dynamodb.on(GetItemCommand).resolves({});
      const token = sessionTokenSignedBy(CURRENT_KEY, 'tenant-1', 'issuer', 'aud', ['acc-1']);

      await expect(verifier.verifySessionToken(token, AUTH_KEY_STORE_TABLE)).resolves.toBeNull();
    });

    it('lets a store failure propagate', async () => {
      dynamodb.on(GetItemCommand).rejects(new Error('AccessDeniedException'));

      await expect(verifier.verifySessionToken('a.b', AUTH_KEY_STORE_TABLE)).rejects.toThrow('AccessDeniedException');
    });
  });

  describe('verifyBlobMac', () => {
    it('accepts a MAC made over the payload by the current key', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const mac = blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(true);
    });

    it('accepts a MAC made by the previous key while a rotation is in flight', async () => {
      storeHoldsKeys(CURRENT_KEY, PREVIOUS_KEY);
      const mac = blobMacSignedBy(PREVIOUS_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(true);
    });

    it('rejects a MAC made by a key that is neither current nor previous', async () => {
      storeHoldsKeys(CURRENT_KEY, PREVIOUS_KEY);
      const mac = blobMacSignedBy(OTHER_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
    });

    it('rejects a previous-key MAC when the store holds no previous key', async () => {
      storeHoldsKeys(CURRENT_KEY);
      const mac = blobMacSignedBy(PREVIOUS_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
    });

    it.each([
      ['another account', 'tenant-1|account-2|email-1'],
      ['another email', 'tenant-1|account-1|email-2'],
      ['another tenant', 'tenant-2|account-1|email-1'],
    ])('rejects a MAC that was made for %s', async (_name, payload) => {
      storeHoldsKeys(CURRENT_KEY);
      const mac = blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(payload, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
    });

    it.each([
      ['a truncated MAC', (mac: string) => mac.slice(0, 20)],
      ['an empty MAC', () => ''],
      ['a MAC with a flipped first byte', (mac: string) => {
        const bytes = Buffer.from(mac, 'base64url');
        bytes[0]   ^= 0xff;
        return bytes.toString('base64url');
      }],
    ])('rejects %s', async (_name, tamper) => {
      storeHoldsKeys(CURRENT_KEY);
      const mac = tamper(blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1'));

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
    });

    it('rejects every MAC when the store holds no signing keys', async () => {
      dynamodb.on(GetItemCommand).resolves({});
      const mac = blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
    });
  });

  describe('key cache', () => {
    it('reads the store once for the session token and the blob MAC of a request', async () => {
      storeHoldsKeys(CURRENT_KEY);

      await verifier.verifySessionToken(sessionTokenSignedBy(CURRENT_KEY, 't', 'i', 'a', []), AUTH_KEY_STORE_TABLE);
      await verifier.verifyBlobMac(MAC_PAYLOAD, blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1'), AUTH_KEY_STORE_TABLE);

      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(1);
    });

    it('reads the store again once the cached keys are thirty minutes old', async () => {
      const startedAt = Date.now();
      const clock     = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
      storeHoldsKeys(CURRENT_KEY);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', AUTH_KEY_STORE_TABLE);

      clock.mockReturnValue(startedAt + 30 * 60 * 1000 - 1);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', AUTH_KEY_STORE_TABLE);
      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(1);

      clock.mockReturnValue(startedAt + 30 * 60 * 1000);
      storeHoldsKeys(OTHER_KEY);
      await verifier.verifyBlobMac(MAC_PAYLOAD, blobMacSignedBy(OTHER_KEY, 'tenant-1', 'account-1', 'email-1'), AUTH_KEY_STORE_TABLE);

      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(2);
    });

    it('keeps the keys of each auth key store table apart', async () => {
      dynamodb.on(GetItemCommand, { TableName: AUTH_KEY_STORE_TABLE }).resolves({ Item: { current: { S: CURRENT_KEY.toString('hex') } } });
      dynamodb.on(GetItemCommand, { TableName: OTHER_AUTH_KEY_STORE_TABLE }).resolves({ Item: { current: { S: OTHER_KEY.toString('hex') } } });
      const mac = blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(true);
      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, OTHER_AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(true);
    });

    it('re-reads the keys of each table thirty minutes after that table was read', async () => {
      const startedAt = Date.now();
      const clock     = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
      storeHoldsKeys(CURRENT_KEY);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', AUTH_KEY_STORE_TABLE);

      clock.mockReturnValue(startedAt + 20 * 60 * 1000);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', OTHER_AUTH_KEY_STORE_TABLE);
      expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(2);

      clock.mockReturnValue(startedAt + 30 * 60 * 1000);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', AUTH_KEY_STORE_TABLE);
      await verifier.verifyBlobMac(MAC_PAYLOAD, 'x', OTHER_AUTH_KEY_STORE_TABLE);

      const readTables = dynamodb.commandCalls(GetItemCommand).map((call) => call.args[0].input.TableName);
      expect(readTables).toEqual([AUTH_KEY_STORE_TABLE, OTHER_AUTH_KEY_STORE_TABLE, AUTH_KEY_STORE_TABLE]);
    });

    it('does not cache a missing key, so keys that appear later are used', async () => {
      dynamodb.on(GetItemCommand).resolvesOnce({}).resolves({ Item: { current: { S: CURRENT_KEY.toString('hex') } } });
      const mac = blobMacSignedBy(CURRENT_KEY, 'tenant-1', 'account-1', 'email-1');

      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(false);
      await expect(verifier.verifyBlobMac(MAC_PAYLOAD, mac, AUTH_KEY_STORE_TABLE)).resolves.toBe(true);
    });
  });
});
