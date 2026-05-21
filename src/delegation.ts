import { flagString, requireValue, type ParsedArgs } from "./utils.js";

export type BuildingDelegationRequest = {
  method: "GET" | "POST" | "DELETE";
  path: "/api/me/building-delegations";
  body?: {
    delegateAddress: string;
    miniBuildingUnits?: number;
  };
};

export function buildBuildingDelegationRequest(args: ParsedArgs, defaultDelegateAddress?: string): BuildingDelegationRequest {
  const subcommand = requireValue(args.positional[1], "delegation subcommand is required");
  const path = "/api/me/building-delegations";

  if (subcommand === "list") {
    return { method: "GET", path };
  }

  const delegateAddress = requireValue(flagString(args.flags, "delegate", defaultDelegateAddress), "--delegate is required");

  if (subcommand === "save") {
    const rawUnits = requireValue(flagString(args.flags, "units"), "--units is required");
    const miniBuildingUnits = Number(rawUnits);
    if (!Number.isInteger(miniBuildingUnits) || miniBuildingUnits <= 0) {
      throw new Error("--units must be a positive integer");
    }

    return {
      method: "POST",
      path,
      body: {
        delegateAddress,
        miniBuildingUnits
      }
    };
  }

  if (subcommand === "delete") {
    return {
      method: "DELETE",
      path,
      body: { delegateAddress }
    };
  }

  throw new Error(`Unknown delegation subcommand: ${subcommand}`);
}
