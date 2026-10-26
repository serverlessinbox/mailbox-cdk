import * as t                   from 'typanion';

import { UnauthenticatedError } from '../errors';

import type { AuthorizedEvent } from './authorized-event';
import type { Caller }          from './caller';
import { toPrincipalId }        from './principal-id';
import { toTenantId }           from './tenant-id';

/** The keys of the authorizer's flat context that a caller is made of; the context carries more, which stays unread. */
const isCallerContext = t.isPartial({
  tenantId:      t.isOptional(t.isString()),
  principalId:   t.isOptional(t.isString()),
  principalName: t.isOptional(t.isString()),
  displayName:   t.isOptional(t.isString()),
  groups:        t.isOptional(t.isString()),
});

type CallerContext = t.InferType<typeof isCallerContext>;

const isGroups = t.isArray(t.isString());

/**
 * The one place the authorizer's context is read. It turns the flat context of a request into a `Caller`:
 * a request without a tenant or a principal is unauthenticated, while a context that is not shaped as the
 * authorizer writes it is a defect of the deployment and fails as an ordinary error.
 */
export class CallerContextReader {
  public read(event: AuthorizedEvent): Caller {
    const context = this.contextOf(event);

    const tenantId    = context.tenantId;
    const principalId = context.principalId;
    if (!tenantId || !principalId) {
      throw new UnauthenticatedError('unauthenticated');
    }

    return {
      tenantId:      toTenantId(tenantId),
      principalId:   toPrincipalId(principalId),
      principalName: this.textOf('principalName', context.principalName),
      displayName:   this.textOf('displayName', context.displayName),
      groups:        this.groupsOf(context.groups),
    };
  }

  private contextOf(event: AuthorizedEvent): CallerContext {
    const raw: unknown = event.requestContext.authorizer?.lambda ?? {};

    const errors: string[] = [];
    if (!isCallerContext(raw, { errors })) {
      throw new Error(`malformed authorizer context: ${errors.join('; ')}`);
    }
    return raw;
  }

  /** The authorizer writes the name keys for every principal it resolves, an empty string included. */
  private textOf(key: string, raw: string | undefined): string {
    if (raw === undefined) {
      throw new Error(`malformed authorizer context: ${key} is missing`);
    }
    return raw;
  }

  /** The authorizer writes the groups as a JSON array; a context without them has none. */
  private groupsOf(raw: string | undefined): readonly string[] {
    if (raw === undefined) {
      return [];
    }

    const parsed: unknown  = this.parseGroups(raw);
    const errors: string[] = [];
    if (!isGroups(parsed, { errors })) {
      throw new Error(`malformed authorizer context: groups ${errors.join('; ')}`);
    }
    return parsed;
  }

  private parseGroups(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('malformed authorizer context: groups is not JSON');
    }
  }
}
