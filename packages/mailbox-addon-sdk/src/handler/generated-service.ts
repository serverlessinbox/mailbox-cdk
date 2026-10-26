import type { DescMessage, Message, MessageShape } from '@bufbuild/protobuf';

import type { HandlerContext }                     from '../caller/handler-context';

/** The part of one method of a generated `<Service>ServiceRuntime` const that `wrapService` reads. */
export interface GeneratedMethod {
  /** The last path segment the method is served on, for example `ListIdpUsers`. */
  readonly name:           string;
  /** The key of the method on the handlers object, for example `listIdpUsers`. */
  readonly handlerName:    string;
  readonly requestSchema:  DescMessage;
  readonly responseSchema: DescMessage;
}

/** The methods of a generated service by their `name`. */
export interface GeneratedMethods {
  readonly [name: string]: GeneratedMethod;
}

/** The part of a generated `<Service>ServiceRuntime` const that `wrapService` reads. */
export interface GeneratedService {
  /** Names the entity type of the audit events; it is never matched against the request path. */
  readonly basePath:    string;
  readonly serviceName: string;
  readonly methods:     GeneratedMethods;
}

type MethodOf<Service extends GeneratedService> = Service['methods'][keyof Service['methods']];

/**
 * The handlers object a service must supply: one function per method of the generated runtime const, taking
 * the request message and answering the response message.
 */
export type ServiceHandlersOf<Service extends GeneratedService> = {
  readonly [Method in MethodOf<Service> as Method['handlerName']]:
  (context: HandlerContext, request: MessageShape<Method['requestSchema']>) => Promise<MessageShape<Method['responseSchema']>>;
};

/** One handler as the routes call it, once the generic signature of `wrapService` has checked the real types. */
export type MessageHandler = (context: HandlerContext, request: Message) => Promise<Message>;

/** The handlers object as the routes index it, by the `handlerName` of a method. */
export type MessageHandlers = Readonly<Record<string, MessageHandler>>;
