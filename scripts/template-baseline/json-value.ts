import * as t from 'typanion';

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
  t.isArray(isNestedJsonValue),
  t.isRecord(isNestedJsonValue),
]);

const isRecordOfJsonValues = t.isRecord(isJsonValue);

/** Validates an untrusted value as a {@link JsonObject}. `t.isRecord` accepts arrays, so they are rejected explicitly. */
export const isJsonObject: t.StrictValidator<unknown, JsonObject> = t.makeValidator<unknown, JsonObject>({
  test: (value: unknown, state?: t.ValidationState): value is JsonObject => !Array.isArray(value) && isRecordOfJsonValues(value, state),
});
