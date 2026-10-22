/**
 * Pins the blob id wire format the authorizer maps to S3 keys: the base64url decoding, the split of an id into
 * entity, path and MAC, and the path check. Loosening the path check lets a crafted id read outside its prefix;
 * taking the MAC from the first colon instead of the last mis-parses every filename that contains one.
 */

import { decodedBlobIdOf, encodedBlobIdOf }          from '../../__tests__/jmap-blob-download-helpers';
import { decodeBlobId, isSafeBlobPath, parseBlobId } from '../blob-id-format';
import { toEncodedBlobId }                           from '../blob-id';

describe('decodeBlobId', () => {
  it('decodes the unpadded base64url form back to the id', () => {
    const decoded = 'eml:emailID12345:original.eml';

    expect(decodeBlobId(encodedBlobIdOf(decoded))).toBe(decoded);
  });

  it('decodes the url-safe characters a standard base64 alphabet would write as + and /', () => {
    const decoded = 'prn:p?>>:a.png';
    const encoded = encodedBlobIdOf(decoded);

    expect(encoded).toMatch(/[-_]/);
    expect(decodeBlobId(encoded)).toBe(decoded);
  });

  it.each([
    { input: 'an empty id', encoded: '' },
    { input: 'characters outside the base64url alphabet', encoded: '!!!invalid base64!!!' },
    { input: 'padding', encoded: 'ZW1sOnRlc3Q=' },
    { input: 'a standard-alphabet slash', encoded: 'ab/c' },
  ])('has no decoded form for $input', ({ encoded }) => {
    expect(decodeBlobId(toEncodedBlobId(encoded))).toBeNull();
  });
});

describe('parseBlobId', () => {
  it('splits an email id into entity, path and MAC', () => {
    expect(parseBlobId(decodedBlobIdOf('eml:emailID123:document.pdf:dGVzdG1hY2RhdGE'))).toEqual({
      type:     'email',
      entityId: 'emailID123',
      path:     'document.pdf',
      mac:      'dGVzdG1hY2RhdGE',
    });
  });

  it('takes the MAC of an email id from the last colon, so a path may contain colons', () => {
    expect(parseBlobId(decodedBlobIdOf('eml:emailID:my:file:with:colons.pdf:dGVzdG1hYzI'))).toEqual({
      type:     'email',
      entityId: 'emailID',
      path:     'my:file:with:colons.pdf',
      mac:      'dGVzdG1hYzI',
    });
  });

  it('parses an email id issued without a MAC to a null MAC', () => {
    expect(parseBlobId(decodedBlobIdOf('eml:emailID789:document.pdf'))).toEqual({
      type:     'email',
      entityId: 'emailID789',
      path:     'document.pdf',
      mac:      null,
    });
  });

  it('parses an email id that ends in a colon to an empty MAC, not to a null one', () => {
    expect(parseBlobId(decodedBlobIdOf('eml:emailID:document.pdf:'))).toEqual({
      type:     'email',
      entityId: 'emailID',
      path:     'document.pdf',
      mac:      '',
    });
  });

  it('parses a contact id with the whole remainder as its path', () => {
    expect(parseBlobId(decodedBlobIdOf('cnt:cardID:path:with:many:colons.jpg'))).toEqual({
      type:     'contact',
      entityId: 'cardID',
      path:     'path:with:many:colons.jpg',
    });
  });

  it('parses a principal id with the whole remainder as its path', () => {
    expect(parseBlobId(decodedBlobIdOf('prn:principalID:avatar:2.png'))).toEqual({
      type:     'principal',
      entityId: 'principalID',
      path:     'avatar:2.png',
    });
  });

  it.each([
    { input: 'an unknown prefix', decoded: 'xyz:entityId:path' },
    { input: 'an email id without a path separator', decoded: 'eml:onlyEntityId' },
    { input: 'a contact id without a path separator', decoded: 'cnt:onlyEntityId' },
    { input: 'a principal id without a path separator', decoded: 'prn:onlyEntityId' },
  ])('has no parsed form for $input', ({ decoded }) => {
    expect(parseBlobId(decodedBlobIdOf(decoded))).toBeNull();
  });
});

describe('isSafeBlobPath', () => {
  it.each(['document.pdf', 'file-name_123.txt', 'file:with:colons.pdf', 'file.with.dots', '...'])(
    'accepts %s',
    (path) => {
      expect(isSafeBlobPath(path)).toBe(true);
    },
  );

  it.each([
    { input: 'an empty path', path: '' },
    { input: 'a forward slash', path: 'path/to/file.pdf' },
    { input: 'a leading forward slash', path: '/file.pdf' },
    { input: 'a backslash', path: 'path\\to\\file.pdf' },
    { input: 'a parent directory', path: '..' },
    { input: 'a traversal', path: '../../etc/passwd' },
    { input: 'a null character', path: 'file\x00.pdf' },
    { input: 'a unit separator, the last control character', path: 'file\x1f.pdf' },
    { input: 'a line feed', path: 'file\n.pdf' },
  ])('rejects $input', ({ path }) => {
    expect(isSafeBlobPath(path)).toBe(false);
  });

  it('accepts the space, the first character after the control range', () => {
    expect(isSafeBlobPath('my file.pdf')).toBe(true);
  });
});
