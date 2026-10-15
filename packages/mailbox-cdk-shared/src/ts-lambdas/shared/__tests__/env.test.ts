/**
 * Pins the failure policies of the config loaders (throw once, return the problem, throw from a smoke-test check),
 * the typed accessors that record a parse failure instead of throwing, and the stock parsers. The parsers decide
 * what a Lambda accepts from its environment, so a looser parser starts a Lambda on a value it should refuse.
 */

import * as t from 'typanion';
import {
  mustLoad,
  tryLoad,
  check,
  mandatoryAs,
  optionalAs,
  json,
  commaList,
  positiveInt,
  days,
  onOff,
  enumOf,
} from '../env';

describe('env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('mustLoad', () => {
    it('throws once naming every problem', () => {
      delete process.env.VAR1;
      process.env.VAR2 = '';

      expect(() =>
        mustLoad((l) => {
          l.mandatory('VAR1');
          l.mandatory('VAR2');
        }),
      ).toThrow('config validation failed: VAR1 is not set; VAR2 is not set');
    });

    it('throws when a typed variable does not parse', () => {
      process.env.PORT = 'not-a-number';

      expect(() => mustLoad((l) => mandatoryAs(l, 'PORT', positiveInt, 0))).toThrow(/config validation failed: PORT: expected positive integer/);
    });

    it('returns the loaded config when it is valid', () => {
      process.env.USER_NAME = 'alice';
      delete process.env.ROLE;

      const result = mustLoad((l) => ({ user: l.mandatory('USER_NAME'), role: l.optional('ROLE', 'user') }));

      expect(result).toEqual({ user: 'alice', role: 'user' });
    });
  });

  describe('tryLoad', () => {
    it('returns the config beside a message naming every problem, without throwing', () => {
      delete process.env.A;
      delete process.env.B;

      const { config, error } = tryLoad((l) => ({ a: l.mandatory('A'), b: l.mandatory('B') }));

      expect(config).toEqual({ a: '', b: '' });
      expect(error).toBe('A is not set; B is not set');
    });

    it('returns no error when the config is valid', () => {
      process.env.HOST = 'localhost';

      const { config, error } = tryLoad((l) => ({ host: l.mandatory('HOST') }));

      expect(error).toBeUndefined();
      expect(config).toEqual({ host: 'localhost' });
    });
  });

  describe('check', () => {
    it('returns a check that throws when the config is invalid', () => {
      delete process.env.DB_URL;

      const configCheck = check((l) => l.mandatory('DB_URL'));

      expect(() => configCheck()).toThrow('config validation failed: DB_URL is not set');
    });

    it('returns a check that passes when the config is valid', () => {
      process.env.DB_URL = 'postgres://localhost';

      const configCheck = check((l) => l.mandatory('DB_URL'));

      expect(() => configCheck()).not.toThrow();
    });
  });

  describe('mandatoryAs', () => {
    it('parses the variable', () => {
      process.env.COUNT = '42';

      expect(tryLoad((l) => mandatoryAs(l, 'COUNT', positiveInt, 0))).toEqual({ config: 42, error: undefined });
    });

    it('records the parse failure against the variable and returns whenInvalid', () => {
      process.env.COUNT = 'abc';

      expect(tryLoad((l) => mandatoryAs(l, 'COUNT', positiveInt, -1))).toEqual({
        config: -1,
        error: 'COUNT: expected positive integer, got "abc"',
      });
    });

    it('records one problem and returns whenInvalid when the variable is not set', () => {
      delete process.env.COUNT;

      expect(tryLoad((l) => mandatoryAs(l, 'COUNT', positiveInt, -1))).toEqual({ config: -1, error: 'COUNT is not set' });
    });

    it('records the message of a parser that throws something that is not an Error', () => {
      process.env.COUNT = '1';
      const parseThrowingText = (): number => {
        throw 'plain text';
      };

      expect(tryLoad((l) => mandatoryAs(l, 'COUNT', parseThrowingText, -1)).error).toBe('COUNT: plain text');
    });
  });

  describe('optionalAs', () => {
    it('returns the fallback and records nothing when the variable is not set', () => {
      delete process.env.COUNT;

      expect(tryLoad((l) => optionalAs(l, 'COUNT', 99, positiveInt))).toEqual({ config: 99, error: undefined });
    });

    it('parses the variable when it is set', () => {
      process.env.COUNT = '42';

      expect(tryLoad((l) => optionalAs(l, 'COUNT', 0, positiveInt))).toEqual({ config: 42, error: undefined });
    });

    it('reports a malformed value and returns the fallback', () => {
      process.env.COUNT = 'abc';

      expect(tryLoad((l) => optionalAs(l, 'COUNT', 8080, positiveInt))).toEqual({
        config: 8080,
        error: 'COUNT: expected positive integer, got "abc"',
      });
    });
  });

  describe('json', () => {
    const parseConfig = json(t.isObject({ name: t.isString(), version: t.isNumber() }));

    it('returns JSON that satisfies the validator', () => {
      expect(parseConfig('{"name":"app","version":1}')).toEqual({ name: 'app', version: 1 });
    });

    it('throws on text that is not JSON', () => {
      expect(() => parseConfig('not json')).toThrow(/^invalid JSON: /);
    });

    it('throws with the validator errors when the JSON has the wrong shape', () => {
      expect(() => parseConfig('{"name":123,"version":1}')).toThrow(/^schema validation failed: .*\.name/);
    });
  });

  describe('commaList', () => {
    it('splits on commas and trims each element', () => {
      expect(commaList('a, b,  c,d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('accepts a single element', () => {
      expect(commaList('single')).toEqual(['single']);
    });

    it.each(['', '   ', 'a,,b', 'a, ,b'])('rejects %j', (raw) => {
      expect(() => commaList(raw)).toThrow(`expected comma-separated list, got "${raw}"`);
    });
  });

  describe('positiveInt', () => {
    it('parses a positive integer, ignoring surrounding whitespace', () => {
      expect(positiveInt('42')).toBe(42);
      expect(positiveInt(' 7 ')).toBe(7);
    });

    it.each(['0', '-1', 'abc', '3.14', '', '1x', '0x10', '1e3', '01'])('rejects %j', (raw) => {
      expect(() => positiveInt(raw)).toThrow(`expected positive integer, got "${raw}"`);
    });
  });

  describe('days', () => {
    it('converts a number of days to milliseconds', () => {
      expect(days('7')).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('rejects zero like positiveInt', () => {
      expect(() => days('0')).toThrow(/expected positive integer/);
    });
  });

  describe('onOff', () => {
    it('maps on to true and off to false', () => {
      expect(onOff('on')).toBe(true);
      expect(onOff('off')).toBe(false);
    });

    it.each(['', 'true', '1', 'false', '0', 'ON', 'OFF'])('rejects %j', (raw) => {
      expect(() => onOff(raw)).toThrow(`expected 'on' or 'off', got "${raw}"`);
    });
  });

  describe('enumOf', () => {
    it('returns an allowed value', () => {
      expect(enumOf('dev', 'prod', 'staging')('prod')).toBe('prod');
    });

    it.each(['test', 'DEV'])('rejects %j, case-sensitively', (raw) => {
      expect(() => enumOf('dev', 'prod')(raw)).toThrow(`expected one of [dev, prod], got "${raw}"`);
    });
  });
});
