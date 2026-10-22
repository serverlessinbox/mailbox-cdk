/// <reference types="jest" />

/**
 * Pins the strict parse of a configured log level: a mistyped `LOG_LEVEL` must be reported, never fall back to a
 * default level, because a quiet fallback leaves a deployment degraded for its whole life.
 */

import { parseLogLevelStrict } from '../log-level';

describe('parseLogLevelStrict', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)('parses %s', (level) => {
    expect(parseLogLevelStrict(level)).toBe(level);
  });

  it('parses levels case-insensitively', () => {
    expect(parseLogLevelStrict('DEBUG')).toBe('debug');
    expect(parseLogLevelStrict('WaRn')).toBe('warn');
  });

  it.each(['verbose', 'trace', '1', ''])('rejects the level string %j', (raw) => {
    expect(() => parseLogLevelStrict(raw)).toThrow(`Invalid log level: '${raw}' is not one of debug, info, warn, error`);
  });

  it.each([123, null, undefined])('rejects the non-string value %p', (raw) => {
    expect(() => {
      Reflect.apply(parseLogLevelStrict, undefined, [raw]);
    }).toThrow(/expected string/);
  });
});
