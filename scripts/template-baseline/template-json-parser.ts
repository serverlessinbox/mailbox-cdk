import { isJsonObject } from './json-value';
import type { JsonObject } from './json-value';

/**
 * Turns the JSON text of a CloudFormation template into a typed {@link JsonObject}. It does not
 * interpret the template: it only guarantees the text is a JSON object, so callers never handle
 * an untyped parse result.
 */
export class TemplateJsonParser {
  /** Throws, naming `origin`, when the text is not valid JSON or not a JSON object. */
  parse(text: string, origin: string): JsonObject {
    const document: unknown = this.parseJson(text, origin);

    const errors: string[] = [];
    if (!isJsonObject(document, { errors })) {
      throw new Error(`${origin} is not a JSON object: ${errors.join('; ')}`);
    }
    return document;
  }

  private parseJson(text: string, origin: string): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${origin} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
