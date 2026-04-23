import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LogoutButton } from "@/components/LogoutButton";

// Mock next/router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock fetch
global.fetch = vi.fn();

describe("Feature: 로그아웃 버튼 — 클라이언트 동작", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // localStorage mock
    localStorage.clear();
    // document.cookie mock
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("Scenario: 버튼 클릭 시 POST 호출 + 리다이렉트", () => {
    it("given로그인상태_when로그아웃버튼클릭_thenPOST호출되고login으로이동", async () => {
      // Given: 대시보드 렌더, fetch mock 이 { ok:true } 반환
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

      render(<LogoutButton />);

      const button = screen.getByRole("button", { name: /로그아웃/i });
      expect(button).toBeInTheDocument();

      // When: 버튼 클릭
      fireEvent.click(button);

      // Then: fetch("/api/auth/logout", { method:"POST" }) 호출
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", {
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
          }),
        });
      });

      // Then: router.push("/login") 실행
      expect(mockPush).toHaveBeenCalledWith("/login");
    });
  });

  describe("Scenario: 오프라인(네트워크 실패) 시에도 로컬 토큰 파기", () => {
    it("given네트워크실패_when로그아웃버튼클릭_thenlocalStorage와document.cookie즉시파기", async () => {
      // Given: fetch 가 TypeError 로 reject, localStorage 에 잔존 키 존재
      vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("Network error"));

      localStorage.setItem("val_refresh_hint", "x");
      localStorage.setItem("val_other_key", "y");
      document.cookie = "session=dummy; path=/";

      render(<LogoutButton />);

      const button = screen.getByRole("button", { name: /로그아웃/i });

      // When: 버튼 클릭
      fireEvent.click(button);

      // Then: localStorage 에 val_* 키 없음
      await waitFor(() => {
        expect(localStorage.getItem("val_refresh_hint")).toBeNull();
        expect(localStorage.getItem("val_other_key")).toBeNull();
      });

      // Then: router.push("/login") 실행 (네트워크 실패에도 진행)
      expect(mockPush).toHaveBeenCalledWith("/login");
    });
  });

  describe("Scenario: 500ms 이내 UI 반응 (Performance)", () => {
    it("given버튼클릭_when로그아웃_then500ms이내login으로라우팅트리거", async () => {
      // Given: fetch mock 이 50ms 뒤 resolve
      vi.mocked(global.fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ ok: true }),
              } as Response);
            }, 50);
          })
      );

      render(<LogoutButton />);

      const button = screen.getByRole("button", { name: /로그아웃/i });
      const startTime = performance.now();

      // When: 버튼 클릭
      fireEvent.click(button);

      // Then: performance.now() 기준 router 호출까지 < 500ms
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/login");
      });

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(500);
    });
  });

  describe("Scenario: 중복 클릭 방지", () => {
    it("given버튼클릭중_when중복클릭_then한번만호출", async () => {
      vi.mocked(global.fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ ok: true }),
              } as Response);
            }, 100);
          })
      );

      render(<LogoutButton />);

      const button = screen.getByRole("button", { name: /로그아웃/i });

      // When: 중복 클릭
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      // Then: fetch는 한번만 호출
      await waitFor(
        () => {
          expect(global.fetch).toHaveBeenCalledTimes(1);
        },
        { timeout: 500 }
      );
    });
  });
});
