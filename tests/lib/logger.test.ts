/**
 * Logger Tests (Phase 1)
 * Tests: 1-1 ~ 1-10 from plan 0024
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger, _resetLogLevelCache } from "@/lib/logger";

describe("lib/logger", () => {
  let stdoutCapture: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(() => {
    stdoutCapture = [];
    originalLog = console.log;
    _resetLogLevelCache(); // Reset log level cache between tests
     
    console.log = (...args: unknown[]) => {
      stdoutCapture.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    // Reset LOG_LEVEL
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    _resetLogLevelCache();
  });

  function parseLastLog(): Record<string, unknown> | null {
    const last = stdoutCapture[stdoutCapture.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  describe("Test 1-1: password redaction", () => {
    it("should redact password field", () => {
      logger.info("login attempt", { password: "hunter2", user: "alice" });
      const log = parseLastLog();
      expect(log?.password).toBe("[REDACTED]");
      expect(log?.user).toBe("alice");
    });
  });

  describe("Test 1-2: access_token redaction", () => {
    it("should redact access_token field", () => {
      logger.info("token fetched", { access_token: "eyJhbGc..." });
      const log = parseLastLog();
      expect(log?.access_token).toBe("[REDACTED]");
    });
  });

  describe("Test 1-3: ssid recursive redaction", () => {
    it("should redact ssid in nested cookies object", () => {
      logger.info("riot session", { cookies: { ssid: "abc.def.ghi" } });
      const log = parseLastLog();
      expect(log?.cookies?.ssid).toBe("[REDACTED]");
    });
  });

  describe("Test 1-4: entitlements redaction", () => {
    it("should redact entitlements field", () => {
      logger.info("entitlements", { entitlements: "eyJhbGc..." });
      const log = parseLastLog();
      expect(log?.entitlements).toBe("[REDACTED]");
    });
  });

  describe("Test 1-5: authorization case-insensitive redaction", () => {
    it("should redact Authorization header (case-insensitive)", () => {
      logger.info("req", { headers: { Authorization: "Bearer xxx" } });
      const log = parseLastLog();
      expect(log?.headers?.Authorization).toBe("[REDACTED]");
    });

    it("should redact authorization (lowercase) header", () => {
      logger.info("req", { headers: { authorization: "Bearer yyy" } });
      const log = parseLastLog();
      expect(log?.headers?.authorization).toBe("[REDACTED]");
    });

    it("should redact AUTHORIZATION (uppercase) header", () => {
      logger.info("req", { headers: { AUTHORIZATION: "Bearer zzz" } });
      const log = parseLastLog();
      expect(log?.headers?.AUTHORIZATION).toBe("[REDACTED]");
    });
  });

  describe("Test 1-6: email redaction (PIPA)", () => {
    it("should redact email field", () => {
      logger.info("login", { email: "jeonsy423@gmail.com" });
      const log = parseLastLog();
      expect(log?.email).toBe("[REDACTED]");
    });
  });

  describe("Test 1-7: array nested password redaction", () => {
    it("should redact passwords in array elements", () => {
      logger.info("batch", {
        attempts: [{ password: "p1" }, { password: "p2" }],
      });
      const log = parseLastLog();
      expect(log?.attempts?.[0]?.password).toBe("[REDACTED]");
      expect(log?.attempts?.[1]?.password).toBe("[REDACTED]");
    });
  });

  describe("Test 1-8: circular reference handling", () => {
    it("should not throw on circular reference and mark it", () => {
      const a: Record<string, unknown> = {};
      a.self = a;

      expect(() => { logger.info("circ", a); }).not.toThrow();

      const log = parseLastLog();
      expect(log?.self).toBe("[CIRCULAR]");
    });

    it("should handle deep circular references", () => {
      const a: Record<string, unknown> = { name: "a" };
      const b: Record<string, unknown> = { name: "b", parent: a };
      a.child = b;

      expect(() => { logger.info("deep circ", a); }).not.toThrow();

      const log = parseLastLog();
      expect(log?.child?.parent).toBe("[CIRCULAR]");
    });
  });

  describe("Test 1-9: LOG_LEVEL filtering", () => {
    it("should filter info when LOG_LEVEL=warn", () => {
      process.env.LOG_LEVEL = "warn";
      logger.info("x");
      logger.warn("y");

      expect(stdoutCapture.length).toBe(1);
      expect(stdoutCapture[0]).toContain('"level":"warn"');
      expect(stdoutCapture[0]).toContain('"msg":"y"');
    });

    it("should filter warn when LOG_LEVEL=error", () => {
      process.env.LOG_LEVEL = "error";
      logger.info("x");
      logger.warn("y");
      logger.error("z");

      expect(stdoutCapture.length).toBe(1);
      expect(stdoutCapture[0]).toContain('"level":"error"');
      expect(stdoutCapture[0]).toContain('"msg":"z"');
    });

    it("should allow debug when LOG_LEVEL=debug", () => {
      process.env.LOG_LEVEL = "debug";
      logger.debug("d");
      logger.info("i");

      expect(stdoutCapture.length).toBe(2);
    });

    it("should default to info level when LOG_LEVEL not set (prod-like)", () => {
      delete process.env.LOG_LEVEL;
      // Simulate prod by setting NODE_ENV
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      logger.debug("should not appear");
      logger.info("should appear");

      expect(stdoutCapture.length).toBe(1);
      expect(stdoutCapture[0]).toContain('"msg":"should appear"');

      process.env.NODE_ENV = originalEnv;
    });

    it("should default to debug level when dev", () => {
      delete process.env.LOG_LEVEL;
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      logger.debug("should appear in dev");

      expect(stdoutCapture.length).toBe(1);
      expect(stdoutCapture[0]).toContain('"msg":"should appear in dev"');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("Test 1-10: puuid preservation", () => {
    it("should preserve puuid field", () => {
      const puuid = "11111111-2222-3333-4444-555555555555";
      logger.info("ok", { puuid });
      const log = parseLastLog();
      expect(log?.puuid).toBe(puuid);
    });
  });

  describe("Additional: sub field redaction", () => {
    it("should redact sub field (JWT subject)", () => {
      logger.info("jwt", { sub: "user123" });
      const log = parseLastLog();
      expect(log?.sub).toBe("[REDACTED]");
    });
  });

  describe("Log format validation", () => {
    it("should output JSON single line", () => {
      logger.info("test", { foo: "bar" });
      expect(stdoutCapture.length).toBe(1);
      expect(stdoutCapture[0]).not.toContain("\n");

      const log = parseLastLog();
      expect(log).toHaveProperty("level");
      expect(log).toHaveProperty("msg");
      expect(log).toHaveProperty("ts");
      expect(log?.foo).toBe("bar");
    });
  });

  describe("Error handling", () => {
    it("should handle JSON.stringify failure gracefully", () => {
      // Create a circular reference that JSON.stringify can't handle
      const obj: Record<string, unknown> = {};
      obj.circular = obj;

      expect(() => { logger.error("test", obj); }).not.toThrow();

      const log = parseLastLog();
      expect(log).toHaveProperty("level");
      expect(log).toHaveProperty("msg");
    });
  });
});
