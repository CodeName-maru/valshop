/**
 * Riot Storefront API (Server-side)
 * Worker-specific implementation that takes token objects as parameters
 */

import { decrypt } from "@/lib/crypto/aes-gcm";

/**
 * Storefront API response (simplified)
 */
export interface StorefrontResponse {
  skinUuids: string[];
  endsAtEpoch: number;
}

/**
 * Storefront fetcher interface (for dependency injection)
 */
export interface StorefrontClient {
  /**
   * Fetch storefront for a user
   * @throws Error if API call fails (401, 429, 5xx, etc.)
   */
  fetchStore(params: {
    puuid: string;
    accessToken: string;
    entitlementsJwt: string;
    region?: string;
  }): Promise<StorefrontResponse>;
}

/**
 * Riot Storefront API error
 */
export class StorefrontApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public isAuthError: boolean = false
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

/**
 * Parse Riot Storefront JSON response
 *
 * @param json - Storefront API response
 * @returns Parsed storefront data
 */
export function parseStorefrontJson(json: unknown): {
  skinUuids: string[];
  endsAtEpoch: number;
} {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid storefront response: not an object");
  }

  const data = json as Record<string, unknown>;
  const skinsPanel = data.SkinsPanelLayout as Record<string, unknown> | undefined;

  if (!skinsPanel || typeof skinsPanel !== "object") {
    throw new Error("Missing SkinsPanelLayout in response");
  }

  const offers = skinsPanel.SingleItemStoreOffers as Array<{ OfferID: string }> | undefined;
  if (!Array.isArray(offers)) {
    throw new Error("SingleItemStoreOffers is not an array");
  }

  const remainingSeconds = (skinsPanel.SingleItemOffersRemainingDurationInSeconds as number) ?? 0;

  return {
    skinUuids: offers.map((o) => o.OfferID),
    endsAtEpoch: Math.floor(Date.now() / 1000) + remainingSeconds,
  };
}

/**
 * Create real Riot Storefront client
 *
 * @param fetcher - HTTP fetcher (default: global fetch)
 * @returns StorefrontClient instance
 */
export function createStorefrontClient(fetcher: typeof fetch = fetch): StorefrontClient {
  return {
    async fetchStore(params): Promise<StorefrontResponse> {
      const { puuid, accessToken, entitlementsJwt, region = "kr" } = params;

      const url = `https://pd.${region}.a.pvp.net/store/v2/storefront/${puuid}`;

      const response = await fetcher(url, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Riot-Entitlements-JWT": entitlementsJwt,
          "X-Riot-ClientPlatform": "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2NjQtbTY0X3N0ZWFtaV9zaGlwcGluZyIsDQoJInBsYXRmb3JtQ2h1bmtJZCI6ICI5ZDRkMTY5Mi0zNjJiLTExZWItOTIzZC0xNDI4Nzg4MDQ2NDMiLA0KfQ==",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new StorefrontApiError("Unauthorized: token expired", 401, true);
        }
        throw new StorefrontApiError(
          `Storefront API error: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const json: unknown = await response.json();
      return parseStorefrontJson(json);
    },
  };
}
