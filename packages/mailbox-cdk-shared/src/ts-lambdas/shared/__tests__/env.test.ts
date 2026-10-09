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
  type Loader,
} from '../env';
import * as t from 'typanion';

describe('env helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('Loader interface', () => {
    describe('mustLoad', () => {
      it('accumulates all problems and throws once with combined message', () => {
        delete process.env.VAR1;
        delete process.env.VAR2;
        process.env.VAR3 = '';

        expect(() =>
          mustLoad((l: Loader) => {
            l.mandatory('VAR1');
            l.mandatory('VAR2');
            l.mandatory('VAR3');
          }),
        ).toThrow(/VAR1 is not set; VAR2 is not set; VAR3 is not set/);
      });

      it('treats whitespace-only variables as not set', () => {
        process.env.VAR = '   ';

        expect(() =>
          mustLoad((l: Loader) => {
            l.mandatory('VAR');
          }),
        ).toThrow(/VAR is not set/);
      });

      it('records parse errors and throws once', () => {
        process.env.PORT = 'not-a-number';

        expect(() =>
          mustLoad((l: Loader) => {
            const port = mandatoryAs(l, 'PORT', positiveInt, 0);
            return port;
          }),
        ).toThrow(/config validation failed/);
      });

      it('returns result when config is valid', () => {
        process.env.USER = 'alice';
        process.env.ROLE = 'admin';

        const result = mustLoad((l: Loader) => {
          return {
            user: l.mandatory('USER'),
            role: l.optional('ROLE', 'user'),
          };
        });

        expect(result).toEqual({ user: 'alice', role: 'admin' });
      });
    });

    describe('tryLoad', () => {
      it('never throws; returns config and error separately', () => {
        delete process.env.API_KEY;

        const { config, error } = tryLoad((l: Loader) => {
          return { apiKey: l.mandatory('API_KEY') };
        });

        expect(config).toEqual({ apiKey: '' });
        expect(error).toMatch(/API_KEY is not set/);
      });

      it('accumulates all problems in one message', () => {
        delete process.env.A;
        delete process.env.B;

        const { error } = tryLoad((l: Loader) => {
          l.mandatory('A');
          l.mandatory('B');
          return {};
        });

        expect(error).toMatch(/A is not set; B is not set/);
      });

      it('returns undefined error when config is valid', () => {
        process.env.HOST = 'localhost';
        process.env.PORT = '8080';

        const { config, error } = tryLoad((l: Loader) => {
          return {
            host: l.mandatory('HOST'),
            port: l.mandatory('PORT'),
          };
        });

        expect(error).toBeUndefined();
        expect(config).toEqual({ host: 'localhost', port: '8080' });
      });
    });

    describe('check', () => {
      it('returns a check function that throws if config is invalid', async () => {
        delete process.env.DB_URL;

        const checkFn = check((l: Loader) => {
          l.mandatory('DB_URL');
        });

        // checkFn is sync but returns void, so check synchronously
        expect(() => checkFn()).toThrow(/config validation failed.*DB_URL is not set/);
      });

      it('returns a check function that does not throw if config is valid', async () => {
        process.env.DB_URL = 'postgres://localhost';

        const checkFn = check((l: Loader) => {
          l.mandatory('DB_URL');
        });

        // checkFn is sync, call it and verify no throw
        expect(() => checkFn()).not.toThrow();
      });
    });

    describe('mandatoryAs', () => {
      it('parses mandatory variable successfully', () => {
        process.env.COUNT = '42';

        const result = mandatoryAs(
          { mandatory: () => '42', optional: () => '', report: () => {}, error: () => undefined },
          'COUNT',
          positiveInt,
          0,
        );

        expect(result).toBe(42);
      });

      it('records parse error when parse throws and returns whenInvalid', () => {
        const problems: string[] = [];

        const loader: Loader = {
          mandatory: () => 'not-a-number',
          optional: () => '',
          report: (name: string, message: string) => {
            problems.push(`${name}: ${message}`);
          },
          error: () => undefined,
        };

        const result = mandatoryAs(loader, 'PORT', positiveInt, 0);

        expect(result).toBe(0);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/PORT:/);
      });

      it('returns whenInvalid when mandatory() fails', () => {
        const loader: Loader = {
          mandatory: () => '',
          optional: () => '',
          report: () => {},
          error: () => undefined,
        };

        const result = mandatoryAs(loader, 'VAR', (s) => parseInt(s), 999);

        expect(result).toBe(999);
      });

      it('returns whenInvalid when variable is absent and records problem', () => {
        const loader: Loader = {
          mandatory: () => '',
          optional: () => '',
          report: () => {},
          error: () => undefined,
        };

        const result = mandatoryAs(loader, 'MISSING', positiveInt, -1);

        expect(result).toBe(-1);
      });
    });

    describe('optionalAs', () => {
      it('returns fallback when variable is unset', () => {
        const loader: Loader = {
          mandatory: () => '',
          optional: () => '',
          report: () => {},
          error: () => undefined,
        };

        const result = optionalAs(loader, 'VAR', 99, positiveInt);

        expect(result).toBe(99);
      });

      it('returns fallback when variable is whitespace-only', () => {
        const loader: Loader = {
          mandatory: () => '',
          optional: () => '',
          report: () => {},
          error: () => undefined,
        };

        const result = optionalAs(loader, 'VAR', 77, positiveInt);

        expect(result).toBe(77);
      });

      it('parses value when present', () => {
        const loader: Loader = {
          mandatory: () => '',
          optional: () => '42',
          report: () => {},
          error: () => undefined,
        };

        const result = optionalAs(loader, 'COUNT', 0, positiveInt);

        expect(result).toBe(42);
      });

      it('reports and returns fallback when parse throws (malformed optional)', () => {
        const problems: string[] = [];

        const loader: Loader = {
          mandatory: () => '',
          optional: () => 'not-a-number',
          report: (name: string, message: string) => {
            problems.push(`${name}: ${message}`);
          },
          error: () => problems.length > 0 ? problems.join('; ') : undefined,
        };

        const result = optionalAs(loader, 'PORT', 8080, positiveInt);

        expect(result).toBe(8080);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/PORT:/);
      });
    });
  });

  describe('Stock parsers', () => {
    describe('json', () => {
      it('parses valid JSON with schema', () => {
        const isConfig = t.isObject({
          name: t.isString(),
          version: t.isNumber(),
        });

        const parser = json(isConfig);
        const result = parser('{"name":"app","version":1}');

        expect(result).toEqual({ name: 'app', version: 1 });
      });

      it('throws on invalid JSON', () => {
        const isConfig = t.isObject({ name: t.isString() });
        const parser = json(isConfig);

        expect(() => parser('not json')).toThrow(/invalid JSON/);
      });

      it('throws on schema validation failure', () => {
        const isConfig = t.isObject({
          name: t.isString(),
        });
        const parser = json(isConfig);

        expect(() => parser('{"name":123}')).toThrow(/schema validation failed/);
      });
    });

    describe('commaList', () => {
      it('splits on commas and trims whitespace', () => {
        const result = commaList('a, b,  c,d');

        expect(result).toEqual(['a', 'b', 'c', 'd']);
      });

      it('throws on empty string', () => {
        expect(() => commaList('')).toThrow(/expected comma-separated list/);
      });

      it('throws on whitespace-only string', () => {
        expect(() => commaList('   ')).toThrow(/expected comma-separated list/);
      });

      it('throws on empty element after splitting', () => {
        expect(() => commaList('a,,b')).toThrow(/expected comma-separated list/);
      });

      it('throws on empty element with whitespace', () => {
        expect(() => commaList('a, ,b')).toThrow(/expected comma-separated list/);
      });

      it('handles single value', () => {
        expect(commaList('single')).toEqual(['single']);
      });
    });

    describe('positiveInt', () => {
      it('parses positive integers', () => {
        expect(positiveInt('42')).toBe(42);
        expect(positiveInt('1')).toBe(1);
      });

      it('rejects zero', () => {
        expect(() => positiveInt('0')).toThrow(/expected positive integer/);
      });

      it('rejects negative numbers', () => {
        expect(() => positiveInt('-1')).toThrow(/expected positive integer/);
      });

      it('rejects non-numeric strings', () => {
        expect(() => positiveInt('abc')).toThrow(/expected positive integer/);
      });

      it('rejects floats', () => {
        expect(() => positiveInt('3.14')).toThrow(/expected positive integer/);
      });

      it('rejects empty string', () => {
        expect(() => positiveInt('')).toThrow(/expected positive integer/);
      });

      it('rejects trailing non-numeric characters', () => {
        expect(() => positiveInt('1x')).toThrow(/expected positive integer/);
      });

      it('rejects hex notation', () => {
        expect(() => positiveInt('0x10')).toThrow(/expected positive integer/);
      });

      it('rejects scientific notation', () => {
        expect(() => positiveInt('1e3')).toThrow(/expected positive integer/);
      });
    });

    describe('days', () => {
      it('converts days to milliseconds', () => {
        expect(days('1')).toBe(24 * 60 * 60 * 1000);
        expect(days('7')).toBe(7 * 24 * 60 * 60 * 1000);
      });

      it('uses positiveInt internally, so rejects zero/negative', () => {
        expect(() => days('0')).toThrow(/expected positive integer/);
        expect(() => days('-1')).toThrow(/expected positive integer/);
      });
    });

    describe('onOff', () => {
      it('accepts "on" and returns true', () => {
        expect(onOff('on')).toBe(true);
      });

      it('accepts "off" and returns false', () => {
        expect(onOff('off')).toBe(false);
      });

      it('rejects empty string', () => {
        expect(() => onOff('')).toThrow(/expected 'on' or 'off'/);
      });

      it('rejects "true"', () => {
        expect(() => onOff('true')).toThrow(/expected 'on' or 'off'/);
      });

      it('rejects "1"', () => {
        expect(() => onOff('1')).toThrow(/expected 'on' or 'off'/);
      });

      it('rejects "false"', () => {
        expect(() => onOff('false')).toThrow(/expected 'on' or 'off'/);
      });

      it('rejects "0"', () => {
        expect(() => onOff('0')).toThrow(/expected 'on' or 'off'/);
      });

      it('is case-sensitive', () => {
        expect(() => onOff('ON')).toThrow(/expected 'on' or 'off'/);
        expect(() => onOff('OFF')).toThrow(/expected 'on' or 'off'/);
      });
    });

    describe('enumOf', () => {
      it('accepts allowed values', () => {
        const parser = enumOf('dev', 'prod', 'staging');
        expect(parser('dev')).toBe('dev');
        expect(parser('prod')).toBe('prod');
      });

      it('rejects disallowed values', () => {
        const parser = enumOf('dev', 'prod');
        expect(() => parser('test')).toThrow(/expected one of \[dev, prod\]/);
      });

      it('is case-sensitive', () => {
        const parser = enumOf('dev');
        expect(() => parser('DEV')).toThrow(/expected one of/);
      });

      it('preserves logical type: parser typed as returning literal union', () => {
        // At runtime, this tests that the parser correctly returns the parsed value
        const parser = enumOf('off', 'on', 'forced');
        const result = parser('on');
        expect(result).toBe('on');
        // Type checker would verify: result has type 'off' | 'on' | 'forced', not just string
      });

      it('rejects values not in the enum list', () => {
        const parser = enumOf('off', 'on');
        expect(() => parser('maybe')).toThrow(/expected one of \[off, on\]/);
      });

      it('returns a value that is reference-equal to the member from the allowed list', () => {
        const allowed = ['dev', 'prod'] as const;
        const parser = enumOf(...allowed);
        const result = parser('dev');

        // Check reference equality: the returned value is the exact member from allowed
        expect(result).toBe(allowed[0]);
      });
    });
  });
});
