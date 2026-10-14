import type { NewUpdateCycle, UpdaterTrigger } from './updater-trigger';

/**
 * Runs the update cycle for the scheduled run and the self-invoke of the HTTP trigger, which carry no payload
 * the updater reads. Whoever invoked the function sees a failure, so a bad configuration and a failed cycle
 * are both thrown.
 */
export class ScheduledTrigger implements UpdaterTrigger<void> {
  private readonly newUpdateCycle: NewUpdateCycle;

  constructor(newUpdateCycle: NewUpdateCycle) {
    this.newUpdateCycle = newUpdateCycle;
  }

  /** Throws the configuration error when the configuration failed to load, or what the update cycle throws. */
  public async handle(): Promise<void> {
    await this.newUpdateCycle().run();
  }

  public answerFailure(failure: unknown): never {
    throw failure;
  }
}
