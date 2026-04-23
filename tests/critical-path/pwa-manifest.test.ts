import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// manifest.webmanifest 파일 직접 읽기
const manifestPath = join(__dirname, "../../public/manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

describe("Feature: PWA 설치 가능", () => {
  describe("Scenario: Chrome 설치 배너 최소 요건", () => {
    it("Given manifest, When 검사, Then name/short_name/start_url/display/icons(192,512) 모두 존재", () => {
      // Given: 파일 로드
      const m = manifest as any;
      // When/Then
      expect(m.name).toBe("VAL-Shop");
      expect(m.short_name).toBeTruthy();
      expect(m.start_url).toBe("/dashboard");
      expect(m.display).toBe("standalone");
      expect(m.theme_color).toMatch(/^#/);
      const sizes = m.icons.map((i: any) => i.sizes);
      expect(sizes).toContain("192x192");
      expect(sizes).toContain("512x512");
      expect(m.icons.some((i: any) => i.purpose?.includes("maskable"))).toBe(true);
    });

    it("Given manifest, When 검사, Then scope 이 / 이다", () => {
      const m = manifest as any;
      expect(m.scope).toBe("/");
    });

    it("Given manifest, When 검사, Then lang 이 ko 이다", () => {
      const m = manifest as any;
      expect(m.lang).toBe("ko");
    });
  });
});
