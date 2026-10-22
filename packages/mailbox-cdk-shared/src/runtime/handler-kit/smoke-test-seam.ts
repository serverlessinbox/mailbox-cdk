import { isSmokeTestProbeShape, type Check, type SmokeTestResponse } from './smoke-test';

/**
 * Lets a deployed function say whether its code and its configuration still fit together, without doing any real
 * work: it recognises a probe and answers it from the registered checks. It never reaches the wrapped handler, so it
 * reports only on initialisation health, not on how the handler behaves.
 */
export class SmokeTestSeam {
  private readonly checks: readonly Check[];

  constructor(checks: readonly Check[]) {
    this.checks = checks;
  }

  /** True for the probe object itself or for JSON text of it; any other event, including text that is not JSON, is real traffic. */
  public isProbe(event: unknown): boolean {
    const payload = typeof event === 'string' ? this.parseJson(event) : event;
    return isSmokeTestProbeShape(payload);
  }

  public async answer(): Promise<SmokeTestResponse> {
    return { serverlessInboxSmokeTestOk: await this.allChecksPass() };
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** Runs the checks in order and stops at the first one that throws. */
  private async allChecksPass(): Promise<boolean> {
    for (const check of this.checks) {
      try {
        await check();
      } catch {
        return false;
      }
    }
    return true;
  }
}
