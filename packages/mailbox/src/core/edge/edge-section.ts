import type { IArtifactResolver }                                                   from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType }                                         from '@serverlessinbox/mailbox-cdk-shared';
import { ComponentDescription, PipelineLogGroup, applyServerlessInboxComponentTag } from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                                                     from 'aws-cdk-lib/aws-certificatemanager';
import type * as route53                                                            from 'aws-cdk-lib/aws-route53';
import type { IBucket }                                                             from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                     from 'aws-cdk-lib';
import { Construct }                                                                from 'constructs';

import type { MailboxCertificateOverrides }                                         from '../../mailbox-props';
import type { IAuthKeyStoreTable }                                                  from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                                          from '../../resources/tables/data-tables';
import { MailboxDns }                                                               from '../domains/mailbox-dns';
import type { MailboxDnsCnameTargets }                                              from '../domains/mailbox-dns';
import type { IMailboxDomainNames }                                                 from '../domains/mailbox-domains';
import { Cdn }                                                                      from '../ui/cdn-construct';
import type { CdnCustomDomain }                                                     from '../ui/cdn-construct';

import { MailboxEdgeDeployer }                                                      from './mailbox-edge-deployer';

/** What {@link EdgeSection} uses of the data section. */
export interface IEdgeDataInputs {
  readonly configTable: IDataTable;
  readonly itemTable:   IDataTable;
  /** The raw bucket the CDN fronts. */
  readonly blobStoreBucket: IBucket;
}

/** What {@link EdgeSection} uses of the auth section. */
export interface IEdgeAuthInputs {
  readonly authKeyStoreTable: IAuthKeyStoreTable;
}

/** Where the mailbox is reachable, as {@link EdgeSection} uses it. */
export interface IEdgeAddressing {
  /** The endpoint names; the regional certificate covers the api, jmap and ws names. */
  readonly domains:    IMailboxDomainNames;
  readonly edgePrefix: string;
}

/** What {@link EdgeSection.addBlobCdn} uses of the ui section. */
export interface IEdgeUiInputs {
  /** Origins the Admin UI is served from; empty when it is disabled. */
  readonly adminUiOrigins: string[];
  /** Origins the Webmail UI is served from; empty when it is disabled. */
  readonly webmailUiOrigins: string[];
}

/** Props of {@link EdgeSection}. */
export interface EdgeSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly deployerType:     ServerlessInboxDeployerType;
  readonly productVersion:   string;
  readonly data:             IEdgeDataInputs;
  readonly auth:             IEdgeAuthInputs;
  readonly addressing:       IEdgeAddressing;
  /** The hosted zone the mailbox has, if any: the certificates validate and the DNS records are written into it. */
  readonly hostedZone?:      route53.IHostedZone;
  /** The operator's own certificates; the api, jmap, ws and cloudFront ones are read here. */
  readonly certificateOverrides?: MailboxCertificateOverrides;
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
  readonly ui: IEdgeUiInputs;
  /** Origins allowed to download cross-origin, besides the UIs'. */
  readonly extraAllowedOrigins?: string[];
}

/** What {@link EdgeSection.addDns} uses of the ui section. */
export interface IEdgeDnsUiInputs {
  /** CNAME target of the Admin UI's distribution, when enabled. */
  readonly adminUiCnameTarget?: string;
  /** CNAME target of the Webmail UI's distribution, when enabled. */
  readonly webmailUiCnameTarget?: string;
}

/** What {@link EdgeSection.addDns} uses of the API endpoints. */
export interface IEdgeDnsApisInputs {
  /** CNAME target of the admin API custom domain, when it has one. */
  readonly adminApiDomainTarget?: string;
  /** CNAME target of the JMAP API custom domain, when it has one. */
  readonly jmapApiDomainTarget?: string;
  /** CNAME target of the WebSocket API custom domain, when it has one. */
  readonly webSocketDomainTarget?: string;
  /** CNAME target of the MCP API custom domain, when the MCP API is enabled. */
  readonly mcpApiDomainTarget?: string;
}

/** Props of {@link EdgeSection.addDns}: the targets that exist only after the UIs, the CDN and the API endpoints. */
export interface EdgeDnsProps {
  readonly ui:      IEdgeDnsUiInputs;
  readonly blobCdn: IBlobCdnEndpoint;
  readonly apis:    IEdgeDnsApisInputs;
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
  /** The hosted zone the certificates validate and the DNS records are written into; present when the mailbox has one. */
  public readonly hostedZone?: route53.IHostedZone;
  /** The certificate the UIs are served with unless the operator gave their own; present when the mailbox has a hosted zone. */
  public readonly uiCertificate?: acm.ICertificate;
  /** The certificate of the admin API's custom domain: the operator's own, else the regional SAN certificate. */
  public readonly apiCertificate?: acm.ICertificate;
  /** The certificate of the JMAP API's custom domain: the operator's own, else the regional SAN certificate. */
  public readonly jmapCertificate?: acm.ICertificate;
  /** The certificate of the WebSocket API's custom domain: the operator's own, else the regional SAN certificate. */
  public readonly wsCertificate?: acm.ICertificate;

  private readonly props: EdgeSectionProps;
  private readonly edgeStack: MailboxEdgeDeployer;

  constructor(scope: Construct, id: string, props: EdgeSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'edge');

    this.props      = props;
    this.hostedZone = props.hostedZone;

    const provided   = props.certificateOverrides;
    const domainName = props.addressing.domains.domainName;

    this.edgeStack = new MailboxEdgeDeployer(this, 'stack-deployer', {
      domainName,
      artifactResolver:  props.artifactResolver,
      prefix:            props.addressing.edgePrefix,
      hostedZone:        this.hostedZone,
      itemTable:         props.data.itemTable,
      configTable:       props.data.configTable,
      authKeyStoreTable: props.auth.authKeyStoreTable,
      productVersion:    props.productVersion,
      deployerType:      props.deployerType,
      logGroupName:      PipelineLogGroup.getOrCreate(this, 'jmap').logGroupName,
    });

    this.edgeCertificate            = this.edgeStack.edgeCertificate;
    this.jmapBlobDownloadVersionArn = this.edgeStack.getOutput('jmapBlobDownloadVersionArn');

    // Regional ACM certificates for regional services (API Gateway).
    // These must live in the same region as this stack (unlike CloudFront certs in us-east-1).
    // If either API certificate is missing and there is a hosted zone, one SAN certificate covers
    // the api, jmap, ws and mcp names and fills the gaps.
    let regionalSanCertificate: acm.ICertificate | undefined;
    let cfnCert: acm.CfnCertificate | undefined;
    if (this.hostedZone && (!provided?.api || !provided.jmap)) {
      const { hostedZoneId } = this.hostedZone;
      cfnCert                = new acm.CfnCertificate(this, 'regional-api-certificate', {
        domainName:              props.addressing.domains.api,
        subjectAlternativeNames: [props.addressing.domains.jmap, props.addressing.domains.ws, `mcp.${domainName}`],
        validationMethod:        'DNS',
        domainValidationOptions: [
          { domainName: props.addressing.domains.api, hostedZoneId },
          { domainName: props.addressing.domains.jmap, hostedZoneId },
          { domainName: props.addressing.domains.ws, hostedZoneId },
          { domainName: `mcp.${domainName}`, hostedZoneId },
        ],
      });
      ComponentDescription.describe(cfnCert, 'Regional ACM certificate covering the api, jmap, ws and mcp endpoints.');
      cfnCert.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
      regionalSanCertificate = acm.Certificate.fromCertificateArn(this, 'regional-api-certificate-ref', cfnCert.ref);
    }

    this.regionalCertificate = regionalSanCertificate;

    this.uiCertificate   = this.resolveUiCertificate();
    this.apiCertificate  = provided?.api ?? regionalSanCertificate;
    this.jmapCertificate = provided?.jmap ?? regionalSanCertificate;
    // WebSocket push uses the explicit override or else the regional SAN cert; it never creates its own.
    this.wsCertificate = provided?.ws ?? regionalSanCertificate;
  }

  /** Adds the CDN in front of the blob bucket; the UI origins it allows exist only once the UIs are built. */
  public addBlobCdn(props: BlobCdnProps): IBlobCdnEndpoint {
    const allowedOrigins = [...props.ui.adminUiOrigins, ...props.ui.webmailUiOrigins, ...(props.extraAllowedOrigins ?? [])];

    const cdn = new Cdn(this, 'blob-cdn', {
      blobStore:               this.props.data.blobStoreBucket,
      authKeyStoreTable:       this.props.auth.authKeyStoreTable,
      allowedOrigins:          allowedOrigins.length > 0 ? allowedOrigins : undefined,
      jmapBlobDownloadVersion: this.edgeStack.jmapBlobDownloadVersion,
      customDomain:            this.blobCdnCustomDomain(),
    });

    return { host: cdn.host, distributionDomainName: cdn.distribution.distributionDomainName };
  }

  /** Adds the DNS records when the mailbox has a hosted zone; their targets exist only once the UIs, the CDN and the API endpoints are built. */
  public addDns(props: EdgeDnsProps): void {
    if (!this.hostedZone) {
      return;
    }

    new MailboxDns(this, 'dns', {
      names:        this.props.addressing.domains,
      hostedZone:   this.hostedZone,
      cnameTargets: this.cnameTargets(props),
    });
  }

  private cnameTargets(props: EdgeDnsProps): MailboxDnsCnameTargets {
    return {
      admin:   props.ui.adminUiCnameTarget,
      webmail: props.ui.webmailUiCnameTarget,
      cdn:     props.blobCdn.distributionDomainName,
      api:     props.apis.adminApiDomainTarget,
      jmap:    props.apis.jmapApiDomainTarget,
      ws:      props.apis.webSocketDomainTarget,
      mcp:     props.apis.mcpApiDomainTarget,
    };
  }

  private resolveUiCertificate(): acm.ICertificate | undefined {
    if (!this.hostedZone) {
      return undefined;
    }
    if (!this.edgeCertificate) {
      throw new Error('hostedZone was provided but edge certificate was not created');
    }
    return this.edgeCertificate;
  }

  private blobCdnCustomDomain(): CdnCustomDomain | undefined {
    const certificate = this.hostedZone ? this.edgeCertificate : this.props.certificateOverrides?.cloudFront;

    return certificate ? { name: this.props.addressing.domains.cdn, certificate } : undefined;
  }
}
