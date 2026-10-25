import type { Caller } from './caller';

/** What a service handler is called with besides the validated request. */
export interface HandlerContext {
  readonly caller:    Caller;
  readonly requestId: string;
}
