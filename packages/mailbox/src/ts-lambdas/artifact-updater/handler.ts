import { ExpectedFailure }          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { Context }             from 'aws-lambda';

import type { HttpTriggerResponse } from './http-trigger';
import { TriggerDetector }          from './trigger-detector';
import { UpdaterComposition }       from './updater-composition';

const runtime = UpdaterComposition.loadRuntime();

export const handler = async (event: unknown, context: Context): Promise<HttpTriggerResponse | void> => {
  const composition = new UpdaterComposition(runtime);
  const trigger     = new TriggerDetector(composition).detect(event, context);

  try {
    return await trigger.handle();
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      composition.logger.flush();
    }
    return trigger.answerFailure(failure);
  }
};
