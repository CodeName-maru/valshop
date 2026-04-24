/**
 * MSW Handlers for Riot Auth API
 * Provides mocked responses for entitlements and userinfo endpoints
 */

import { http, HttpResponse } from "msw";

const ENTITLEMENTS_BASE = "https://entitlements.auth.riotgames.com";
const AUTH_BASE = "https://auth.riotgames.com";

export const riotHandlers = {
  /**
   * Successful entitlements token response
   */
  success: http.post(`${ENTITLEMENTS_BASE}/api/token/v1`, () => {
    return HttpResponse.json({
      entitlements_token: "mock-entitlements-jwt",
    });
  }),

  /**
   * Successful userinfo response
   */
  userinfoSuccess: http.get(`${AUTH_BASE}/userinfo`, () => {
    return HttpResponse.json({
      sub: "mock-puuid-12345",
      email: "test@example.com",
      country: "KR",
      // Other PII fields that should NOT be stored
    });
  }),

  /**
   * Entitlements 500 error
   */
  entitlementsError: http.post(`${ENTITLEMENTS_BASE}/api/token/v1`, () => {
    return HttpResponse.json({}, { status: 500 });
  }),

  /**
   * Userinfo 500 error
   */
  userinfoError: http.get(`${AUTH_BASE}/userinfo`, () => {
    return HttpResponse.json({}, { status: 500 });
  }),

  /**
   * Entitlements timeout (delay > 3s)
   */
  entitlementsTimeout: http.post(`${ENTITLEMENTS_BASE}/api/token/v1`, async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return HttpResponse.json({
      entitlements_token: "mock-entitlements-jwt",
    });
  }),

  /**
   * Userinfo timeout
   */
  userinfoTimeout: http.get(`${AUTH_BASE}/userinfo`, async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return HttpResponse.json({
      sub: "mock-puuid-12345",
    });
  }),
};

/**
 * Default handlers for successful auth flow
 */
export const defaultRiotHandlers = [
  riotHandlers.success,
  riotHandlers.userinfoSuccess,
];
