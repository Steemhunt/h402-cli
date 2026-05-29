import type { UsdcDecimals, X402Network, X402Version } from "./constants.js";

export type X402PaymentRequirements = {
  scheme: "exact";
  network: X402Network;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: {
    routeId?: string;
    providerAmount?: string;
    h402FeeAmount?: string;
    assetTransferMethod?: "eip3009" | string;
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
};

export type X402PaymentResource = {
  url: string;
  method?: string;
  description?: string;
  mimeType: "application/json";
  serviceName?: "h402";
  tags?: string[];
};

export type X402PaymentRequired = {
  x402Version: X402Version;
  error?: string;
  /**
   * Present on responses h402 produces. Optional because the CLI decodes
   * arbitrary x402 responses where it may be absent.
   */
  resource?: X402PaymentResource;
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown> & {
    "h402-credit"?: H402CreditExtension;
    "h402-route"?: H402RouteExtension;
  };
};

export type X402PaymentPayload = {
  x402Version: X402Version;
  accepted: X402PaymentRequirements;
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
    signature: `0x${string}`;
  };
  resource?: X402PaymentResource;
  extensions?: Record<string, unknown>;
};

export type X402Settlement = {
  success: true;
  transaction: string;
  network: X402Network;
  payer: string;
  amount: string;
  extensions: {
    h402: {
      routeId: string;
      paidBy: "x402-exact" | "mock-x402-exact";
    };
  };
};

type UsdcAsset = {
  network: X402Network;
  address: string;
  symbol: "USDC";
  decimals: UsdcDecimals;
};

export type H402CreditExtension = {
  version: "1";
  type: "weekly-free-credit";
  routeId: string;
  requiredAmount: string;
  asset: UsdcAsset;
  auth: {
    scheme: "bearer";
    challengePath: "/api/auth/challenge";
    verifyPath: "/api/auth/verify";
    creditsPath: "/api/me/credits";
  };
  delegation: {
    path: "/api/me/building-delegations";
    unit: "mini-building";
    note: string;
  };
};

export type H402RouteExtension = {
  version: "1";
  type: "curated-proxy-route";
  routeId: string;
  aggregatedBy: "h402";
  sourceProvider?: string;
  upstreamProvider?: string;
  upstreamUrl?: string;
  pricing: {
    model: "final-h402-proxy-price" | "dynamic-h402-proxy-price";
    asset: UsdcAsset;
    providerAmount: string;
    h402FeeAmount: string;
    totalAmount: string;
    note: string;
  };
  quote?: {
    quoteId: string;
    requestFingerprint: string;
  };
  termsNote?: string;
};

export type H402PaymentContext = {
  quoteId?: string;
  requestFingerprint?: string;
  pricingModel?: H402RouteExtension["pricing"]["model"];
};
