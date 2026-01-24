import { createAdminApiHandler, extractAdminAuthContext, ServiceRegistry, type AdminAuthContext, type AuditContext } from '@sipkg/mailbox-admin-api';

import { createCognitoIdpUsersServiceSpec } from './service';
import { createSqsAuditEmitter } from './audit';

const registry = new ServiceRegistry<AdminAuthContext, AuditContext>();
registry.register(createCognitoIdpUsersServiceSpec());

const auditQueueUrl = process.env.AUDIT_EVENTS_QUEUE_URL;
const adminGroups = process.env.ADMIN_GROUPS ? JSON.parse(process.env.ADMIN_GROUPS) : undefined;
const userGroups = process.env.USER_GROUPS ? JSON.parse(process.env.USER_GROUPS) : undefined;

export const handler = createAdminApiHandler({
	registry,
	extractAuth: (event) => extractAdminAuthContext(event, { adminGroups, userGroups }),
	emitAuditEvent: auditQueueUrl ? createSqsAuditEmitter(auditQueueUrl) : undefined,
	// If your authorizer includes tenantId, you can re-enable tenant-aware auditing here.
	// getTenantId: (auth) => (auth as any).raw?.tenantId as string | undefined,
	getActor: (auth) => {
		const a = auth as any;
		return {
			actorType: a.authType === 'anonymous' ? 'system' : 'user',
			actorId: a.sub ?? 'unknown',
			username: a.username ?? a.email ?? a.sub ?? 'unknown',
			iss: a.iss,
			email: a.email,
			groups: a.groups,
			scopes: a.scopes,
		};
	},
});
