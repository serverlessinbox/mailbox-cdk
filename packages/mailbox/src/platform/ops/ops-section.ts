import type { IArtifactResolver }                         from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }               from '@serverlessinbox/mailbox-cdk-shared';
import type * as acm                                      from 'aws-cdk-lib/aws-certificatemanager';
import * as awslambda                                     from 'aws-cdk-lib/aws-lambda';
import { Fn }                                             from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';

import type { IDataTable }                                from '../../resources/tables/data-tables';

import { LicenseRefresh }                                 from './license-refresh';
import { StackFailureDetection, SendStackFailuresMode }   from './stack-failure-detection';
import { CertificateRemoval }                             from './sweeper/certificate-removal';
import { DeferredRemoval }                                from './sweeper/deferred-removal';
import { EdgeFunctionRemoval }                            from './sweeper/edge-function-removal';
import type { IResourceRemoval }                          from './sweeper/removal';
import { StackFailureDetectorRemoval }                    from './sweeper/stack-failure-detector-removal';
import { SweeperInfra }                                   from './sweeper/sweeper-infra';

/** What {@link OpsSection} uses of the data section. */
export interface IOpsDataInputs {
  readonly configTable: IDataTable;
}

/** What {@link OpsSection} uses of the edge section. */
export interface IOpsEdgeInputs {
  /** The version ARN of the edge sub-stack's JMAP blob download function, a deploy-time token. */
  readonly jmapBlobDownloadVersionArn: string;
  /** The regional API certificate this stack created, when it created one; it is retained and swept on removal. */
  readonly regionalCertificate?: acm.ICertificate;
}

/** Props of {@link OpsSection}. */
export interface OpsSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly vendorAccountIds: string[];
  /** The domain name the mailbox serves; a deploy-time token when it comes from a hosted zone. */
  readonly domainName:       string;
  /** Default: {@link SendStackFailuresMode.ENABLED}. */
  readonly sendStackFailures?: SendStackFailuresMode;
  readonly data:               IOpsDataInputs;
  readonly edge:               IOpsEdgeInputs;
}

/** The operational pieces around the mail server: license refresh, stack-failure detection and the cleanup of retained resources. */
export class OpsSection extends Construct {
  constructor(scope: Construct, id: string, props: OpsSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ops');

    new LicenseRefresh(this, 'license-refresh', {
      configTable:      props.data.configTable,
      artifactResolver: props.artifactResolver,
      coreDomain:       props.domainName,
      vendorAccountIds: props.vendorAccountIds,
    });

    const stackFailureDetection = new StackFailureDetection(this, 'stack-failure-detection', {
      mode:             props.sendStackFailures ?? SendStackFailuresMode.ENABLED,
      artifactResolver: props.artifactResolver,
      vendorAccountIds: props.vendorAccountIds,
    });

    const edgeFunction = this.importEdgeFunction(props.edge.jmapBlobDownloadVersionArn);

    const removals: IResourceRemoval[] = [];
    if (props.edge.regionalCertificate) {
      removals.push(new CertificateRemoval(this, 'cert-removal', { certificate: props.edge.regionalCertificate }));
    }
    removals.push(new EdgeFunctionRemoval(this, 'edge-fn-removal', { function: edgeFunction }));
    if (stackFailureDetection.sweepTargets) {
      removals.push(new StackFailureDetectorRemoval(this, 'stack-failure-detector-removal', stackFailureDetection.sweepTargets));
    }

    const sweeperInfra = new SweeperInfra(this, 'sweeper-infra', {
      artifactResolver: props.artifactResolver,
      removals,
    });

    new DeferredRemoval(this, 'deferred-removal', {
      sweeperStarter: sweeperInfra.starter,
      removals:       [...removals, sweeperInfra.workerRoleRemoval],
    });
  }

  private importEdgeFunction(versionArn: string): awslambda.IFunction {
    // Extract the edge jmap-blob-download Lambda ARN (strip version qualifier).
    // Version ARN:  arn:aws:lambda:us-east-1:<acct>:function:<name>:<version>
    // Function ARN: arn:aws:lambda:us-east-1:<acct>:function:<name>
    const fnArnParts      = Fn.split(':', versionArn);
    const edgeFunctionArn = Fn.join(':', [
      Fn.select(0, fnArnParts),
      Fn.select(1, fnArnParts),
      Fn.select(2, fnArnParts),
      Fn.select(3, fnArnParts),
      Fn.select(4, fnArnParts),
      Fn.select(5, fnArnParts),
      Fn.select(6, fnArnParts),
    ]);
    // Imported by ARN: the JMAP blob download function lives in the separate edge sub-stack, so there is no
    // construct reference to it.
    return awslambda.Function.fromFunctionArn(this, 'edge-fn-removal-target', edgeFunctionArn);
  }
}
