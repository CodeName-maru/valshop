import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

describe("Feature: PWA 아이콘 소스", () => {
  it("givenRepo_whenReadingSvgSources_thenBothFilesExist", () => {
    const base = join(ROOT, "assets/icons");
    expect(existsSync(join(base, "icon.svg"))).toBe(true);
    expect(existsSync(join(base, "icon-maskable.svg"))).toBe(true);
  });

  it("givenMaskableSvg_whenParsing_thenContentInsideSafeZone", () => {
    const svg = readFileSync(join(ROOT, "assets/icons/icon-maskable.svg"), "utf-8");
    expect(svg).toMatch(/viewBox=["']0 0 512 512["']/);
    expect(svg).toMatch(/data-safe-zone="80"/);
  });

  it("givenSvgSources_whenReading_thenFanMadeAttributePresent", () => {
    const icon = readFileSync(join(ROOT, "assets/icons/icon.svg"), "utf-8");
    const maskable = readFileSync(join(ROOT, "assets/icons/icon-maskable.svg"), "utf-8");
    expect(icon).toMatch(/data-fan-made="true"/);
    expect(maskable).toMatch(/data-fan-made="true"/);
  });
});

describe("Feature: 아이콘 생성 스크립트", () => {
  beforeAll(() => {
    // 이전 실행 결과가 없을 때만 생성 (빠른 로컬 반복을 위해)
    const pub = join(ROOT, "public");
    const allExist =
      existsSync(join(pub, "icons/icon-192.png")) &&
      existsSync(join(pub, "icons/icon-512.png")) &&
      existsSync(join(pub, "icons/icon-maskable-512.png")) &&
      existsSync(join(pub, "favicon.ico"));
    if (!allExist) {
      execSync("npm run icons", { cwd: ROOT, stdio: "inherit" });
    }
  }, 60_000);

  it("givenScriptRun_whenFinished_thenAllIconFilesGenerated", () => {
    const pub = join(ROOT, "public");
    expect(existsSync(join(pub, "icons/icon-192.png"))).toBe(true);
    expect(existsSync(join(pub, "icons/icon-512.png"))).toBe(true);
    expect(existsSync(join(pub, "icons/icon-maskable-512.png"))).toBe(true);
    expect(existsSync(join(pub, "favicon.ico"))).toBe(true);
  });

  it("givenScriptRun_whenFinished_thenFileSizeWithinBudget", () => {
    const pub = join(ROOT, "public");
    expect(statSync(join(pub, "icons/icon-192.png")).size).toBeLessThanOrEqual(4096);
    expect(statSync(join(pub, "icons/icon-512.png")).size).toBeLessThanOrEqual(12288);
    expect(statSync(join(pub, "icons/icon-maskable-512.png")).size).toBeLessThanOrEqual(12288);
  });
});
