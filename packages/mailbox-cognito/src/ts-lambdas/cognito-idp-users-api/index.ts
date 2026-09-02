import {
	createAdminApiHandler,
	extractAdminAuthContext,
	ServiceRegistry,
	type AdminAuthContext,
	type AuditContext,
} from '@serverlessinbox/mailbox-admin-api';
import { env, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { SqsAuditEmitter } from './audit';
import { CognitoIdpUsersService } from './idp-users.service';
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

const userPoolId = env.mustGet('USER_POOL_ID');
const auditQueueUrl = env.get('AUDIT_EVENTS_QUEUE_URL');
const adminGroups = parseJsonStringArrayEnv('ADMIN_GROUPS');
const userGroups = parseJsonStringArrayEnv('USER_GROUPS');

const registry = new ServiceRegistry<AdminAuthContext, AuditContext>();
registry.register(createCognitoIdpUsersServiceSpec({ service: new CognitoIdpUsersService(undefined, userPoolId) }));

const emitAuditEvent = auditQueueUrl ? new SqsAuditEmitter(auditQueueUrl).emit : undefined;

export const handler = withSmokeTest(createAdminApiHandler({
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
}));
