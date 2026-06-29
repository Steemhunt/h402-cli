// A CLI error that can carry structured `detail` (e.g. the backend's parsed JSON error
// body) so the top-level handler can surface it in the machine-readable stderr envelope.
export class CliError extends Error {
  readonly detail?: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "CliError";
    this.detail = detail;
  }
}

// Every failure exits non-zero and writes this single shape to stderr as JSON, so an
// agent can parse one envelope for all error paths (validation, backend, empty-body,
// non-JSON): `message` is always a human-readable diagnostic; `detail` is present only
// when there is a structured backend error body to expose.
export function errorEnvelope(error: unknown): { error: { message: string; detail?: unknown } } {
  if (error instanceof CliError && error.detail !== undefined) {
    return { error: { message: error.message, detail: error.detail } };
  }
  return { error: { message: error instanceof Error ? error.message : String(error) } };
}
