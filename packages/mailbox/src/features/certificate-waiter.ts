import { CustomResource } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { CertWaiterLambda } from '../lambdas';

export interface CertificateWaiterProps {
  /** The certificate to wait for disassociation on delete. */
  certificate: ICertificate;
  /** The cert-waiter Lambda function to use as the custom resource service token. */
  certWaiterLambda: CertWaiterLambda;
}

export class CertificateWaiter extends Construct {
  constructor(scope: Construct, id: string, props: CertificateWaiterProps) {
    super(scope, id);

    props.certWaiterLambda.addToRolePolicy(new PolicyStatement({
      actions: ['acm:DescribeCertificate'],
      resources: [props.certificate.certificateArn],
    }));

    const cr = new CustomResource(this, 'resource', {
      serviceToken: props.certWaiterLambda.functionArn,
      resourceType: 'Custom::CertificateWaiter',
      properties: {
        resourceKind: 'cert-waiter',
        certificateArn: props.certificate.certificateArn,
      },
    });

    // Cert-waiter must be created after the cert (so it can reference the ARN),
    // and deleted BEFORE the cert (CFN reversal) — which is what we want: waiter
    // polls until InUseBy clears, then cert delete proceeds.
    cr.node.addDependency(props.certificate);
  }
}
