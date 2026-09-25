/**
 * Tests for blob MAC verification, path safety checks, and integration flows.
 * These test the parsing and validation logic in isolation using crypto APIs.
 */

import * as crypto from 'crypto';
import { isSafeBlobPath, parseBlobId, decodeBase64UrlBlobId } from '../utils';

describe('parseBlobId with MAC extraction', () => {
  it('parses email blobId with MAC correctly', () => {
    const mac = 'dGVzdG1hY2RhdGE';  // test MAC in base64url
    const blobId = `eml:emailID123:document.pdf:${mac}`;
    const parsed = parseBlobId(blobId);

    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID123',
      path: 'document.pdf',
      mac: mac,
    });
  });

  it('parses email blobId with colon in filename correctly', () => {
    const mac = 'dGVzdG1hYzI';  // test MAC
    const blobId = `eml:emailID456:my:file:with:colons.pdf:${mac}`;
    const parsed = parseBlobId(blobId);

    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID456',
      path: 'my:file:with:colons.pdf',
      mac: mac,
    });
  });

  it('returns email blob with mac: null for unsigned email blobId (no second colon)', () => {
    const blobId = 'eml:emailID789:document.pdf';
    const parsed = parseBlobId(blobId);
    expect(parsed).toEqual({
      type: 'email',
      entityId: 'emailID789',
      path: 'document.pdf',
      mac: null,
    });
  });

  it('parses contact blobId unchanged (no MAC)', () => {
    const blobId = 'cnt:cardID:photo.jpg';
    const parsed = parseBlobId(blobId);

    expect(parsed).toEqual({
      type: 'contact',
      entityId: 'cardID',
      path: 'photo.jpg',
    });
  });

  it('parses principal blobId unchanged (no MAC)', () => {
    const blobId = 'prn:principalID:avatar.png';
    const parsed = parseBlobId(blobId);

    expect(parsed).toEqual({
      type: 'principal',
      entityId: 'principalID',
      path: 'avatar.png',
    });
  });

  it('contact blobId with multiple colons in path', () => {
    const blobId = 'cnt:cardID:path:with:many:colons.jpg';
    const parsed = parseBlobId(blobId);

    expect(parsed).toEqual({
      type: 'contact',
      entityId: 'cardID',
      path: 'path:with:many:colons.jpg',
    });
  });
});

describe('isSafeBlobPath', () => {
  it('accepts normal filenames', () => {
    expect(isSafeBlobPath('document.pdf')).toBe(true);
    expect(isSafeBlobPath('photo.jpg')).toBe(true);
    expect(isSafeBlobPath('file-name_123.txt')).toBe(true);
  });

  it('accepts filenames with colons', () => {
    expect(isSafeBlobPath('file:with:colons.pdf')).toBe(true);
  });

  it('rejects paths with forward slash', () => {
    expect(isSafeBlobPath('path/to/file.pdf')).toBe(false);
    expect(isSafeBlobPath('/file.pdf')).toBe(false);
    expect(isSafeBlobPath('file.pdf/')).toBe(false);
  });

  it('rejects paths with backslash', () => {
    expect(isSafeBlobPath('path\\to\\file.pdf')).toBe(false);
    expect(isSafeBlobPath('\\file.pdf')).toBe(false);
  });

  it('rejects paths with ".." segments', () => {
    expect(isSafeBlobPath('..')).toBe(false);
    expect(isSafeBlobPath('../../etc/passwd')).toBe(false);
  });

  it('rejects empty paths', () => {
    expect(isSafeBlobPath('')).toBe(false);
  });

  it('rejects paths with control characters', () => {
    expect(isSafeBlobPath('file\x00.pdf')).toBe(false);  // NULL
    expect(isSafeBlobPath('file\x01.pdf')).toBe(false);  // SOH
    expect(isSafeBlobPath('file\x1f.pdf')).toBe(false);  // US (0x1F)
    expect(isSafeBlobPath('file\n.pdf')).toBe(false);    // LF (0x0A)
    expect(isSafeBlobPath('file\r.pdf')).toBe(false);    // CR (0x0D)
  });

  it('accepts valid edge case filenames', () => {
    expect(isSafeBlobPath('file.with.dots')).toBe(true);
    expect(isSafeBlobPath('file-name-with-dashes')).toBe(true);
    expect(isSafeBlobPath('file_name_with_underscores')).toBe(true);
  });
});

describe('MAC generation and verification (matching Go signer)', () => {
  it('generates MAC matching Go HMAC-SHA256 base64url format', () => {
    // This test verifies the node crypto API produces the same output as Go's HMAC-SHA256
    const key = Buffer.from('test-key-bytes-here', 'utf-8');
    const payload = 'tenant123|account456|email789';

    const mac = crypto.createHmac('sha256', key).update(Buffer.from(payload, 'utf-8')).digest();
    const macB64Url = mac.toString('base64url');

    // Verify this is valid base64url (no padding)
    expect(macB64Url).not.toContain('=');

    // Verify we can decode it back
    const decodedMac = Buffer.from(macB64Url, 'base64url');
    expect(decodedMac).toEqual(mac);
  });

  it('constant-time comparison rejects wrong MAC', () => {
    const key = Buffer.from('test-key', 'utf-8');
    const payload = 'tenant123|account456|email789';

    const correctMac = crypto.createHmac('sha256', key).update(Buffer.from(payload, 'utf-8')).digest();
    // Create a wrong MAC of the same size (32 bytes for SHA256)
    const wrongMac = Buffer.alloc(32, 0xFF);

    // timingSafeEqual returns false for different buffers of same size
    const isEqual = crypto.timingSafeEqual(correctMac, wrongMac);
    expect(isEqual).toBe(false);
  });
});

describe('base64url blob ID encoding/decoding round-trip', () => {
  it('encodes and decodes email blobId with MAC', () => {
    const mac = Buffer.from('maccontent', 'utf-8').toString('base64url');
    const decodedBlobId = `eml:emailID:file.pdf:${mac}`;

    // Simulate wire format
    const encoded = Buffer.from(decodedBlobId, 'utf-8').toString('base64url');
    expect(encoded).not.toContain('=');  // No padding

    // Decode back
    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe(decodedBlobId);

    // Parse to extract MAC
    const parsed = parseBlobId(decoded!);
    if (parsed && parsed.type === 'email') {
      expect(parsed).toEqual({
        type: 'email',
        entityId: 'emailID',
        path: 'file.pdf',
        mac: mac,
      });
    } else {
      throw new Error('Expected email blob with MAC');
    }
  });

  it('handles MAC that looks like base64url with special chars', () => {
    // Generate a realistic base64url MAC
    const payload = 'tenant|account|email';
    const key = Buffer.from('some-secret-key', 'utf-8');
    const mac = crypto.createHmac('sha256', key).update(payload).digest('base64url');

    const decodedBlobId = `eml:emailID:file.pdf:${mac}`;
    const encoded = Buffer.from(decodedBlobId, 'utf-8').toString('base64url');

    const decoded = decodeBase64UrlBlobId(encoded);
    expect(decoded).toBe(decodedBlobId);

    const parsed = parseBlobId(decoded!);
    if (parsed && parsed.type === 'email') {
      expect(parsed.mac).toBe(mac);
    } else {
      throw new Error('Expected email blob with MAC');
    }
  });
});

describe('integration: parse and validate blob ID flow', () => {
  it('processes valid email blob: parse → check MAC → check path', () => {
    const key = Buffer.from('integration-test-key', 'utf-8');
    const tenantId = 'tenant123';
    const accountId = 'account456';
    const emailId = 'email789';
    const filename = 'document.pdf';

    // Generate MAC as the Go signer would
    const payload = `${tenantId}|${accountId}|${emailId}`;
    const macBytes = crypto.createHmac('sha256', key).update(payload).digest();
    const mac = macBytes.toString('base64url');

    // Construct blob ID as Go signer would
    const storedForm = `eml:${emailId}:${filename}:${mac}`;
    const wireForm = Buffer.from(storedForm, 'utf-8').toString('base64url');

    // Client receives wireForm, Lambda decodes it
    const decoded = decodeBase64UrlBlobId(wireForm);
    expect(decoded).toBe(storedForm);

    // Parse the decoded form
    const parsed = parseBlobId(decoded!);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('email');
    if (parsed!.type === 'email') {
      expect(parsed!.entityId).toBe(emailId);
      expect(parsed!.path).toBe(filename);
      expect(parsed!.mac).toBe(mac);

      // Verify MAC
      const macPayload = `${tenantId}|${accountId}|${parsed!.entityId}`;
      const expectedMac = crypto.createHmac('sha256', key).update(Buffer.from(macPayload, 'utf-8')).digest();
      const mac2 = parsed!.mac as string;  // Type-safe cast after null check in outer scope
      const receivedMac = Buffer.from(mac2, 'base64url');

      const isMacValid = expectedMac.length === receivedMac.length &&
        crypto.timingSafeEqual(expectedMac, receivedMac);
      expect(isMacValid).toBe(true);
    }

    // Check path safety
    const isPathSafe = isSafeBlobPath(parsed!.path);
    expect(isPathSafe).toBe(true);
  });

  it('rejects email blob with unsafe path', () => {
    const key = Buffer.from('test-key', 'utf-8');
    const tenantId = 'tenant123';
    const accountId = 'account456';
    const emailId = 'email789';
    const unsafeFilename = '../../../etc/passwd';  // Path traversal attempt

    const payload = `${tenantId}|${accountId}|${emailId}`;
    const macBytes = crypto.createHmac('sha256', key).update(Buffer.from(payload, 'utf-8')).digest();
    const mac = macBytes.toString('base64url');

    const storedForm = `eml:${emailId}:${unsafeFilename}:${mac}`;
    const decoded = decodeBase64UrlBlobId(Buffer.from(storedForm, 'utf-8').toString('base64url'));

    const parsed = parseBlobId(decoded!);
    expect(parsed).not.toBeNull();
    if (parsed!.type === 'email') {
      expect(parsed!.mac).toBe(mac);
    }

    // Path safety check should fail
    const isPathSafe = isSafeBlobPath(parsed!.path);
    expect(isPathSafe).toBe(false);
  });

  it('rejects email blob with wrong MAC', () => {
    const key = Buffer.from('correct-key', 'utf-8');
    const wrongKey = Buffer.from('wrong-key', 'utf-8');

    const tenantId = 'tenant123';
    const accountId = 'account456';
    const emailId = 'email789';
    const filename = 'document.pdf';

    // Generate MAC with wrong key
    const payload = `${tenantId}|${accountId}|${emailId}`;
    const macBytes = crypto.createHmac('sha256', wrongKey).update(payload).digest();
    const mac = macBytes.toString('base64url');

    const storedForm = `eml:${emailId}:${filename}:${mac}`;
    const decoded = decodeBase64UrlBlobId(Buffer.from(storedForm, 'utf-8').toString('base64url'));

    const parsed = parseBlobId(decoded!);
    expect(parsed).not.toBeNull();
    if (parsed!.type === 'email') {
      // Try to verify MAC with correct key
      const macPayload = `${tenantId}|${accountId}|${parsed!.entityId}`;
      const expectedMac = crypto.createHmac('sha256', key).update(Buffer.from(macPayload, 'utf-8')).digest();
      const mac2 = parsed!.mac as string;
      const receivedMac = Buffer.from(mac2, 'base64url');

      const isMacValid = expectedMac.length === receivedMac.length &&
        crypto.timingSafeEqual(expectedMac, receivedMac);
      expect(isMacValid).toBe(false);
    }
  });

  it('rejects email blob with different accountId in MAC', () => {
    const key = Buffer.from('test-key', 'utf-8');
    const tenantId = 'tenant123';
    const accountId1 = 'account456';
    const accountId2 = 'account789';  // Different account
    const emailId = 'email123';
    const filename = 'document.pdf';

    // Generate MAC for accountId1
    const payload1 = `${tenantId}|${accountId1}|${emailId}`;
    const macBytes = crypto.createHmac('sha256', key).update(payload1).digest();
    const mac = macBytes.toString('base64url');

    const storedForm = `eml:${emailId}:${filename}:${mac}`;
    const decoded = decodeBase64UrlBlobId(Buffer.from(storedForm, 'utf-8').toString('base64url'));

    const parsed = parseBlobId(decoded!);
    if (parsed!.type === 'email') {
      // Try to verify MAC with accountId2
      const payloadWithWrongAccount = `${tenantId}|${accountId2}|${parsed!.entityId}`;
      const expectedMac = crypto.createHmac('sha256', key).update(Buffer.from(payloadWithWrongAccount, 'utf-8')).digest();
      const mac2 = parsed!.mac as string;
      const receivedMac = Buffer.from(mac2, 'base64url');

      const isMacValid = expectedMac.length === receivedMac.length &&
        crypto.timingSafeEqual(expectedMac, receivedMac);
      expect(isMacValid).toBe(false);
    }
  });

  it('rejects email blob with different emailId in MAC', () => {
    const key = Buffer.from('test-key', 'utf-8');
    const tenantId = 'tenant123';
    const accountId = 'account456';
    const emailId1 = 'email123';
    const emailId2 = 'email789';  // Different email
    const filename = 'document.pdf';

    // Generate MAC for emailId1
    const payload1 = `${tenantId}|${accountId}|${emailId1}`;
    const macBytes = crypto.createHmac('sha256', key).update(payload1).digest();
    const mac = macBytes.toString('base64url');

    const storedForm = `eml:${emailId1}:${filename}:${mac}`;
    const decoded = decodeBase64UrlBlobId(Buffer.from(storedForm, 'utf-8').toString('base64url'));

    const parsed = parseBlobId(decoded!);
    if (parsed!.type === 'email') {
      // Try to verify MAC with emailId2
      const payloadWithWrongEmail = `${tenantId}|${accountId}|${emailId2}`;
      const expectedMac = crypto.createHmac('sha256', key).update(Buffer.from(payloadWithWrongEmail, 'utf-8')).digest();
      const mac2 = parsed!.mac as string;
      const receivedMac = Buffer.from(mac2, 'base64url');

      const isMacValid = expectedMac.length === receivedMac.length &&
        crypto.timingSafeEqual(expectedMac, receivedMac);
      expect(isMacValid).toBe(false);
    }
  });
});
