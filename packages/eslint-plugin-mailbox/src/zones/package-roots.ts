export interface PackageRoot {
  readonly name: string;
  readonly dir:  string;
}

export const mailboxPackage: PackageRoot = { name: '@serverlessinbox/mailbox', dir: 'mailbox' };

export const kitPackage: PackageRoot = { name: '@serverlessinbox/mailbox-cdk-shared', dir: 'mailbox-cdk-shared' };

export const cognitoPackage: PackageRoot = { name: '@serverlessinbox/mailbox-cognito', dir: 'mailbox-cognito' };

export const packageRoots: readonly PackageRoot[] = [mailboxPackage, kitPackage, cognitoPackage];

export interface SourceRuleScope {
  readonly files:   readonly string[];
  readonly ignores: readonly string[];
}

// The source trees the source rules govern. Runtime and test code inside them is outside the source rules.
export const sourceRuleScope: SourceRuleScope = {
  files:   packageRoots.map((root) => `packages/${root.dir}/src/**/*.ts`),
  ignores: packageRoots.flatMap((root) => [`packages/${root.dir}/src/runtime/**`, `packages/${root.dir}/src/**/__tests__/**`]),
};
