/**
 * Test 5-4: 위시리스트 페이지
 * Plan 0016 Phase 5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import WishlistPage from "@/app/(app)/wishlist/page";

const CATALOG = [
  { uuid: "s1", name: "Reaver Vandal", priceVp: 0, imageUrl: "https://example.com/s1.png", tierIconUrl: null },
  { uuid: "s2", name: "Phantom Prime", priceVp: 0, imageUrl: "https://example.com/s2.png", tierIconUrl: null },
  { uuid: "s3", name: "Phantom Oni", priceVp: 0, imageUrl: "https://example.com/s3.png", tierIconUrl: null },
];

let wishlistIds: string[] = [];
let wishlistStatus = 200;
let deleteStatus = 204;
const assignSpy = vi.fn();

function mockFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url === "/api/wishlist" && method === "GET") {
      return new Response(
        JSON.stringify({ skins: wishlistIds }),
        { status: wishlistStatus }
      );
    }
    if (url === "/api/catalog") {
      return new Response(JSON.stringify({ skins: CATALOG }), { status: 200 });
    }
    if (url.startsWith("/api/wishlist/") && method === "DELETE") {
      return new Response(null, { status: deleteStatus });
    }
    return new Response("not found", { status: 404 });
  }) as any;
}

beforeEach(() => {
  wishlistIds = [];
  wishlistStatus = 200;
  deleteStatus = 204;
  assignSpy.mockReset();
  // location 자체를 origin 보존하며 assign 만 spy 한 객체로 교체
  const origin = window.location.origin;
  const href = window.location.href;
  // @ts-expect-error — jsdom location 재정의
  delete window.location;
  // @ts-expect-error
  window.location = { origin, href, assign: assignSpy };
  mockFetch();
});

describe("Test 5-4: 위시리스트 페이지", () => {
  it("givenThreeItemsInWishlist_whenMount_thenThreeCardsRender", async () => {
    wishlistIds = ["s1", "s2", "s3"];
    render(<WishlistPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId("skin-card").length).toBe(3)
    );
  });

  it("givenItemCard_whenClickRemove_thenCardDisappearsAndDELETECalled", async () => {
    wishlistIds = ["s1", "s2"];
    render(<WishlistPage />);
    await waitFor(() => expect(screen.getAllByTestId("skin-card").length).toBe(2));
    await act(async () => {
      fireEvent.click(screen.getByTestId("wishlist-remove-s1"));
    });
    await waitFor(() => expect(screen.getAllByTestId("skin-card").length).toBe(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/wishlist/s1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("givenEmptyWishlist_whenMount_thenEmptyStateWithSearchLinkShown", async () => {
    wishlistIds = [];
    render(<WishlistPage />);
    await waitFor(() => expect(screen.getByTestId("wishlist-empty")).toBeInTheDocument());
    expect(screen.getByText(/검색에서 스킨을 찜해보세요/)).toBeInTheDocument();
  });

  it("givenAPIReturns401_whenMount_thenRedirectsToLogin", async () => {
    wishlistStatus = 401;
    render(<WishlistPage />);
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/login"));
  });
});
