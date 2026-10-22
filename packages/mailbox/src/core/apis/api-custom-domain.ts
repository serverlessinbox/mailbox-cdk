import { CfnDomainName, DomainName, EndpointType, SecurityPolicy }  from 'aws-cdk-lib/aws-apigatewayv2';
import type * as acm                                                from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct }                                           from 'constructs';

/** The domain name an API is served on and the certificate it is served with. */
export interface ApiCustomDomainProps {
  /** Fully qualified domain name the API is served on. */
  readonly domainName: string;
  /** Regional ACM certificate that covers `domainName`, in the same region as the API. */
  readonly certificate: acm.ICertificate;
}

/** The capability to fix the logical id of a resource, without exposing the resource itself. */
export interface ILogicalIdPin {
  overrideLogicalId(logicalId: string): void;
}

/**
 * The regional, TLS 1.2 API Gateway custom domain name of one API. The domain depends on its
 * certificate, so CloudFormation deletes the domain before the certificate.
 *
 * It does not map an API onto itself (the API creates its own `ApiMapping`) and creates no DNS record.
 */
export class ApiCustomDomain extends DomainName {
  /**
   * Fixes the logical id of the domain name resource.
   *
   * API Gateway custom domain names are unique per account and region, so a replacement cannot be
   * created beside the existing domain name and create-before-delete fails on a name collision.
   * A fixed logical id keeps CloudFormation updating the same domain name in place.
   */
  public readonly logicalIdPin: ILogicalIdPin;

  constructor(scope: Construct, id: string, props: ApiCustomDomainProps) {
    super(scope, id, {
      domainName:     props.domainName,
      certificate:    props.certificate,
      endpointType:   EndpointType.REGIONAL,
      securityPolicy: SecurityPolicy.TLS_1_2,
    });

    this.node.addDependency(props.certificate);

    const domainName = this.node.defaultChild;

    if (!(domainName instanceof CfnDomainName)) {
      throw new Error(`ApiCustomDomain ${this.node.path}: the default child is not a CfnDomainName`);
    }

    this.logicalIdPin = domainName;
  }
}
