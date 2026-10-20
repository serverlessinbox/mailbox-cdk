import * as t             from 'typanion';

import type { JsonValue } from './api-gateway';

/**
 * Reads the body of a request as JSON. A missing or empty body reads as an empty object; a body that is not
 * JSON is an error, and what was parsed is checked to be a `JsonValue` before it is handed on.
 */
export class JsonBodyReader {
  private readonly isJsonValue: t.StrictValidator<unknown, JsonValue>;
  private readonly isJsonShape: t.StrictValidator<unknown, JsonValue>;

  constructor() {
    this.isJsonValue = t.makeValidator({
      test: (value, state): value is JsonValue => this.isJsonShape(value, state),
    });
    this.isJsonShape = t.isOneOf([
      t.isLiteral(null),
      t.isBoolean(),
      t.isNumber(),
      t.isString(),
      // typanion's isRecord accepts an array as well as an object, and checks each element or property.
      t.isRecord(this.isJsonValue),
    ]);
  }

  public read(body: string | null | undefined): JsonValue {
    if (!body) {return {};}

    const parsed: unknown = this.parse(body);
    t.assert(parsed, this.isJsonValue);
    return parsed;
  }

  private parse(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('invalid JSON body');
    }
  }
}
