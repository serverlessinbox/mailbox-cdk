/**
 * Pins the blob id wire format the authorizer maps to S3 keys: the base64url decoding, the split of an id into
 * entity, path and MAC, and the path check. Loosening the path check lets a crafted id read outside its prefix;
 * taking the MAC from the first colon instead of the last mis-parses every filename that contains one.
 */

import { toEncodedBlobId } from '../blob-id';
import { BlobIdFormat } from '../blob-id-format';
import { decodedBlobIdOf, encodedBlobIdOf } from './blob-authorizer-helpers';

describe('BlobIdFormat.decode', () => {
  it('decodes the unpadded base64url form back to the id', () => {
    const decoded = 'eml:emailID12345:original.eml';

    expect(BlobIdFormat.decode(encodedBlobIdOf(decoded))).toBe(decoded);
  });

  it('decodes the url-safe characters a standard base64 alphabet would write as + and /', () => {
    const decoded = 'prn:p?>>:a.png';
    const encoded = encodedBlobIdOf(decoded);

    expect(encoded).toMatch(/[-_]/);
    expect(BlobIdFormat.decode(encoded)).toBe(decoded);
  });

  it.each([
    ['an empty id', ''],
    ['characters outside the base64url alphabet', '!!!invalid base64!!!'],
    ['padding', 'ZW1sOnRlc3Q='],
    ['a standard-alphabet slash', 'ab/c'],
  ])('has no decoded form for %s', (_name, encoded) => {
    expect(BlobIdFormat.decode(toEncodedBlobId(encoded))).toBeNull();
  });
});

describe('BlobIdFormat.parse', () => {
  it('splits an email id into entity, path and MAC', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('eml:emailID123:document.pdf:dGVzdG1hY2RhdGE'))).toEqual({
      type: 'email',
      entityId: 'emailID123',
      path: 'document.pdf',
      mac: 'dGVzdG1hY2RhdGE',
    });
  });

  it('takes the MAC of an email id from the last colon, so a path may contain colons', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('eml:emailID:my:file:with:colons.pdf:dGVzdG1hYzI'))).toEqual({
      type: 'email',
      entityId: 'emailID',
      path: 'my:file:with:colons.pdf',
      mac: 'dGVzdG1hYzI',
    });
  });

  it('parses an email id issued without a MAC to a null MAC', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('eml:emailID789:document.pdf'))).toEqual({
      type: 'email',
      entityId: 'emailID789',
      path: 'document.pdf',
      mac: null,
    });
  });

  it('parses an email id that ends in a colon to an empty MAC, not to a null one', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('eml:emailID:document.pdf:'))).toEqual({
      type: 'email',
      entityId: 'emailID',
      path: 'document.pdf',
      mac: '',
    });
  });

  it('parses a contact id with the whole remainder as its path', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('cnt:cardID:path:with:many:colons.jpg'))).toEqual({
      type: 'contact',
      entityId: 'cardID',
      path: 'path:with:many:colons.jpg',
    });
  });

  it('parses a principal id with the whole remainder as its path', () => {
    expect(BlobIdFormat.parse(decodedBlobIdOf('prn:principalID:avatar:2.png'))).toEqual({
      type: 'principal',
      entityId: 'principalID',
      path: 'avatar:2.png',
    });
  });

  it.each([
    ['an unknown prefix', 'xyz:entityId:path'],
    ['an email id without a path separator', 'eml:onlyEntityId'],
    ['a contact id without a path separator', 'cnt:onlyEntityId'],
    ['a principal id without a path separator', 'prn:onlyEntityId'],
  ])('has no parsed form for %s', (_name, decoded) => {
    expect(BlobIdFormat.parse(decodedBlobIdOf(decoded))).toBeNull();
  });
});

describe('BlobIdFormat.isSafePath', () => {
  it.each(['document.pdf', 'file-name_123.txt', 'file:with:colons.pdf', 'file.with.dots', '...'])(
    'accepts %s',
    (path) => {
      expect(BlobIdFormat.isSafePath(path)).toBe(true);
    },
  );

  it.each([
    ['an empty path', ''],
    ['a forward slash', 'path/to/file.pdf'],
    ['a leading forward slash', '/file.pdf'],
    ['a backslash', 'path\\to\\file.pdf'],
    ['a parent directory', '..'],
    ['a traversal', '../../etc/passwd'],
    ['a null character', 'file\x00.pdf'],
    ['a unit separator, the last control character', 'file\x1f.pdf'],
    ['a line feed', 'file\n.pdf'],
  ])('rejects %s', (_name, path) => {
    expect(BlobIdFormat.isSafePath(path)).toBe(false);
  });

  it('accepts the space, the first character after the control range', () => {
    expect(BlobIdFormat.isSafePath('my file.pdf')).toBe(true);
  });
});
