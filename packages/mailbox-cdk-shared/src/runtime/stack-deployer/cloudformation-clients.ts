import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';

import type { Region }               from '../../runtime/handler-kit/aws-identifiers';

/**
 * The CloudFormation clients of the regions a stack operation runs in, each built on first use and then
 * reused. The entry point supplies how a client is built; this class only decides when.
 */
export class CloudFormationClients {
  private readonly build: (region: Region) => CloudFormationClient;
  private readonly clients = new Map<Region, CloudFormationClient>();

  constructor(build: (region: Region) => CloudFormationClient) {
    this.build = build;
  }

  forRegion(region: Region): CloudFormationClient {
    let client = this.clients.get(region);
    if (!client) {
      client = this.build(region);
      this.clients.set(region, client);
    }
    return client;
  }
}
