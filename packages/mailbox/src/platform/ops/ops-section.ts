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

/** Props of {@link OpsSection}. */
export interface OpsSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly configTable: IDataTable;
  readonly domainName: string;
  readonly vendorAccountIds: string[];
  /** Default: {@link SendStackFailuresMode.ENABLED}. */
  readonly sendStackFailures?: SendStackFailuresMode;
  /** The version ARN of the edge sub-stack's JMAP blob download function, a deploy-time token. */
  readonly jmapBlobDownloadVersionArn: string;
  /** The regional API certificate this stack created, when it created one; it is retained and swept on removal. */
  readonly regionalCertificate?: acm.ICertificate;
}

/** The operational pieces around the mail server: license refresh, stack-failure detection and the cleanup of retained resources. */
export class OpsSection extends Construct {
  constructor(scope: Construct, id: string, props: OpsSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ops');

    new LicenseRefresh(this, 'license-refresh', {
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
      coreDomain: props.domainName,
      vendorAccountIds: props.vendorAccountIds,
    });

    // Stack-failure detector: watches the root stack's own terminal `CloudFormation Stack
    // Status Change` events. A terminal stack status is emitted only after the whole operation
    // concludes, so the detector has no ordering requirement relative to its ops-group siblings.
    // Consent defaults to ENABLED; `disabled` synthesizes zero detector resources (see
    // StackFailureDetection for the CfnCondition gating). Built before SweeperInfra: its retained
    // rule/function/role are registered below as one removal, and the sweeper's worker IAM policy
    // is assembled from the registered removals.
    const stackFailureDetection = new StackFailureDetection(this, 'stack-failure-detection', {
      mode: props.sendStackFailures ?? SendStackFailuresMode.ENABLED,
      artifactResolver: props.artifactResolver,
      vendorAccountIds: props.vendorAccountIds,
    });

    const edgeFunction = this.importEdgeFunction(props.jmapBlobDownloadVersionArn);

    // Each retained resource is registered as its own removal.
    const removals: IResourceRemoval[] = [];
    if (props.regionalCertificate) {
      removals.push(new CertificateRemoval(this, 'cert-removal', { certificate: props.regionalCertificate }));
    }
    removals.push(new EdgeFunctionRemoval(this, 'edge-fn-removal', { function: edgeFunction }));
    if (stackFailureDetection.sweepTargets) {
      removals.push(new StackFailureDetectorRemoval(this, 'stack-failure-detector-removal', stackFailureDetection.sweepTargets));
    }

    // Resource sweeper (Step Functions + worker Lambda): asynchronous cleanup of the retained
    // resources after stack deletion.
    const sweeperInfra = new SweeperInfra(this, 'sweeper-infra', {
      artifactResolver: props.artifactResolver,
      removals,
    });

    // Fires the sweeper's starter Lambda on stack Delete or Update. CloudFormation supplies
    // `OldResourceProperties` on Update, so the starter can sweep only what changed; on Delete it
    // sweeps everything present.
    new DeferredRemoval(this, 'deferred-removal', {
      sweeperStarter: sweeperInfra.starter,
      removals,
    });
  }

  private importEdgeFunction(versionArn: string): awslambda.IFunction {
    // Extract the edge jmap-blob-download Lambda ARN (strip version qualifier).
    // Version ARN:  arn:aws:lambda:us-east-1:<acct>:function:<name>:<version>
    // Function ARN: arn:aws:lambda:us-east-1:<acct>:function:<name>
    const fnArnParts      = Fn.split(':', versionArn);
    const edgeFunctionArn = Fn.join(':', [
      Fn.select(0, fnArnParts), // arn
      Fn.select(1, fnArnParts), // aws
      Fn.select(2, fnArnParts), // lambda
      Fn.select(3, fnArnParts), // us-east-1
      Fn.select(4, fnArnParts), // account
      Fn.select(5, fnArnParts), // function
      Fn.select(6, fnArnParts), // <function-name>
      // Fn.select(7, ...) is the version number — intentionally dropped
    ]);
    // Imported by ARN: the JMAP blob download function lives in the separate edge sub-stack, so there is no
    // construct reference to it.
    return awslambda.Function.fromFunctionArn(this, 'edge-fn-removal-target', edgeFunctionArn);
  }
}
