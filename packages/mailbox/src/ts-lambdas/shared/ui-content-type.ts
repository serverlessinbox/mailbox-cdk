import mime from 'mime-types';

export function guessContentType(key: string): string | undefined {
  const contentType = mime.lookup(key);
  if (!contentType) {
    return undefined;
  }

  // Add charset for text-based content types
  if (contentType.startsWith('text/') || contentType === 'application/javascript' || contentType === 'application/json') {
    return `${contentType}; charset=utf-8`;
  }

  return contentType;
}
