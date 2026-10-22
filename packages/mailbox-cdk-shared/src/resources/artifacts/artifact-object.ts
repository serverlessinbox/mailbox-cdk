import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Grant }                  from 'aws-cdk-lib/aws-iam';
import type { IGrantable }        from 'aws-cdk-lib/aws-iam';

/** One object of a published artifact, and the permission to read it. */
export interface IArtifactObject {
  /** Lets the grantee read the object, for a service that fetches it with the grantee's identity. */
  grantRead(grantee: IGrantable): void;
}

/** The object `objectName` of the package `packageName`, located by the artifact resolver. */
export class ArtifactObject implements IArtifactObject {
  private readonly objectArn: string;

  constructor(artifactResolver: IArtifactResolver, packageName: string, objectName: string) {
    this.objectArn = artifactResolver.getArn(packageName, objectName);
  }

  public grantRead(grantee: IGrantable): void {
    Grant.addToPrincipal({ grantee, actions: ['s3:GetObject', 's3:GetObjectVersion'], resourceArns: [this.objectArn] });
  }
}
