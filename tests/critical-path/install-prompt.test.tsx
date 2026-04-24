import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallPrompt } from "../../components/InstallPrompt";

describe("Feature: PWA 설치 배너", () => {
  describe("Scenario: 설치 배너 노출/숨김", () => {
    beforeEach(() => {
      localStorage.clear();
      // @ts-ignore
      global.BeforeInstallPromptEvent = class BeforeInstallPromptEvent extends Event {
        prompt = vi.fn().mockResolvedValue(undefined);
        userChoice = Promise.resolve({ outcome: "accepted" } as const);
      };
    });

    it("Given beforeinstallprompt 이벤트, When 발생, Then 버튼 노출", async () => {
      render(<InstallPrompt />);

      const fakeEvent = new (global as any).BeforeInstallPromptEvent("beforeinstallprompt");
      act(() => {
        window.dispatchEvent(fakeEvent);
      });

      expect(await screen.findByRole("button", { name: /앱으로 설치/ })).toBeVisible();
    });

    it("Given 3회 dismiss, When 다시 이벤트 발생, Then 14일간 숨김", () => {
      localStorage.setItem(
        "pwa:dismissed",
        JSON.stringify({ count: 3, until: Date.now() + 1e9 })
      );
      render(<InstallPrompt />);
      window.dispatchEvent(new Event("beforeinstallprompt"));
      expect(screen.queryByRole("button", { name: /앱으로 설치/ })).toBeNull();
    });

    it("Given 만료된 dismiss 상태, When 이벤트 발생, Then 버튼 다시 노출", () => {
      localStorage.setItem(
        "pwa:dismissed",
        JSON.stringify({ count: 3, until: Date.now() - 1000 })
      );
      render(<InstallPrompt />);

      const fakeEvent = new (global as any).BeforeInstallPromptEvent("beforeinstallprompt");
      act(() => {
        window.dispatchEvent(fakeEvent);
      });

      expect(screen.queryByRole("button", { name: /앱으로 설치/ })).not.toBeNull();
    });
  });
});
