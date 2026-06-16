import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { Mailbox } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '@serverlessinbox/mailbox-cognito';

interface MailboxStandardStackProps extends cdk.StackProps {
  readonly allowedRegions?: string[];
}

export class MailboxStandardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MailboxStandardStackProps) {
    super(scope, id, props);

    if (props?.allowedRegions && props.allowedRegions.length > 0) {
      new cdk.CfnRule(this, 'RegionRestriction', {
        assertions: [
          {
            assert: cdk.Fn.conditionContains(props.allowedRegions, cdk.Aws.REGION),
            assertDescription:
              `This stack can only be deployed in: ${props.allowedRegions.join(', ')}.`,
          },
        ],
      });
    }

    // CloudFormation parameters — deployer fills these in at deploy time.
    const domainName = new cdk.CfnParameter(this, 'domainName', {
      type: 'String',
      description: 'Base domain name for the mailbox deployment (e.g. mail.example.com).',
    });

    const hostedZoneId = new cdk.CfnParameter(this, 'hostedZoneId', {
      type: 'AWS::Route53::HostedZone::Id',
      description: 'Route 53 hosted zone ID that contains domainName.',
    });

    const adminUsername = new cdk.CfnParameter(this, 'adminUsername', {
      type: 'String',
      default: 'admin',
      description: 'Username for the first Cognito admin user.',
    });

    const subdomainNamespace = new cdk.CfnParameter(this, 'subdomainNamespace', {
      type: 'String',
      default: '',
      description:
        'Optional namespace label inserted between endpoint subdomain and base domain ' +
        '(e.g. "mailbox" yields api.mailbox.example.com). Leave empty for no namespace.',
      allowedPattern: '^$|^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$',
      constraintDescription: 'Leave empty or provide a valid DNS label: lowercase letters, digits, and hyphens only (no dots). Max 63 characters.',
    });

    const hasNamespace = new cdk.CfnCondition(this, 'HasNamespace', {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(subdomainNamespace.valueAsString, ''),
      ),
    });

    // Route 53 hosted zone (looked up by attributes at deploy time, not synthesis time).
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: hostedZoneId.valueAsString,
      zoneName: domainName.valueAsString,
    });

    // Cognito user pool — uses a Cognito-managed OAuth domain unique to this stack.
    const userPool = new MailboxUserPool(this, 'UserPool', {
      domain: {
        kind: 'cognito',
        cognitoDomainPrefix: `${cdk.Aws.STACK_NAME}-user-pool`,
      },
    });

    userPool.addBootstrapUser({
      username: adminUsername.valueAsString,
      groups: ['admin'],
    });   

    // Main mailbox construct — wires all infrastructure together.
    // The @serverlessinbox/mailbox package ships artifact-versions.json; the release
    // pipeline runs embed-component-versions before cdk synth to pin v{version} keys.
    const mailbox = new Mailbox(this, 'Mailbox', {
      domainName: domainName.valueAsString,
      hostedZone,
      authProvider: userPool,
      subdomainNamespace: subdomainNamespace.valueAsString,
      subdomainNamespaceCondition: hasNamespace,
      enableReceiving: 'on',
      // CORS origins are derived from domainName by the construct itself
      // (admin.<domain> and webmail.<domain> are added automatically).
    });

    // ── Stack outputs ────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'AdminUiUrl', {
      description: 'Admin UI URL',
      value: mailbox.urls.adminUi,
    });

    new cdk.CfnOutput(this, 'WebmailUrl', {
      description: 'Webmail UI URL',
      value: mailbox.urls.webmail,
    });

    new cdk.CfnOutput(this, 'JmapApiUrl', {
      description: 'JMAP API URL',
      value: mailbox.urls.jmapApi,
    });

    new cdk.CfnOutput(this, 'AdminApiUrl', {
      description: 'Admin API URL',
      value: mailbox.urls.adminApi,
    });

    new cdk.CfnOutput(this, 'AdminUsername', {
      description: 'Username for the first Cognito admin user (create manually after deployment).',
      value: adminUsername.valueAsString,
    });
  }
}
