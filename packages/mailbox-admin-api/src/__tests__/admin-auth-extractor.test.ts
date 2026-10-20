import { AdminAuthExtractor }         from '../admin-auth-extractor';
import type { ApiGatewayV2EventLike } from '../api-gateway';

/*
 * Pins how the authorizer output becomes an AdminAuthContext. The authorizer is a Lambda we do not control and
 * its output comes in several key spellings and nestings; loosening a lookup here silently demotes an
 * administrator to an anonymous caller or promotes an anonymous caller to a user.
 */

function eventWith(lambda: unknown): ApiGatewayV2EventLike {
  return { requestContext: { authorizer: { lambda } } };
}

describe('AdminAuthExtractor', () => {
  describe('identity', () => {
    it('reads an authenticated caller from the flat authorizer keys', () => {
      const lambda = { sub: 'user-1', iss: 'https://issuer', email: 'a@example.com', tenantId: 'tenant-1' };

      const context = new AdminAuthExtractor().extract(eventWith(lambda));

      expect(context).toEqual({
        authType: 'authenticated',
        sub: 'user-1',
        iss: 'https://issuer',
        email: 'a@example.com',
        username: 'a@example.com',
        groups: [],
        isAdmin: false,
        roles: ['user'],
        scopes: [],
        tenantId: 'tenant-1',
        raw: lambda,
      });
    });

    it('keeps the authorizer object itself as raw, not a copy', () => {
      const lambda = { sub: 'user-1' };

      const context = new AdminAuthExtractor().extract(eventWith(lambda));

      expect(context.raw).toBe(lambda);
    });

    it('reads sub, iss and email from the first nested claims object when they are not flat', () => {
      const lambda = { jwt: 'not-an-object', claims: { sub: 'user-2', iss: 'https://nested', email: 'n@example.com' } };

      const context = new AdminAuthExtractor().extract(eventWith(lambda));

      expect(context).toMatchObject({ authType: 'authenticated', sub: 'user-2', iss: 'https://nested', email: 'n@example.com' });
    });

    it('treats a caller without a subject as anonymous with no roles', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ email: 'a@example.com' }));

      expect(context).toMatchObject({ authType: 'anonymous', sub: undefined, roles: [], isAdmin: false });
    });

    it('treats a caller whose authType says anonymous as anonymous even with a subject', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 'user-1', auth: { authType: 'ANONYMOUS' } }));

      expect(context).toMatchObject({ authType: 'anonymous', sub: 'user-1', roles: [] });
    });

    it('answers an anonymous caller with an empty raw payload when the authorizer output is not an object', () => {
      const context = new AdminAuthExtractor().extract(eventWith(['not', 'an', 'object']));

      expect(context.authType).toBe('anonymous');
      expect(context.raw).toEqual({});
    });

    it('answers an anonymous caller when the event has no authorizer', () => {
      const context = new AdminAuthExtractor().extract({ requestContext: {} });

      expect(context.authType).toBe('anonymous');
      expect(context.raw).toEqual({});
    });

    it('does not read the tenant from anywhere but the flat tenantId key', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 'user-1', claims: { tenantId: 'nested-tenant' } }));

      expect(context.tenantId).toBeUndefined();
    });
  });

  describe('username', () => {
    it('prefers username, then cognito:username, then a nested name, then email, then sub', () => {
      const extractor = new AdminAuthExtractor();

      expect(extractor.extract(eventWith({ sub: 's', email: 'e@x', 'cognito:username': 'cu', username: 'u' })).username).toBe('u');
      expect(extractor.extract(eventWith({ sub: 's', email: 'e@x', 'cognito:username': 'cu' })).username).toBe('cu');
      expect(extractor.extract(eventWith({ sub: 's', email: 'e@x', claims: { preferred_username: 'pu' } })).username).toBe('pu');
      expect(extractor.extract(eventWith({ sub: 's', email: 'e@x' })).username).toBe('e@x');
      expect(extractor.extract(eventWith({ sub: 's' })).username).toBe('s');
    });
  });

  describe('groups and roles', () => {
    it('collects groups from cognito:groups, groups and roles, as arrays or comma-separated strings', () => {
      const lambda = { sub: 's', 'cognito:groups': 'a, b', groups: ['c', 5, 'd'], roles: 'e' };

      const context = new AdminAuthExtractor().extract(eventWith(lambda));

      expect(context.groups).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('ignores groups that are blank or not a string or array', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 's', 'cognito:groups': '   ', groups: 7 }));

      expect(context.groups).toEqual([]);
    });

    it('makes a member of the default admin group an admin and a user, ignoring case', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 's', groups: ['Admin'] }));

      expect(context).toMatchObject({ isAdmin: true, roles: ['admin', 'user'] });
    });

    it('uses the configured admin group name instead of the default', () => {
      const extractor = new AdminAuthExtractor({ adminGroupName: 'Root' });

      expect(extractor.extract(eventWith({ sub: 's', groups: ['root'] })).isAdmin).toBe(true);
      expect(extractor.extract(eventWith({ sub: 's', groups: ['admin'] })).isAdmin).toBe(false);
    });

    it('lets configured admin groups override the admin group name', () => {
      const extractor = new AdminAuthExtractor({ adminGroups: ['Ops'], adminGroupName: 'root' });

      expect(extractor.extract(eventWith({ sub: 's', groups: ['ops'] })).isAdmin).toBe(true);
      expect(extractor.extract(eventWith({ sub: 's', groups: ['root'] })).isAdmin).toBe(false);
    });

    it('gives the user role only to members of the configured user groups', () => {
      const extractor = new AdminAuthExtractor({ userGroups: ['Staff'] });

      expect(extractor.extract(eventWith({ sub: 's', groups: ['staff'] })).roles).toEqual(['user']);
      expect(extractor.extract(eventWith({ sub: 's', groups: ['other'] })).roles).toEqual([]);
    });
  });

  describe('scopes', () => {
    it('collects scopes from scope and scopes, splitting strings on whitespace and commas', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 's', scope: 'read write,admin', scopes: ['extra', 3] }));

      expect(context.scopes).toEqual(['read', 'write', 'admin', 'extra']);
    });

    it('answers no scopes when neither key holds a string or array', () => {
      const context = new AdminAuthExtractor().extract(eventWith({ sub: 's', scope: 1, scopes: null }));

      expect(context.scopes).toEqual([]);
    });
  });
});
