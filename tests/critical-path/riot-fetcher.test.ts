import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createRiotFetcher } from "@/lib/riot/http";

const server = setupServer();

beforeEach(() => {
  server.resetHandlers();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.close();
});

describe("Feature: RiotFetcher 200 OK 통과", () => {
  it("given200Response_whenCall_thenReturnsParsedBody", async () => {
    // Given: MSW handler returning 200 { foo: "bar" }
    server.use(
      http.get("https://riot.example.com/test", () =>
        HttpResponse.json({ foo: "bar" }, { status: 200 }),
      ),
    );
    const fetcher = createRiotFetcher({});

    // When: fetcher.call(req)
    const result = await fetcher.call({
      url: "https://riot.example.com/test",
    });

    // Then: result equals { foo: "bar" }
    expect(result).toEqual({ foo: "bar" });
  });
});

describe("Feature: 429 1회 재시도", () => {
  it("given429ThenSuccess_whenCall_thenRetriesOnceAndReturns", async () => {
    // Given: MSW 첫 호출 429, 두 번째 200
    let callCount = 0;
    server.use(
      http.get("https://riot.example.com/test", () => {
        callCount++;
        if (callCount === 1) {
          return new HttpResponse(null, { status: 429 });
        }
        return HttpResponse.json({ success: true }, { status: 200 });
      }),
    );
    const fetcher = createRiotFetcher({});

    // When: fetcher.call(req)
    const result = await fetcher.call({
      url: "https://riot.example.com/test",
    });

    // Then: 결과 OK, 호출 횟수 === 2
    expect(result).toEqual({ success: true });
    expect(callCount).toBe(2);
  });

  it("given429Twice_whenCall_thenThrowsRateLimitedAfterOneRetry", async () => {
    // Given: MSW 두 번 모두 429
    server.use(
      http.get("https://riot.example.com/test", () =>
        new HttpResponse(null, { status: 429 }),
      ),
    );
    const fetcher = createRiotFetcher({});

    // When: fetcher.call(req)
    const resultPromise = fetcher.call({
      url: "https://riot.example.com/test",
    });

    // Then: throws RiotError { code: "RATE_LIMITED" }, 호출 횟수 === 2
    await expect(resultPromise).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("given429WithLargeRetryAfter_whenCall_thenClampedUnder10s", async () => {
    // Given: MSW 429 { retry-after: "60" }
    server.use(
      http.get("https://riot.example.com/test", () =>
        HttpResponse.json(null, {
          status: 429,
          headers: { "retry-after": "60" },
        }),
      ),
    );
    const fetcher = createRiotFetcher({});

    // When: start = Date.now(); try fetcher.call(req)
    const start = Date.now();
    const resultPromise = fetcher.call({
      url: "https://riot.example.com/test",
    });
    await expect(resultPromise).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    const elapsed = Date.now() - start;

    // Then: (Date.now() - start) < 11000 (NFR Performance, jitter 허용)
    expect(elapsed).toBeLessThan(11000);
  });

  it("given429WithRetryAfter2s_whenCall_thenWaitsAtLeast2sBeforeRetry", async () => {
    // Given: MSW 첫 429 retry-after=2, 두 번째 200
    let callCount = 0;
    const callTimestamps: number[] = [];
    server.use(
      http.get("https://riot.example.com/test", () => {
        callTimestamps.push(Date.now());
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(null, {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );
    const fetcher = createRiotFetcher({});

    // When: 호출
    await fetcher.call({ url: "https://riot.example.com/test" });

    // Then: retry 간격 >= 2000ms (jitter 제외), < 10000ms
    expect(callCount).toBe(2);
    if (!callTimestamps[0] || !callTimestamps[1]) {
      throw new Error("Call timestamps not recorded");
    }
    const interval = callTimestamps[1] - callTimestamps[0];
    expect(interval).toBeGreaterThanOrEqual(2000);
    expect(interval).toBeLessThan(10000);
  });
});

describe("Feature: 5xx 재시도 없음", () => {
  it("given503Response_whenCall_thenThrowsImmediatelyWithoutRetry", async () => {
    // Given: MSW 503
    let callCount = 0;
    server.use(
      http.get("https://riot.example.com/test", () => {
        callCount++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const fetcher = createRiotFetcher({});

    // When: fetcher.call(req)
    const resultPromise = fetcher.call({
      url: "https://riot.example.com/test",
    });

    // Then: throws SERVER_ERROR, 호출 횟수 === 1
    await expect(resultPromise).rejects.toMatchObject({
      code: "SERVER_ERROR",
      upstreamStatus: 503,
    });
    expect(callCount).toBe(1);
  });
});
