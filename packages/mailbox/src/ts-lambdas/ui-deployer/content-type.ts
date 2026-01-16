import { posix as pathPosix } from 'node:path';

export function guessContentType(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';

  // Fallback: use the extension for a tiny bit of signal during debugging.
  // (Still returns undefined for unknown types; S3 will serve as application/octet-stream.)
  const ext = pathPosix.extname(lower);
  if (ext === '') return undefined;
  return undefined;
}
