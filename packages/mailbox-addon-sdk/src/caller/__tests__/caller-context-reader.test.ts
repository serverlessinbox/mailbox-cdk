import { ADMIN_CONTEXT, authorizedEvent }        from '../../__tests__/authorized-event-helpers';
import { UnauthenticatedError }                  from '../../errors';
import { CallerContextReader }                   from '../caller-context-reader';

/*
 * Pins how the authorizer's flat context becomes a caller. A request without a tenant or a subject must be
 * refused as unauthenticated, and a context that is not shaped as the authorizer writes it must fail as an
 * ordinary error: the first is answered 401, the second 500 with a flushed trace, and swapping them either
 * hides a broken deployment behind a 401 or turns an anonymous request into a server error.
 */

function readWith(context: Readonly<Record<string, unknown>>): ReturnType<CallerContextReader['read']> {
  return new CallerContextReader().read(authorizedEvent({ context }));
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (thrown) {
    return thrown;
  }
  throw new Error('expected the action to throw');
}

describe('CallerContextReader', () => {
  it('reads the tenant, subject, username and groups of the context', () => {
    expect(readWith(ADMIN_CONTEXT)).toEqual({ tenantId: 'tenant-1', subject: 'user-1', username: 'jane', groups: ['admin'] });
  });

  it('reads a caller without a username', () => {
    expect(readWith({ ...ADMIN_CONTEXT, username: undefined }).username).toBeUndefined();
  });

  it('reads no groups when the context has none', () => {
    expect(readWith({ ...ADMIN_CONTEXT, groups: undefined }).groups).toEqual([]);
  });

  it.each([
    ['no tenant', { ...ADMIN_CONTEXT, tenantId: undefined }],
    ['an empty tenant', { ...ADMIN_CONTEXT, tenantId: '' }],
    ['no subject', { ...ADMIN_CONTEXT, sub: undefined }],
    ['an empty subject', { ...ADMIN_CONTEXT, sub: '' }],
    ['an anonymous context', { userId: '', authType: 'anonymous' }],
  ])('refuses a context with %s as unauthenticated', (_title, context) => {
    expect(thrownBy(() => readWith(context))).toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses an event without an authorizer context as unauthenticated', () => {
    const event = authorizedEvent();
    Reflect.set(event.requestContext, 'authorizer', undefined);

    expect(thrownBy(() => new CallerContextReader().read(event))).toBeInstanceOf(UnauthenticatedError);
  });

  it.each([
    ['a tenant that is not a string', { ...ADMIN_CONTEXT, tenantId: 7 }, 'malformed authorizer context'],
    ['groups that are not JSON', { ...ADMIN_CONTEXT, groups: 'admin' }, 'groups is not JSON'],
    ['groups that are not an array of strings', { ...ADMIN_CONTEXT, groups: '[1]' }, 'malformed authorizer context: groups'],
  ])('fails on %s as an ordinary error, not as unauthenticated', (_title, context, message) => {
    const thrown = thrownBy(() => readWith(context));

    expect(thrown).not.toBeInstanceOf(UnauthenticatedError);
    expect(thrown instanceof Error ? thrown.message : '').toContain(message);
  });
});
