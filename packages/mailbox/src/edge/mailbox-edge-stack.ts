import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { MailboxDomains } from '../domains';

export interface MailboxEdgeStackProps extends cdk.StackProps {
  /** Base domain name, e.g. example.com */
  readonly domainName: string;

  /** Optional extra label between endpoint and base domain, e.g. "mailbox" -> admin.mailbox.example.com */
  readonly prefix?: string;

  /**
   * If provided, the ACM certificate will be DNS-validated automatically via Route53.
   * If omitted, the certificate will use email validation.
   */
  readonly hostedZone?: route53.IHostedZone;

  /** Alternative to hostedZone: import hosted zone by attributes (token-safe). */
  readonly hostedZoneId?: string;
  readonly hostedZoneName?: string;
}

/**
 * Deploy this stack in us-east-1.
 *
 * Creates a single ACM certificate intended for CloudFront/Lambda@Edge/Cognito custom domains.
 */
export class MailboxEdgeStack extends cdk.Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: MailboxEdgeStackProps) {
    super(scope, id, props);

    const domains = new MailboxDomains({
      domainName: props.domainName,
      prefix: props.prefix,
    });

    const admin = domains.admin;
    const webmail = domains.webmail;
    const auth = domains.auth;
    const cdn = domains.cdn;

    const hostedZone = props.hostedZone
      ?? (props.hostedZoneId && props.hostedZoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'hosted-zone', {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName,
        })
        : undefined);

    this.certificate = new acm.Certificate(this, 'edge-certificate', {
      domainName: admin,
      subjectAlternativeNames: [webmail, auth, cdn],
      validation: hostedZone
        ? acm.CertificateValidation.fromDns(hostedZone)
        : acm.CertificateValidation.fromEmail(),
    });

    new cdk.CfnOutput(this, 'EdgeCertificateArn', {
      value: this.certificate.certificateArn,
    });

    new cdk.CfnOutput(this, 'EdgeCertificateDomains', {
      value: [admin, webmail, auth, cdn].join(','),
    });
  }
}
