import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// manifest.webmanifest 파일 직접 읽기
const manifestPath = join(__dirname, "../../public/manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("Feature: PWA 설치 가능", () => {
  describe("Scenario: Chrome 설치 배너 최소 요건", () => {
    it("Given manifest, When 검사, Then name/short_name/start_url/display/icons(192,512) 모두 존재", () => {
      // Given: 파일 로드
      const m = manifest;
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
      const m = manifest;
      expect(m.scope).toBe("/");
    });

    it("Given manifest, When 검사, Then lang 이 ko 이다", () => {
      const m = manifest;
      expect(m.lang).toBe("ko");
    });

    it("givenManifest_whenIconsReferenced_thenFilesExistOnDisk", () => {
      const m = manifest;
      for (const icon of m.icons) {
        const p = join(__dirname, "../../public", icon.src);
        expect(existsSync(p)).toBe(true);
      }
    });

    it("givenReferencedIcons_whenReadingBytes_thenValidPngWithDeclaredSize", () => {
      for (const icon of (manifest).icons) {
        const buf = readFileSync(join(__dirname, "../../public", icon.src));
        expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        const [w, h] = icon.sizes.split("x").map(Number);
        expect(width).toBe(w);
        expect(height).toBe(h);
      }
    });

    it("givenLayoutIconLinks_whenResolving_thenFilesExist", () => {
      const layout = readFileSync(join(__dirname, "../../app/layout.tsx"), "utf-8");
      const hrefs = [...layout.matchAll(/href="(\/icons\/[^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(existsSync(join(__dirname, "../../public", href))).toBe(true);
      }
    });
  });
});
