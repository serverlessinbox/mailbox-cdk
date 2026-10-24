import type { TSESLint } from '@typescript-eslint/utils';

export const forbiddenGrantRules: TSESLint.FlatConfig.Rules = {
  'no-restricted-properties': [
    'error',
    { property: 'grantReadData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs, including dynamodb:Scan.' },
    { property: 'grantWriteData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs.' },
    { property: 'grantReadWriteData', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs, including dynamodb:Scan.' },
    { property: 'grantFullAccess', message: 'Use an exact-action grant method (iam-scoping section 0). CDK table grant helpers grant more than the caller needs.' },
    { property: 'grantStreamRead', message: 'Use an exact-action grant method (iam-scoping section 0). CDK stream grant helpers grant more than the caller needs.' },
    { property: 'grantTableListStreams', message: 'Use an exact-action grant method (iam-scoping section 0). CDK stream grant helpers grant more than the caller needs.' },
  ],
};
