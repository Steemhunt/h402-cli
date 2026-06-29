import { describe, expect, it } from "vitest";
import { CliError, errorEnvelope } from "../src/errors";

describe("errorEnvelope", () => {
  it("wraps a plain Error as { error: { message } } with no detail", () => {
    expect(errorEnvelope(new Error("Flag --method must be GET or POST (got \"PUT\")."))).toEqual({
      error: { message: "Flag --method must be GET or POST (got \"PUT\")." }
    });
  });

  it("includes structured detail from a CliError", () => {
    const detail = { error: { code: "provider_native_field_requires_pinning", message: "pin it" } };
    expect(errorEnvelope(new CliError("Request failed: 422: pin it", detail))).toEqual({
      error: { message: "Request failed: 422: pin it", detail }
    });
  });

  it("omits detail when a CliError carries none (empty-body failure)", () => {
    expect(errorEnvelope(new CliError("Request failed: 405"))).toEqual({ error: { message: "Request failed: 405" } });
  });

  it("stringifies a non-Error throwable", () => {
    expect(errorEnvelope("nope")).toEqual({ error: { message: "nope" } });
  });
});
