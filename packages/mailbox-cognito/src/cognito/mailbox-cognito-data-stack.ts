import * as cdk from 'aws-cdk-lib';
import { Aws, Fn, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { JMAP_SCOPE_DESCRIPTIONS } from '@serverlessinbox/mailbox';
import { CognitoScopeToPermissions } from '../auth/scopemaps/cognito';

/**
 * CDK Stack that creates and owns all retained Serverless Inbox Cognito resources:
 * - UserPool (retained)
 * - UserPoolDomain (retained, either managed prefix or custom)
 * - UserPoolResourceServer (JMAP scopes — synthesized from platform constants)
 * - Default user groups: admin, user
 *
 * All configuration comes from CloudFormation parameters — no synthesis-time CDK values.
 * CloudFormation outputs are published so that callers can read them via a custom resource.
 */
export class MailboxCognitoDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    // --- CloudFormation Parameters ---

    const cognitoDomainPrefix = new cdk.CfnParameter(this, 'cognitoDomainPrefix', {
      type: 'String',
      description: 'Cognito-managed domain prefix (globally unique). Required when no custom domain is provided.',
    });

    const customDomainName = new cdk.CfnParameter(this, 'customDomainName', {
      type: 'String',
      description: 'Custom domain hostname for the Cognito hosted UI (e.g. auth.example.com). Leave empty to use the Cognito-managed prefix domain.',
      default: '',
    });

    const customDomainCertArn = new cdk.CfnParameter(this, 'customDomainCertArn', {
      type: 'String',
      description: 'ACM certificate ARN (must be in us-east-1) for the custom domain. Required when customDomainName is provided.',
      default: '',
    });

    const mfaMode = new cdk.CfnParameter(this, 'mfaMode', {
      type: 'String',
      description: 'MFA enforcement: OFF disables MFA, OPTIONAL lets users enroll TOTP, ON requires TOTP for all users.',
      default: 'OPTIONAL',
      allowedValues: ['OFF', 'OPTIONAL', 'ON'],
    });

    const passwordMinLength = new cdk.CfnParameter(this, 'passwordMinLength', {
      type: 'Number',
      description: 'Minimum password length (6–99).',
      default: 8,
      minValue: 6,
      maxValue: 99,
    });

    // --- Conditions ---

    const hasCustomDomain = new cdk.CfnCondition(this, 'HasCustomDomain', {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(customDomainName.valueAsString, ''),
      ),
    });

    // --- UserPool ---
    // L1 (CfnUserPool) is required here because CF parameter token strings cannot be assigned
    // to L2 enum properties (e.g. cognito.Mfa). All outputs use cfnPool.ref / Fn.sub for ARN.

    const cfnPool = new cognito.CfnUserPool(this, 'user-pool', {
      userPoolName: Fn.sub('${AWS::AccountId}-${AWS::StackName}-users'),
      adminCreateUserConfig: { allowAdminCreateUserOnly: true },
      mfaConfiguration: mfaMode.valueAsString,
      enabledMfas: ['SOFTWARE_TOKEN_MFA'],
      policies: {
        passwordPolicy: {
          minimumLength: passwordMinLength.valueAsNumber,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSymbols: false,
          temporaryPasswordValidityDays: 7,
        },
      },
      accountRecoverySetting: {
        recoveryMechanisms: [{ name: 'admin_only', priority: 1 }],
      },
    });
    cfnPool.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // --- UserPoolDomain ---

    const cfnDomain = new cognito.CfnUserPoolDomain(this, 'user-pool-domain', {
      userPoolId: cfnPool.ref,
      domain: Fn.conditionIf(
        hasCustomDomain.logicalId,
        customDomainName.valueAsString,
        cognitoDomainPrefix.valueAsString,
      ).toString(),
      customDomainConfig: Fn.conditionIf(
        hasCustomDomain.logicalId,
        { certificateArn: customDomainCertArn.valueAsString },
        Aws.NO_VALUE,
      ) as any,
    });
    cfnDomain.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // --- UserPoolResourceServer ---
    // Scopes are synthesized from platform constants at template build time.
    // To add scopes: update CognitoScopeToPermissions, release a new package version,
    // republish the template, and redeploy.

    new cognito.CfnUserPoolResourceServer(this, 'user-pool-resource-server', {
      userPoolId: cfnPool.ref,
      identifier: 'si',
      name: 'JMAP API',
      scopes: Object.entries(CognitoScopeToPermissions).map(([scope, permissions]) => ({
        scopeName: scope.replace(/\//g, '.'),
        scopeDescription: JMAP_SCOPE_DESCRIPTIONS[permissions[0]] ?? scope,
      })),
    });

    // --- Default User Groups ---

    new cognito.CfnUserPoolGroup(this, 'group-admin', {
      userPoolId: cfnPool.ref,
      groupName: 'admin',
      description: 'Serverless Inbox administrator group',
    });

    new cognito.CfnUserPoolGroup(this, 'group-user', {
      userPoolId: cfnPool.ref,
      groupName: 'user',
      description: 'Serverless Inbox standard user group',
    });

    // --- CloudFormation Outputs ---

    new cdk.CfnOutput(this, 'userPoolId', { value: cfnPool.ref });
    new cdk.CfnOutput(this, 'userPoolArn', {
      value: Fn.sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${PoolId}', {
        PoolId: cfnPool.ref,
      }),
    });
    new cdk.CfnOutput(this, 'oauthDomain', {
      value: Fn.conditionIf(
        hasCustomDomain.logicalId,
        customDomainName.valueAsString,
        Fn.sub('${Prefix}.auth.${AWS::Region}.amazoncognito.com', {
          Prefix: cognitoDomainPrefix.valueAsString,
        }),
      ).toString(),
    });
  }
}
