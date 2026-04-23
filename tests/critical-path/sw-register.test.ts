import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerServiceWorker } from "../../lib/pwa/register";

describe("Feature: Service Worker 등록", () => {
  describe("Scenario: SW 등록 견고성", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("Given navigator.serviceWorker undefined, When register, Then throw 없음", () => {
      // @ts-ignore
      Object.defineProperty(global, "navigator", {
        value: {},
        configurable: true,
      });
      expect(() => registerServiceWorker()).not.toThrow();
    });

    it("Given navigator.serviceWorker 지원, When register, Then sw.js 등록 호출", () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      // @ts-ignore
      Object.defineProperty(global, "navigator", {
        value: {
          serviceWorker: {
            register: mockRegister,
          },
        },
        configurable: true,
      });

      registerServiceWorker();
      expect(mockRegister).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    });
  });
});
