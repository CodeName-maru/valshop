/**
 * Tests 5-1, 5-2, 5-3: 검색 페이지 + 토글 낙관적 UI + 실패 rollback
 * Plan 0016 Phase 5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import SearchPage from "@/app/(app)/search/page";

const CATALOG = [
  { uuid: "s1", name: "Reaver Vandal", priceVp: 0, imageUrl: "https://example.com/s1.png", tierIconUrl: null },
  { uuid: "s2", name: "Phantom Prime", priceVp: 0, imageUrl: "https://example.com/s2.png", tierIconUrl: null },
  { uuid: "s3", name: "Phantom Oni", priceVp: 0, imageUrl: "https://example.com/s3.png", tierIconUrl: null },
];

let initialWishlist: string[] = [];
let postStatus = 200;
let deleteStatus = 204;

function mockFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url === "/api/catalog") {
      return new Response(JSON.stringify({ skins: CATALOG }), { status: 200 });
    }
    if (url === "/api/wishlist" && method === "GET") {
      return new Response(JSON.stringify({ skins: initialWishlist }), { status: 200 });
    }
    if (url === "/api/wishlist" && method === "POST") {
      return new Response(JSON.stringify(postStatus < 400 ? { ok: true } : { error: "x" }), {
        status: postStatus,
      });
    }
    if (url.startsWith("/api/wishlist/") && method === "DELETE") {
      return new Response(null, { status: deleteStatus });
    }
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  initialWishlist = [];
  postStatus = 200;
  deleteStatus = 204;
  mockFetch();
});

describe("Test 5-1: 검색 페이지", () => {
  it("givenCatalogLoaded_whenTypeQuery_thenFilteredCardsRender", async () => {
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "phantom" } });
    await waitFor(() => {
      const cards = screen.getAllByTestId("skin-card");
      expect(cards.length).toBe(2);
    });
  });

  it("givenEmptyQuery_whenMount_thenAllSkinsRender", async () => {
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
  });
});

describe("Test 5-2: 토글 낙관적 UI", () => {
  it("givenSkinNotInWishlist_whenClickHeart_thenImmediatelyFilledAndPOSTCalled", async () => {
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
    const btn = screen.getByTestId("wishlist-toggle-s1");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      { expect(global.fetch).toHaveBeenCalledWith(
        "/api/wishlist",
        expect.objectContaining({ method: "POST" })
      ); }
    );
  });

  it("givenSkinInWishlist_whenClickHeart_thenImmediatelyEmptiedAndDELETECalled", async () => {
    initialWishlist = ["s1"];
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
    const btn = screen.getByTestId("wishlist-toggle-s1");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() =>
      { expect(global.fetch).toHaveBeenCalledWith(
        "/api/wishlist/s1",
        expect.objectContaining({ method: "DELETE" })
      ); }
    );
  });
});

describe("Test 5-3: 실패 경로 (Availability)", () => {
  it("givenAPIReturns503_whenClickHeart_thenRollsBackAndShowsErrorToast", async () => {
    postStatus = 503;
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
    const btn = screen.getByTestId("wishlist-toggle-s1");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(btn.getAttribute("aria-pressed")).toBe("false");
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(/시도/);
  });

  it("givenAPIReturns422Limit_whenClickHeart_thenRollsBackAndShowsLimitToast", async () => {
    postStatus = 422;
    render(<SearchPage />);
    await waitFor(() => { expect(screen.getAllByTestId("skin-card").length).toBe(3); });
    const btn = screen.getByTestId("wishlist-toggle-s1");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => { expect(btn.getAttribute("aria-pressed")).toBe("false"); });
    expect(screen.getByTestId("toast")).toHaveTextContent(/최대치/);
  });
});
