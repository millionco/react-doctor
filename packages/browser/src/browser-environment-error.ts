// A browser failure caused by the machine's environment, not a react-doctor bug:
// no Google Chrome to launch, the optional `playwright-core` dependency not
// installed, or no debuggable Chrome to attach to. The CLI renders these as a
// plain, actionable message and keeps them out of crash reporting (Sentry + the
// error-rate metric) — see the CLI's `isExpectedUserError`. The message is the
// fix instruction; throw sites phrase it for the user.
export class BrowserEnvironmentError extends Error {
  override readonly name = "BrowserEnvironmentError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export const isBrowserEnvironmentError = (error: unknown): error is BrowserEnvironmentError =>
  error instanceof BrowserEnvironmentError;
