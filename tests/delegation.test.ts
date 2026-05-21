import { describe, expect, it } from "vitest";
import { buildBuildingDelegationRequest } from "../src/delegation";
import { parseArgs } from "../src/utils";

describe("buildBuildingDelegationRequest", () => {
  it("builds list, save, and delete requests for Building Delegation", () => {
    expect(buildBuildingDelegationRequest(parseArgs(["delegation", "list"]))).toEqual({
      method: "GET",
      path: "/api/me/building-delegations"
    });

    expect(buildBuildingDelegationRequest(parseArgs(["delegation", "save", "--units", "10"]), "0xdelegate")).toEqual({
      method: "POST",
      path: "/api/me/building-delegations",
      body: {
        delegateAddress: "0xdelegate",
        miniBuildingUnits: 10
      }
    });

    expect(buildBuildingDelegationRequest(parseArgs(["delegation", "delete", "--delegate", "0xdelegate"]))).toEqual({
      method: "DELETE",
      path: "/api/me/building-delegations",
      body: {
        delegateAddress: "0xdelegate"
      }
    });
  });

  it("rejects missing or invalid delegation inputs", () => {
    expect(() => buildBuildingDelegationRequest(parseArgs(["delegation"]))).toThrow("delegation subcommand");
    expect(() => buildBuildingDelegationRequest(parseArgs(["delegation", "save"]))).toThrow("--delegate is required");
    expect(() => buildBuildingDelegationRequest(parseArgs(["delegation", "save", "--delegate", "0xdelegate"]))).toThrow("--units is required");
    expect(() => buildBuildingDelegationRequest(parseArgs(["delegation", "save", "--delegate", "0xdelegate", "--units", "0"]))).toThrow(
      "--units must be a positive integer"
    );
  });
});
