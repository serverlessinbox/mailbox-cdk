import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { Mailbox } from '@serverlessinbox/mailbox';
import { MailboxUserPool } from '@serverlessinbox/mailbox-cognito';

export class MailboxStandardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CloudFormation parameters — deployer fills these in at deploy time.
    const domainName = new cdk.CfnParameter(this, 'domainName', {
      type: 'String',
      description: 'Base domain name for the mailbox deployment (e.g. mail.example.com).',
    });

    const hostedZoneId = new cdk.CfnParameter(this, 'hostedZoneId', {
      type: 'String',
      description: 'Route 53 hosted zone ID that contains domainName.',
    });

    const adminUsername = new cdk.CfnParameter(this, 'adminUsername', {
      type: 'String',
      default: 'admin',
      description: 'Username for the first Cognito admin user.',
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

    // Main mailbox construct — wires all infrastructure together.
    // The @serverlessinbox/mailbox package ships artifact-versions.json; the release
    // pipeline runs embed-component-versions before cdk synth to pin v{version} keys.
    const mailbox = new Mailbox(this, 'Mailbox', {
      domainName: domainName.valueAsString,
      hostedZone,
      authProvider: userPool,
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
