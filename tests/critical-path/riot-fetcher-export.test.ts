/**
 * Plan 0017 Phase 1: RiotFetcher export 네이밍 회귀
 */

import { describe, it, expect } from "vitest";
import * as fetcherModule from "@/lib/riot/fetcher";

describe("Feature: RiotFetcher export 네이밍", () => {
  it("given_fetcher_module_when_import_then_httpRiotFetcher_export_존재", () => {
    // Given/When
    const exported = fetcherModule;
    // Then
    expect(exported.httpRiotFetcher).toBeDefined();
    expect(typeof exported.httpRiotFetcher.get).toBe("function");
    expect(typeof exported.httpRiotFetcher.fetch).toBe("function");
  });

  it("given_fetcher_module_when_import_then_defaultRiotFetcher_제거됨", () => {
    // Given/When
    const exported = fetcherModule as Record<string, unknown>;
    // Then
    expect(exported.defaultRiotFetcher).toBeUndefined();
  });
});
