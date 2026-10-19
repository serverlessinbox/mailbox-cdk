import * as cdk from 'aws-cdk-lib';
import { Aws, Fn, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import {
  JMAP_SCOPE_DESCRIPTIONS,
  MailboxResourceDescriptions,
} from '@serverlessinbox/mailbox';
import {
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  isDevelopmentMode,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
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
    const terminationProtection = isDevelopmentMode(scope) ? false : (props.terminationProtection ?? true);
    super(scope, id, { ...props, terminationProtection });

    this.templateOptions.description =
      'Serverless JMAP email server on AWS identity tier — Cognito user pool, authentication domain, and user groups.';

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

    // --- Correlation / tagging parameters (mirror the edge/data sub-stacks) ---

    const rootStackParam = new cdk.CfnParameter(this, 'root-stack', {
      type: 'String',
      description: 'Root (main) CloudFormation stack name (regional stack that created this cognito stack)',
      default: '',
    });
    rootStackParam.overrideLogicalId('rootStack');

    const rootStackIdParam = new cdk.CfnParameter(this, 'root-stack-id', {
      type: 'String',
      description: 'Unique id (stack id guid) of the root (main) CloudFormation stack',
    });
    rootStackIdParam.overrideLogicalId('rootStackId');

    const productVersionParam = new cdk.CfnParameter(this, 'product-version', {
      type: 'String',
      description: 'Serverless Inbox Mailbox stack version (for tagging/support)',
      default: 'unknown',
    });
    productVersionParam.overrideLogicalId('productVersion');

    const deployerTypeParam = new cdk.CfnParameter(this, 'deployerType', {
      type: 'String',
      description: 'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
      default: 'cfn',
      allowedValues: ['cdk', 'cfn', 'marketplace'],
    });
    deployerTypeParam.overrideLogicalId('deployerType');

    // Apply product/correlation tags to everything in this cognito data stack.
    // root-stack is the main stack name (via rootStack param); the base helper tags this
    // stack's own name as `stack` (AWS::StackName). Cognito is the identity/auth tier.
    applyServerlessInboxBaseTagsWithDeployerType(this, {
      product: 'mailbox',
      rootStack: rootStackParam.valueAsString,
      version: productVersionParam.valueAsString,
    }, deployerTypeParam.valueAsString as ServerlessInboxDeployerType, rootStackIdParam.valueAsString);
    applyServerlessInboxComponentTag(this, 'auth');

    // Name tags + native descriptions for every L1 in this sub-stack. Ids aren't in the main-stack
    // component map, so supply an identity-tier fallback sentence; anchor on this stack's own id.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox identity - Cognito user directory.',
    }));

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
    cfnPool.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

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
    cfnDomain.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

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
