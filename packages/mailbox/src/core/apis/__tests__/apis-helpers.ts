import * as acm                          from 'aws-cdk-lib/aws-certificatemanager';
import { Table, AttributeType }          from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { DataTable }                     from '../../../resources/tables/data-tables';

/** A stack in a fixed account and region, synthesized without a bootstrap bucket, as the APIs are deployed. */
export function newApiStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** A data table with the string partition key every API test needs. */
export function dataTable(stack: cdk.Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
}

/** A DNS-validated certificate for `domainName`, the input a custom-domain API takes. */
export function certificate(stack: cdk.Stack, domainName: string): acm.Certificate {
  return new acm.Certificate(stack, 'certificate', {
    domainName,
    validation: acm.CertificateValidation.fromDns(),
  });
}
