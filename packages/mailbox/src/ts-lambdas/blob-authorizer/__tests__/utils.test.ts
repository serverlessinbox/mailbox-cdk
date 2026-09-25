/**
 * Tests for blob ID decoding, parsing, and validation utilities.
 * These tests pin the parsing logic for all blob ID types (email, contact, principal),
 * MAC extraction, path safety checks, and the decoding roundtrip.
 */

import {
  decodeBase64UrlBlobId,
  parseBlobId,
  extractDownloadParams,
  createErrorResponse,
} from '../utils';

describe('decodeBase64UrlBlobId', () => {
  it('decodes valid base64url-encoded email blobId', () => {
    // Original: eml:emailID12345:original.eml
    const encoded = Buffer.from('eml:emailID12345:original.eml', 'utf-8').toString('base64url');
    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe('eml:emailID12345:original.eml');
  });

  it('decodes valid base64url-encoded contact blobId', () => {
    // Original: cnt:contactCardID789:photo.jpg
    const encoded = Buffer.from('cnt:contactCardID789:photo.jpg', 'utf-8').toString('base64url');
    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe('cnt:contactCardID789:photo.jpg');
  });

  it('decodes valid base64url-encoded principal blobId', () => {
    // Original: prn:principalID456:profile.png
    const encoded = Buffer.from('prn:principalID456:profile.png', 'utf-8').toString('base64url');
    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe('prn:principalID456:profile.png');
  });

  it('handles base64url without padding', () => {
    // base64url encoding omits padding (no = signs)
    const blobId = 'eml:test123:file.txt';
    const encoded = Buffer.from(blobId, 'utf-8').toString('base64url');
    // Verify no padding
    expect(encoded).not.toContain('=');
    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe(blobId);
  });

  it('returns null for invalid base64url', () => {
    const decoded = decodeBase64UrlBlobId('!!!invalid base64!!!');
    expect(decoded).toBeNull();
  });

  it('returns null for empty string', () => {
    const decoded = decodeBase64UrlBlobId('');
    expect(decoded).toBeNull();
  });

  it('returns null for malformed base64', () => {
    const decoded = decodeBase64UrlBlobId('aGVsbG8gd29ybGQh!!!');
    expect(decoded).toBeNull();
  });
});

describe('parseBlobId with decoded values', () => {
  it('parses email blobId with MAC from decoded string', () => {
    const decodedBlobId = 'eml:emailID12345:document.pdf:dGVzdG1hY2RhdGE';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID12345',
      path: 'document.pdf',
      mac: 'dGVzdG1hY2RhdGE',
    });
  });

  it('returns email blob with mac: null for unsigned email blobId (no MAC)', () => {
    const decodedBlobId = 'eml:emailID12345:document.pdf';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID12345',
      path: 'document.pdf',
      mac: null,
    });
  });

  it('parses email blobId with colons in filename correctly', () => {
    const decodedBlobId = 'eml:emailID:file:with:colons.pdf:dGVzdG1hYzI';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID',
      path: 'file:with:colons.pdf',
      mac: 'dGVzdG1hYzI',
    });
  });

  it('parses contact blobId from decoded string (unchanged)', () => {
    const decodedBlobId = 'cnt:cardID789:photo.jpg';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'contact',
      entityId: 'cardID789',
      path: 'photo.jpg',
    });
  });

  it('parses principal blobId from decoded string (unchanged)', () => {
    const decodedBlobId = 'prn:principalID:avatar.png';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'principal',
      entityId: 'principalID',
      path: 'avatar.png',
    });
  });

  it('returns null for invalid prefix', () => {
    const parsed = parseBlobId('xyz:entityId:path');
    expect(parsed).toBeNull();
  });

  it('returns null for malformed format (missing entity separator)', () => {
    const parsed = parseBlobId('eml:onlyEntityId');
    expect(parsed).toBeNull();
  });

  it('contact blobId with colon in path still works (no MAC in cnt)', () => {
    const decodedBlobId = 'cnt:cardID:path:with:colons.jpg';
    const parsed = parseBlobId(decodedBlobId);
    expect(parsed).toEqual({
      type: 'contact',
      entityId: 'cardID',
      path: 'path:with:colons.jpg',
    });
  });
});

describe('full base64url decode → parse flow', () => {
  it('decodes and parses email blobId with MAC end-to-end', () => {
    const mac = 'dGVzdG1hY2RhdGE';  // test MAC
    const originalBlobId = `eml:qpG-DL09M671kUyuDfn0r:original.eml:${mac}`;
    const encoded = Buffer.from(originalBlobId, 'utf-8').toString('base64url');

    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded).toBe(originalBlobId);

    const parsed = parseBlobId(decoded!);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'qpG-DL09M671kUyuDfn0r',
      path: 'original.eml',
      mac: mac,
    });
  });

  it('returns email blob with mac: null when email blobId lacks MAC (unsigned blob)', () => {
    const originalBlobId = 'eml:qpG-DL09M671kUyuDfn0r:original.eml';
    const encoded = Buffer.from(originalBlobId, 'utf-8').toString('base64url');

    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe(originalBlobId);

    const parsed = parseBlobId(decoded!);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'qpG-DL09M671kUyuDfn0r',
      path: 'original.eml',
      mac: null,
    });
  });

  it('decodes and parses contact blobId end-to-end (unchanged)', () => {
    const originalBlobId = 'cnt:contactID-ABC_123:photo.jpg';
    const encoded = Buffer.from(originalBlobId, 'utf-8').toString('base64url');

    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe(originalBlobId);

    const parsed = parseBlobId(decoded!);
    expect(parsed).toEqual({
      type: 'contact',
      entityId: 'contactID-ABC_123',
      path: 'photo.jpg',
    });
  });

  it('handles decode failure as invalid blobId (like parseBlobId returning null)', () => {
    const invalidEncoded = '!!!not valid base64!!!';
    const decoded = decodeBase64UrlBlobId(invalidEncoded);
    expect(decoded).toBeNull();

    // If decode fails, we should return the same error as a malformed blobId
    // This mimics the handler's error path
    expect(decoded === null).toBe(true);
  });
});

describe('createErrorResponse for invalid blobId', () => {
  it('returns 400 error response', () => {
    const response = createErrorResponse(400, 'Invalid blobId format');
    expect(response.status).toBe('400');
    expect(response.statusDescription).toBe('Invalid blobId format');
    expect(response.body).toBe(JSON.stringify({ error: 'Invalid blobId format' }));
  });
});

describe('extractDownloadParams', () => {
  it('extracts base64url-encoded blobId from query string', () => {
    const blobId = 'eml:emailID123:file.pdf';
    const encoded = Buffer.from(blobId, 'utf-8').toString('base64url');
    const queryString = `accountId=acc123&blobId=${encoded}&type=application/pdf&name=document.pdf`;

    const params = extractDownloadParams(queryString);
    expect(params).not.toBeNull();
    expect(params!.accountId).toBe('acc123');
    expect(params!.blobId).toBe(encoded); // Still encoded at this stage
    expect(params!.type).toBe('application/pdf');
    expect(params!.name).toBe('document.pdf');
  });

  it('returns null if required parameters are missing', () => {
    const queryString = 'accountId=acc123';
    const params = extractDownloadParams(queryString);
    expect(params).toBeNull();
  });
});
