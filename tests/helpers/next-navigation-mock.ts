/**
 * next/navigation mock helper for vitest (jsdom).
 *
 * Next.js App Router context (`useRouter`, `usePathname`, `useSearchParams`)
 * is unavailable under vitest, causing `invariant expected app router to be
 * mounted` when components that call those hooks are rendered.
 *
 * Tests can either:
 *   1. Import `installNextNavigationMock()` and call it at module top level,
 *   2. Or manually call `vi.mock("next/navigation", () => nextNavigationMockFactory())`.
 *
 * `redirect` and `notFound` throw synchronous errors that mirror Next.js
 * runtime semantics so SSR tests can assert on them.
 */
import { vi } from "vitest";

export const routerSpies = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export class NextRedirectError extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT;${url}`);
    this.digest = `NEXT_REDIRECT;${url}`;
    this.name = "NextRedirectError";
  }
}

export class NextNotFoundError extends Error {
  digest: string;
  constructor() {
    super("NEXT_NOT_FOUND");
    this.digest = "NEXT_NOT_FOUND";
    this.name = "NextNotFoundError";
  }
}

export function nextNavigationMockFactory() {
  return {
    useRouter: () => routerSpies,
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    redirect: (url: string) => {
      throw new NextRedirectError(url);
    },
    permanentRedirect: (url: string) => {
      throw new NextRedirectError(url);
    },
    notFound: () => {
      throw new NextNotFoundError();
    },
    RedirectType: { push: "push", replace: "replace" } as const,
  };
}

export function installNextNavigationMock(): void {
  vi.mock("next/navigation", () => nextNavigationMockFactory());
}
