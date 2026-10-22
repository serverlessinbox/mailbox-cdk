import {
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  isDevelopmentMode,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import {
  JMAP_SCOPE_DESCRIPTIONS,
  MailboxResourceDescriptions,
} from '@serverlessinbox/mailbox';
import * as cognito                  from 'aws-cdk-lib/aws-cognito';
import * as cdk                      from 'aws-cdk-lib';
import { Aws, Fn, RemovalPolicy }    from 'aws-cdk-lib';
import { Construct }                 from 'constructs';

import { CognitoScopeToPermissions } from '../user-pool/cognito-scopemap';
import { MfaMode }                   from '../user-pool/mfa-mode';

import {
  ADMIN_GROUP_NAME,
  DEFAULT_MFA_MODE,
  DEFAULT_PASSWORD_MIN_LENGTH,
  RESOURCE_SERVER_IDENTIFIER,
  USER_GROUP_NAME,
  type MailboxCognitoDataStackParameters,
} from './mailbox-cognito-data-stack-contract';

/** The CloudFormation parameters of the stack, one per name in the parameter contract. */
type DeclaredParameters = Readonly<Record<keyof MailboxCognitoDataStackParameters, cdk.CfnParameter>>;

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

    const parameters = this.declareParameters();
    this.applyCorrelationTags(parameters);
    const hasCustomDomain = this.declareHasCustomDomain(parameters);

    const cfnPool = this.createUserPool(parameters);
    this.createUserPoolDomain(cfnPool, parameters, hasCustomDomain);
    this.createResourceServer(cfnPool);
    this.createDefaultGroups(cfnPool);

    this.publishOutputs(cfnPool, parameters, hasCustomDomain);
  }

  private declareParameters(): DeclaredParameters {
    return {
      cognitoDomainPrefix: this.declareParameter('cognitoDomainPrefix', {
        type:        'String',
        description: 'Cognito-managed domain prefix (globally unique). Required when no custom domain is provided.',
      }),
      customDomainName:    this.declareParameter('customDomainName', {
        type:        'String',
        description: 'Custom domain hostname for the Cognito hosted UI (e.g. auth.example.com). Leave empty to use the Cognito-managed prefix domain.',
        default:     '',
      }),
      customDomainCertArn: this.declareParameter('customDomainCertArn', {
        type:        'String',
        description: 'ACM certificate ARN (must be in us-east-1) for the custom domain. Required when customDomainName is provided.',
        default:     '',
      }),
      mfaMode:             this.declareParameter('mfaMode', {
        type:          'String',
        description:   'MFA enforcement: OFF disables MFA, OPTIONAL lets users enroll TOTP, ON requires TOTP for all users.',
        default:       DEFAULT_MFA_MODE,
        allowedValues: Object.values(MfaMode),
      }),
      passwordMinLength:   this.declareParameter('passwordMinLength', {
        type:        'Number',
        description: 'Minimum password length (6–99).',
        default:     DEFAULT_PASSWORD_MIN_LENGTH,
        minValue:    6,
        maxValue:    99,
      }),
      rootStack:           this.declareParameter('rootStack', {
        type:        'String',
        description: 'Root (main) CloudFormation stack name (regional stack that created this cognito stack)',
        default:     '',
      }),
      rootStackId:         this.declareParameter('rootStackId', {
        type:        'String',
        description: 'Unique id (stack id guid) of the root (main) CloudFormation stack',
      }),
      deployerType:        this.declareParameter('deployerType', {
        type:          'String',
        description:   'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
        default:       'cfn',
        allowedValues: ['cdk', 'cfn', 'marketplace'],
      }),
    };
  }

  private declareParameter(name: keyof MailboxCognitoDataStackParameters, props: cdk.CfnParameterProps): cdk.CfnParameter {
    return new cdk.CfnParameter(this, name, props);
  }

  // Apply product/correlation tags to everything in this cognito data stack.
  // root-stack is the main stack name (via rootStack param); the base helper tags this
  // stack's own name as `stack` (AWS::StackName). Cognito is the identity/auth tier.
  private applyCorrelationTags(parameters: DeclaredParameters): void {
    applyServerlessInboxBaseTagsWithDeployerType(this, {
      product:   'mailbox',
      rootStack: parameters.rootStack.valueAsString,
    }, parameters.deployerType.valueAsString as ServerlessInboxDeployerType, parameters.rootStackId.valueAsString);
    applyServerlessInboxComponentTag(this, 'auth');

    // Name tags + native descriptions for every L1 in this sub-stack. Ids aren't in the main-stack
    // component map, so supply an identity-tier fallback sentence; anchor on this stack's own id.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox identity - Cognito user directory.',
    }));
  }

  private declareHasCustomDomain(parameters: DeclaredParameters): cdk.CfnCondition {
    return new cdk.CfnCondition(this, 'HasCustomDomain', {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(parameters.customDomainName.valueAsString, ''),
      ),
    });
  }

  // L1 (CfnUserPool) is required here because CF parameter token strings cannot be assigned
  // to L2 enum properties (e.g. cognito.Mfa). All outputs use cfnPool.ref / Fn.sub for ARN.
  private createUserPool(parameters: DeclaredParameters): cognito.CfnUserPool {
    const cfnPool = new cognito.CfnUserPool(this, 'user-pool', {
      userPoolName:           Fn.sub('${AWS::AccountId}-${AWS::StackName}-users'),
      adminCreateUserConfig:  { allowAdminCreateUserOnly: true },
      mfaConfiguration:       parameters.mfaMode.valueAsString,
      enabledMfas:            ['SOFTWARE_TOKEN_MFA'],
      policies:               {
        passwordPolicy: {
          minimumLength:                 parameters.passwordMinLength.valueAsNumber,
          requireLowercase:              true,
          requireUppercase:              true,
          requireNumbers:                true,
          requireSymbols:                false,
          temporaryPasswordValidityDays: 7,
        },
      },
      accountRecoverySetting: {
        recoveryMechanisms: [{ name: 'admin_only', priority: 1 }],
      },
    });
    cfnPool.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
    return cfnPool;
  }

  private createUserPoolDomain(cfnPool: cognito.CfnUserPool, parameters: DeclaredParameters, hasCustomDomain: cdk.CfnCondition): void {
    const cfnDomain = new cognito.CfnUserPoolDomain(this, 'user-pool-domain', {
      userPoolId:         cfnPool.ref,
      domain:             Fn.conditionIf(
        hasCustomDomain.logicalId,
        parameters.customDomainName.valueAsString,
        parameters.cognitoDomainPrefix.valueAsString,
      ).toString(),
      customDomainConfig: Fn.conditionIf(
        hasCustomDomain.logicalId,
        { certificateArn: parameters.customDomainCertArn.valueAsString },
        Aws.NO_VALUE,
      ),
    });
    cfnDomain.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
  }

  // Scopes are synthesized from platform constants at template build time.
  // To add scopes: update CognitoScopeToPermissions, release a new package version,
  // republish the template, and redeploy.
  private createResourceServer(cfnPool: cognito.CfnUserPool): void {
    new cognito.CfnUserPoolResourceServer(this, 'user-pool-resource-server', {
      userPoolId: cfnPool.ref,
      identifier: RESOURCE_SERVER_IDENTIFIER,
      name:       'JMAP API',
      scopes:     Object.entries(CognitoScopeToPermissions).map(([scope, permissions]) => ({
        scopeName:        scope,
        scopeDescription: JMAP_SCOPE_DESCRIPTIONS[permissions[0]] ?? scope,
      })),
    });
  }

  private createDefaultGroups(cfnPool: cognito.CfnUserPool): void {
    new cognito.CfnUserPoolGroup(this, 'group-admin', {
      userPoolId:  cfnPool.ref,
      groupName:   ADMIN_GROUP_NAME,
      description: 'Serverless Inbox administrator group',
    });

    new cognito.CfnUserPoolGroup(this, 'group-user', {
      userPoolId:  cfnPool.ref,
      groupName:   USER_GROUP_NAME,
      description: 'Serverless Inbox standard user group',
    });
  }

  private publishOutputs(cfnPool: cognito.CfnUserPool, parameters: DeclaredParameters, hasCustomDomain: cdk.CfnCondition): void {
    new cdk.CfnOutput(this, 'userPoolId', { value: cfnPool.ref });
    new cdk.CfnOutput(this, 'userPoolArn', {
      value: Fn.sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${PoolId}', {
        PoolId: cfnPool.ref,
      }),
    });
    new cdk.CfnOutput(this, 'oauthDomain', {
      value: Fn.conditionIf(
        hasCustomDomain.logicalId,
        parameters.customDomainName.valueAsString,
        Fn.sub('${Prefix}.auth.${AWS::Region}.amazoncognito.com', {
          Prefix: parameters.cognitoDomainPrefix.valueAsString,
        }),
      ).toString(),
    });
  }
}
