import type { HandlerContext } from '../../caller';
import type { AuditEntry }     from '../audit-event';

/*
 * Pins what a service handler may pass to `recordAudit`: how the request ended, the entity it touched and what
 * it changed, and nothing else. The tenant, the actor and the action come from the request; a handler that could
 * write them could attribute its change to someone else. The assertions are compile-time: the suite fails to
 * compile, not to run, when a handler can write another field.
 */

describe('HandlerContext.recordAudit', () => {
  const recorded: AuditEntry[]                       = [];
  const context: Pick<HandlerContext, 'recordAudit'> = {
    recordAudit: (entry) => {
      recorded.push(entry);
      return Promise.resolve();
    },
  };

  it('takes the status, the entity id, the entity name, the changes and the message of a failure', async () => {
    await context.recordAudit({ status: 'failure', entityId: 'alice', entityName: 'alice@example.com', changes: [{ field: 'email', newValue: 'a@new' }], errorMsg: 'no such user' });

    expect(recorded).toHaveLength(1);
  });

  it('does not take the tenant, the actor or the action', async () => {
    // @ts-expect-error the tenant comes from the caller
    await context.recordAudit({ status: 'success', tenantId: 'tenant-2' });
    // @ts-expect-error the actor comes from the caller
    await context.recordAudit({ status: 'success', actor: { actorType: 'user', actorId: 'principal-2', username: 'mallory', ipAddress: '198.51.100.1' } });
    // @ts-expect-error the action comes from the method that was called
    await context.recordAudit({ status: 'success', action: 'IdpUsersService/ListIdpUsers' });

    expect(recorded).toHaveLength(4);
  });
});
