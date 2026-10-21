import type { IArtifactResolver }                             from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType }                   from '@serverlessinbox/mailbox-cdk-shared';
import { PipelineLogGroup, applyServerlessInboxComponentTag } from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                               from 'aws-cdk-lib/aws-certificatemanager';
import type * as route53                                      from 'aws-cdk-lib/aws-route53';
import type { IBucket }                                       from 'aws-cdk-lib/aws-s3';
import * as cdk                                               from 'aws-cdk-lib';
import { Construct }                                          from 'constructs';

import type { IAuthKeyStoreTable }                            from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                    from '../../resources/tables/data-tables';
import { MailboxDns }                                         from '../domains/mailbox-dns';
import type { MailboxDnsCnameTargets }                        from '../domains/mailbox-dns';
import type { IMailboxDomainNames }                           from '../domains/mailbox-domains';
import { Cdn }                                                from '../ui/cdn-construct';
import type { CdnCustomDomain }                               from '../ui/cdn-construct';

import { MailboxEdgeDeployer }                                from './mailbox-edge-deployer';

/** Props of {@link EdgeSection}. */
export interface EdgeSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly deployerType: ServerlessInboxDeployerType;
  readonly domainName: string;
  /** The endpoint names; the regional certificate covers the api, jmap and ws names. */
  readonly mailboxDomains: IMailboxDomainNames;
  readonly edgePrefix: string;
  readonly hostedZone: route53.IHostedZone;
  /** Set when the mailbox has a hosted zone; the certificates validate and the DNS records are written into it. */
  readonly hostedZoneId?: string;
  /** The operator's own API certificate, when given. */
  readonly providedApiCertificate?: acm.ICertificate;
  /** The operator's own JMAP certificate, when given. */
  readonly providedJmapCertificate?: acm.ICertificate;
  readonly itemTable: IDataTable;
  readonly configTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly productVersion: string;
}

/** What the CDN built by {@link EdgeSection.addBlobCdn} offers to the rest of the mail server. */
export interface IBlobCdnEndpoint {
  /** The base URL the CDN is served on, with protocol. */
  readonly host: string;
  /** The CloudFront domain name of the distribution, without protocol. */
  readonly distributionDomainName: string;
}

/** Props of {@link EdgeSection.addBlobCdn}. */
export interface BlobCdnProps {
  /** The raw bucket the CDN fronts. */
  readonly blobStore: IBucket;
  /** Origins allowed to download cross-origin. */
  readonly allowedOrigins?: string[];
  readonly customDomain?: CdnCustomDomain;
}

/**
 * The edge sub-stack, the regional API certificate, the blob CDN and the DNS records. The CDN and the
 * DNS records need values that exist only after the UIs and the APIs, so they are added by
 * {@link EdgeSection.addBlobCdn} and {@link EdgeSection.addDns} at that point.
 */
export class EdgeSection extends Construct {
  /** The us-east-1 certificate of the edge sub-stack; present when the mailbox has a hosted zone. */
  public readonly edgeCertificate?: acm.ICertificate;
  /** The regional SAN certificate this section created; present when it had to fill a missing API or JMAP certificate. */
  public readonly regionalCertificate?: acm.ICertificate;
  /** The version ARN of the edge JMAP blob download function, a deploy-time token. */
  public readonly jmapBlobDownloadVersionArn: string;

  private readonly edgeStack: MailboxEdgeDeployer;
  private readonly authKeyStoreTable: IAuthKeyStoreTable;
  private readonly mailboxDomains: IMailboxDomainNames;
  private readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: EdgeSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'edge');

    this.authKeyStoreTable = props.authKeyStoreTable;
    this.mailboxDomains    = props.mailboxDomains;
    this.hostedZone        = props.hostedZone;

    this.edgeStack = new MailboxEdgeDeployer(this, 'stack-deployer', {
      domainName: props.domainName,
      artifactResolver: props.artifactResolver,
      prefix: props.edgePrefix,
      hostedZone: props.hostedZoneId ? props.hostedZone : undefined,
      itemTable: props.itemTable,
      configTable: props.configTable,
      authKeyStoreTable: props.authKeyStoreTable,
      productVersion: props.productVersion,
      deployerType: props.deployerType,
      logGroupName: PipelineLogGroup.getOrCreate(this, 'jmap').logGroupName,
    });

    this.edgeCertificate            = this.edgeStack.edgeCertificate;
    this.jmapBlobDownloadVersionArn = this.edgeStack.getOutput('jmapBlobDownloadVersionArn');

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    // If either API certificate is missing and there is a hosted zone, one SAN certificate covers
    // the api, jmap, ws and mcp names and fills the gaps.
    let regionalSanCertificate: acm.ICertificate | undefined;
    let cfnCert: acm.CfnCertificate | undefined;
    if (props.hostedZoneId && (!props.providedApiCertificate || !props.providedJmapCertificate)) {
      cfnCert = new acm.CfnCertificate(this, 'regional-api-certificate', {
        domainName: props.mailboxDomains.api,
        subjectAlternativeNames: [props.mailboxDomains.jmap, props.mailboxDomains.ws, `mcp.${props.domainName}`],
        validationMethod: 'DNS',
        domainValidationOptions: [
          { domainName: props.mailboxDomains.api, hostedZoneId: props.hostedZoneId },
          { domainName: props.mailboxDomains.jmap, hostedZoneId: props.hostedZoneId },
          { domainName: props.mailboxDomains.ws, hostedZoneId: props.hostedZoneId },
          { domainName: `mcp.${props.domainName}`, hostedZoneId: props.hostedZoneId },
        ],
      });
      cfnCert.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
      regionalSanCertificate = acm.Certificate.fromCertificateArn(this, 'regional-api-certificate-ref', cfnCert.ref);
    }

    this.regionalCertificate = regionalSanCertificate;
  }

  /** Adds the CDN in front of the blob bucket; the UI origins it allows exist only once the UIs are built. */
  public addBlobCdn(props: BlobCdnProps): IBlobCdnEndpoint {
    const cdn = new Cdn(this, 'blob-cdn', {
      blobStore: props.blobStore,
      authKeyStoreTable: this.authKeyStoreTable,
      allowedOrigins: props.allowedOrigins,
      jmapBlobDownloadVersion: this.edgeStack.jmapBlobDownloadVersion,
      customDomain: props.customDomain,
    });

    return { host: cdn.host, distributionDomainName: cdn.distribution.distributionDomainName };
  }

  /** Adds the DNS records; their targets exist only once the UIs, the CDN and the API endpoints are built. */
  public addDns(cnameTargets: MailboxDnsCnameTargets): void {
    new MailboxDns(this, 'dns', {
      names: this.mailboxDomains,
      hostedZone: this.hostedZone,
      cnameTargets,
    });
  }
}
