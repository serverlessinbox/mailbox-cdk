import * as t           from 'typanion';

import { errorMessage } from './error-message';

/** Any value a JSON document can hold. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object whose members are all JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Refers to {@link isJsonValue} from inside its own definition, which a validator cannot name while it is being built. */
const isNestedJsonValue = t.makeValidator<unknown, JsonValue>({
  test: (value, state) => isJsonValue(value, state),
});

/** Validates an untrusted value as a {@link JsonValue}. */
export const isJsonValue: t.StrictValidator<unknown, JsonValue> = t.isOneOf([
  t.isString(),
  t.isNumber(),
  t.isBoolean(),
  t.isLiteral(null),
  t.isRecord(isNestedJsonValue),
]);

const isRecordOfJsonValues = t.isRecord(isJsonValue);

/** Validates an untrusted value as a {@link JsonObject}. `t.isRecord` accepts arrays, so they are rejected explicitly. */
export const isJsonObject: t.StrictValidator<unknown, JsonObject> = t.makeValidator<unknown, JsonObject>({
  test: (value: unknown, state?: t.ValidationState): value is JsonObject => !Array.isArray(value) && isRecordOfJsonValues(value, state),
});

/** Narrows a value already typed as a {@link JsonValue} to a {@link JsonObject}; arrays and `null` are not objects. */
export function isJsonObjectNode(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses JSON text into a {@link JsonObject}. Throws, naming `origin`, when the text is not valid
 * JSON or not a JSON object, so callers never handle an untyped parse result.
 */
export function parseJsonObject(text: string, origin: string): JsonObject {
  const document: unknown = parseJsonText(text, origin);

  const errors: string[] = [];
  if (!isJsonObject(document, { errors })) {
    throw new Error(`${origin} is not a JSON object: ${errors.join('; ')}`);
  }
  return document;
}

function parseJsonText(text: string, origin: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${origin} is not valid JSON: ${errorMessage(error)}`);
  }
}
