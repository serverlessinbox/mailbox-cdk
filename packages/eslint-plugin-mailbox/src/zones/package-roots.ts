export interface PackageRoot {
  readonly name: string;
  readonly dir:  string;
}

export const mailboxPackage: PackageRoot = { name: '@serverlessinbox/mailbox', dir: 'mailbox' };

export const kitPackage: PackageRoot = { name: '@serverlessinbox/mailbox-cdk-shared', dir: 'mailbox-cdk-shared' };

export const cognitoPackage: PackageRoot = { name: '@serverlessinbox/mailbox-cognito', dir: 'mailbox-cognito' };

export const packageRoots: readonly PackageRoot[] = [mailboxPackage, kitPackage, cognitoPackage];
