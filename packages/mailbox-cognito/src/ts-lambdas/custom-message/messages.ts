export const DEFAULT_ADMIN_CREATE_USER_SUBJECT = 'Welcome {{username}}';

export const DEFAULT_ADMIN_CREATE_USER_MESSAGE = `Hi {{username}},

An administrator created an account for you.

Temporary password: {{code}}

{{signInSection}}

You will be prompted to set a new password after signing in.`.trim();

export const DEFAULT_FORGOT_PASSWORD_SUBJECT = 'Reset your password';

export const DEFAULT_FORGOT_PASSWORD_MESSAGE = `Hi {{username}},

Use this code to reset your password: {{code}}`.trim();
