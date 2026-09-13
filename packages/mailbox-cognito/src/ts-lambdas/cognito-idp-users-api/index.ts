import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SQSClient } from '@aws-sdk/client-sqs';
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
import { load } from './config';

const config = env.mustLoad(load);

const cognitoClient = new CognitoIdentityProviderClient({});
const sqsClient = new SQSClient({});

const registry = new ServiceRegistry<AdminAuthContext, AuditContext>();
registry.register(createCognitoIdpUsersServiceSpec({ service: new CognitoIdpUsersService(cognitoClient, config.userPoolId) }));

const emitAuditEvent = new SqsAuditEmitter(config.auditEventsQueueUrl, { sqs: sqsClient }).emit;

export const handler = withSmokeTest(
	createAdminApiHandler({
		registry,
		extractAuth: (event) => extractAdminAuthContext(event, { adminGroups: config.adminGroups, userGroups: config.userGroups }),
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
	}),
	env.check(load),
);
