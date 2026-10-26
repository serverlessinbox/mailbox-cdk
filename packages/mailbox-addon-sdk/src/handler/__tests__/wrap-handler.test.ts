import * as t                       from 'typanion';

import { authorizedEvent }          from '../../__tests__/authorized-event-helpers';
import type { HandlerContext }      from '../../caller/index';
import type { JsonValue }           from '../../json/index';
import { wrapHandler }              from '../wrap-handler';

import { loggerDouble, sinkDouble } from './handler-helpers';

/*
 * Pins what a free-form plugin gets from `wrapHandler`: its work runs only for a body that passes its schema,
 * and the request is audited as the path it reached. A body that reaches the work unchecked, or an audit event
 * without the endpoint, are defects of every plugin that uses it.
 */

const isCreateThing = t.isObject({ name: t.cascade(t.isString(), [t.hasMinLength(1)]) });

type CreateThing = t.InferType<typeof isCreateThing>;

type RunDouble = jest.Mock<Promise<JsonValue>, [HandlerContext, CreateThing]>;

function wrapped(run: RunDouble = jest.fn<Promise<JsonValue>, [HandlerContext, CreateThing]>().mockResolvedValue({ id: 'thing-1' })): {
  readonly handler: ReturnType<typeof wrapHandler>;
  readonly run:     RunDouble;
  readonly sink:    ReturnType<typeof sinkDouble>;
} {
  const sink = sinkDouble();
  return { handler: wrapHandler(isCreateThing, run, sink, loggerDouble()), run, sink };
}

describe('wrapHandler', () => {
  it('runs the work with the validated body and answers its result as JSON', async () => {
    const { handler, run } = wrapped();

    const result = await handler(authorizedEvent({ path: '/things/create', body: '{"name":"widget"}' }));

    expect(result).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"id":"thing-1"}' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-1' }), { name: 'widget' });
  });

  it('answers 400 with the field-level errors for a body that fails the schema, without running the work', async () => {
    const { handler, run } = wrapped();

    const result = await handler(authorizedEvent({ path: '/things/create', body: '{"name":""}' }));

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatch(/^invalid request body: .*\.name/);
    expect(run).not.toHaveBeenCalled();
  });

  it('records the audit of the work as the first path segment and the path without its leading slash', async () => {
    const recording: RunDouble = jest.fn<Promise<JsonValue>, [HandlerContext, CreateThing]>().mockImplementation(async (context, body) => {
      await context.recordAudit({ status: 'success', entityId: body.name });
      return {};
    });
    const { handler, sink }    = wrapped(recording);

    await handler(authorizedEvent({ path: '/things/create', body: '{"name":"widget"}' }));

    expect(sink.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'things', action: 'things/create', entityId: 'widget' }));
  });
});
