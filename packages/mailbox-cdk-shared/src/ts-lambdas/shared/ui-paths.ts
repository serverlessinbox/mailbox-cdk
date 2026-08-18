import { posix as pathPosix } from 'node:path';

export function normalizeRelativeKey(input: string): string {
  const trimmed = (input ?? '').toString().trim();
  const withoutLeading = trimmed.replace(/^\/+/, '');
  const normalized = pathPosix.normalize(withoutLeading);

  // Prevent path traversal and Windows drive letters.
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes(':')) {
    throw new Error(`Invalid relative key: ${input}`);
  }

  return normalized;
}

export function normalizePrefix(prefix: string, defaultPrefix: string): string {
  const raw = String(prefix ?? defaultPrefix);
  const trimmed = raw.trim();
  if (!trimmed) return defaultPrefix;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
