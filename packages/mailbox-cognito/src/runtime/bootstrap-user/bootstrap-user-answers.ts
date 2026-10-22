import type { CustomResourceAnswer, PhysicalResourceId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Marker returned in Data.temporaryPassword when password was set at install time and is not recoverable. */
export const PASSWORD_SET_AT_INSTALL_TIME = '(password set at install time)';

/** The attributes of the custom resource; the construct reads `temporaryPassword` through `GetAtt`. */
export type BootstrapUserAnswerData = {
  readonly temporaryPassword: string;
};

/** An answer to CloudFormation that reports the password, with a physical id when it carries one. */
export interface BootstrapUserAnswer extends CustomResourceAnswer {
  readonly Data: BootstrapUserAnswerData;
}

/** Builds the answers of the bootstrap user Lambda, so that every one of them carries the `temporaryPassword` attribute. */
export class BootstrapUserAnswers {
  /** Reports `temporaryPassword`; without a physical id CloudFormation keeps the one the resource has. */
  public static withPassword(temporaryPassword: string, physicalResourceId?: PhysicalResourceId): BootstrapUserAnswer {
    if (physicalResourceId === undefined) {
      return { Data: { temporaryPassword } };
    }
    return { PhysicalResourceId: physicalResourceId, Data: { temporaryPassword } };
  }

  /** Reports the marker for a password that is not recoverable. */
  public static withPasswordMarker(physicalResourceId?: PhysicalResourceId): BootstrapUserAnswer {
    return BootstrapUserAnswers.withPassword(PASSWORD_SET_AT_INSTALL_TIME, physicalResourceId);
  }
}
