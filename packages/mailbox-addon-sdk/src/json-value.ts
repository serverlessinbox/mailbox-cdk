/** Any value `JSON.parse` can return. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
