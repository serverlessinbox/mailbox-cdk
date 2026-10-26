import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/** A grant method that records its grantee. */
export type GrantSpy = jest.Mock<void, [IGrantable]>;

/**
 * Fakes for the narrow resource interfaces a Lambda wrapper receives. Each grant is a spy that
 * records its grantee and renders no policy, so a wrapper test sees the grants the wrapper requests
 * and the statements it adds itself; the statement a grant renders is pinned by the resource that
 * owns it. Names are plain strings, so an environment assertion compares the exact value written.
 */

function grantSpy(): GrantSpy {
  return jest.fn<void, [IGrantable]>();
}

/** Stands in for the `IDataTable` of a config, item, changelog or mail-feedback table. */
export function fakeDataTable(name: string) {
  return { tableName: name, tableArn: `arn:fake:${name}`, grantRead: grantSpy(), grantReadWrite: grantSpy() };
}

/** Stands in for the `IAuthKeyStoreTable`. */
export function fakeAuthKeyStoreTable(name: string) {
  return { tableName: name, tableArn: `arn:fake:${name}`, grantGetItem: grantSpy(), grantRead: grantSpy(), grantReadWrite: grantSpy() };
}

/** Stands in for the `IWebSocketTable` that holds the connections. */
export function fakeWebSocketTable(name: string) {
  return { tableName: name, grantStoreConnection: grantSpy(), grantRemoveConnection: grantSpy(), grantBroadcast: grantSpy() };
}

/** Stands in for the `IDataBlobStore`. */
export function fakeDataBlobStore(name: string) {
  return {
    bucketName:                        name,
    grantEmailBlobWrite:               grantSpy(),
    grantEmailBlobRead:                grantSpy(),
    grantEmailBlobReadWriteDelete:     grantSpy(),
    grantUploadBlobReadWriteDelete:    grantSpy(),
    grantIncomingEmailConsume:         grantSpy(),
    grantContactBlobReadWriteDelete:   grantSpy(),
    grantPrincipalBlobReadWriteDelete: grantSpy(),
    grantSearchIndexRead:              grantSpy(),
    grantSearchIndexReadWrite:         grantSpy(),
  };
}

/** Stands in for any queue interface: the sending side, the consuming side or both. */
export function fakeQueue(name: string) {
  return { queueUrl: `https://sqs.fake/${name}`, queueArn: `arn:fake:${name}`, grantSend: grantSpy(), grantConsume: grantSpy() };
}

/** Stands in for the `IIdentityProvisioner`. */
export function fakeIdentityProvisioner(name: string) {
  return { functionArn: `arn:fake:${name}`, functionName: name, grantInvoke: grantSpy() };
}

/** Stands in for the `ITemplateVersionParam`. */
export function fakeTemplateVersionParam(parameterName: string) {
  return { parameterName, grantRead: grantSpy() };
}

/** Asserts that a grant was requested exactly once, for the given grantee. */
export function expectGrantedOnceTo(spy: GrantSpy, grantee: IGrantable): void {
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(grantee);
}
