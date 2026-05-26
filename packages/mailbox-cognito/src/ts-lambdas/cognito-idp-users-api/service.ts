import type { AdminAuthContext, AuditContext, ServiceSpec } from '@serverlessinbox/mailbox-admin-api';
import { createServiceSpecFromRuntime } from '@serverlessinbox/mailbox-admin-api';

import { IdpUsersServiceRuntime, type IdpUsersServiceHandlers } from './generated/idp_users_service';

import { CognitoIdpUsersService } from './idp-users.service';
import { IdpUsersRequestValidator } from './idp-users.validation';

type MethodName = keyof typeof IdpUsersServiceRuntime.methods;

function isMethodName(x: string): x is MethodName {
	return Object.prototype.hasOwnProperty.call(IdpUsersServiceRuntime.methods, x);
}

export type CognitoIdpUsersServiceSpecOptions = {
	service?: IdpUsersServiceHandlers<AdminAuthContext, AuditContext>;
	validator?: IdpUsersRequestValidator;
};

export function createCognitoIdpUsersServiceSpec(
	opts: CognitoIdpUsersServiceSpecOptions = {}
): ServiceSpec<AdminAuthContext, AuditContext> {
	const impl = opts.service ?? new CognitoIdpUsersService();
	const validator = opts.validator ?? new IdpUsersRequestValidator();

	const validatorByMethodName = {
		ListIdpUsers: validator.validateListIdpUsers,
		GetIdpUser: validator.validateGetIdpUser,
		CreateIdpUser: validator.validateCreateIdpUser,
		SetIdpUserEnabled: validator.validateSetIdpUserEnabled,
		SetIdpUserPassword: validator.validateSetIdpUserPassword,
	} satisfies Record<MethodName, (req: unknown) => unknown>;

	return createServiceSpecFromRuntime<AdminAuthContext, AuditContext>(IdpUsersServiceRuntime as any, impl as any, {
		getValidator: (methodName) => (isMethodName(methodName) ? validatorByMethodName[methodName] : undefined),
	});
}

export { CognitoIdpUsersService };
