import {
	createAdminApiHandler,
	extractAdminAuthContext,
	ServiceRegistry,
	type AdminAuthContext,
	type AuditContext,
} from '@sipkg/mailbox-admin-api';

import { SqsAuditEmitter } from './audit';
import { createCognitoIdpUsersServiceSpec } from './service';

function parseJsonStringArrayEnv(name: string): string[] | undefined {
	const raw = process.env[name];
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'string') as string[]) : undefined;
	} catch {
		return undefined;
	}
}

const registry = new ServiceRegistry<AdminAuthContext, AuditContext>();
registry.register(createCognitoIdpUsersServiceSpec());

const auditQueueUrl = process.env.AUDIT_EVENTS_QUEUE_URL;
const adminGroups = parseJsonStringArrayEnv('ADMIN_GROUPS');
const userGroups = parseJsonStringArrayEnv('USER_GROUPS');

const emitAuditEvent = auditQueueUrl ? new SqsAuditEmitter(auditQueueUrl).emit : undefined;

export const handler = createAdminApiHandler({
	registry,
	extractAuth: (event) => extractAdminAuthContext(event, { adminGroups, userGroups }),
	emitAuditEvent,
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
