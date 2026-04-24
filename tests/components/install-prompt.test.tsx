import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { InstallPrompt } from "../../components/InstallPrompt";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * AC-5 회귀: beforeinstallprompt 이벤트가 수신될 때 설치 버튼이 렌더되어야 한다.
 * Plan 0012: Phase 3
 */
describe("Feature: PWA 설치 배너 회귀", () => {
  beforeEach(() => {
    localStorage.clear();
    // @ts-ignore
    global.BeforeInstallPromptEvent = class BeforeInstallPromptEvent extends Event {
      prompt = vi.fn().mockResolvedValue(undefined);
      userChoice = Promise.resolve({ outcome: "accepted" } as const);
    };
  });

  it("givenBeforeInstallPromptEvent_whenDispatched_thenInstallButtonVisible", async () => {
    render(<InstallPrompt />);
    const fakeEvent = new (global as any).BeforeInstallPromptEvent("beforeinstallprompt");
    act(() => {
      window.dispatchEvent(fakeEvent);
    });
    expect(await screen.findByRole("button", { name: /앱으로 설치/ })).toBeInTheDocument();
  });
});

describe("Feature: README Lighthouse 가이드", () => {
  it("givenReadme_whenSearching_thenLighthouseSectionPresent", () => {
    const readme = readFileSync(join(__dirname, "../../README.md"), "utf-8");
    expect(readme).toMatch(/## Lighthouse/i);
    expect(readme).toMatch(/lhci autorun/);
  });
});
