import type { HandlerContext } from '../caller/handler-context';
import type { JsonValue }      from '../json-value';

/** One method of a service: whether it needs an admin caller, and how a request body becomes a response. */
export interface ServiceMethod {
  /**
   * Whether only an admin caller may call the method. A method that does not declare it is admin-only; a method
   * open to every authenticated caller declares `false`.
   */
  readonly admin?: boolean;

  /** Validates the body, runs the handler for the caller and returns the response, ready to be written as JSON. */
  invoke(context: HandlerContext, body: JsonValue): Promise<unknown>;
}
