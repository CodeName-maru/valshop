/**
 * Structured Logger with Sensitive Field Redaction
 *
 * Phase 1 Implementation (plan 0024)
 * - JSON single-line output for Vercel drain parsing
 * - Automatic redaction of sensitive fields
 * - Circular reference detection
 * - LOG_LEVEL env control
 */

// Sensitive keys that will be redacted (case-insensitive matching)
const SENSITIVE_KEYS = [
  "password",
  "access_token",
  "ssid",
  "entitlements",
  "authorization",
  "email",
  "sub", // JWT subject (PIPA)
] as const;

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Check if a key should be redacted (case-insensitive)
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => sensitive.toLowerCase() === lowerKey);
}

/**
 * Recursively redact sensitive fields and detect circular references
 */
function redact(value: unknown, seen = new WeakSet()): unknown {
  // Handle primitives
  if (value === null || value === undefined) {
    return value;
  }

  // Handle primitives (string, number, boolean, bigint, symbol)
  if (typeof value !== "object") {
    return value;
  }

  // Handle Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle Array
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);
    return value.map((item) => redact(item, seen));
  }

  // Handle plain objects
  if (value.constructor === Object) {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redact(val, seen);
      }
    }
    return result;
  }

  // For other object types, try toString or return a marker
  try {
    return String(value);
  } catch {
    return "[UNSTRINGIFIABLE]";
  }
}

/**
 * Get the minimum log level from environment
 */
function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel !== undefined && envLevel in LEVEL_ORDER) {
    return envLevel;
  }

  // Default: info in production, debug in development
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

let cachedMinLevel: LogLevel | null = null;

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  if (cachedMinLevel === null) {
    cachedMinLevel = getMinLevel();
  }
  return LEVEL_ORDER[level] >= LEVEL_ORDER[cachedMinLevel];
}

/**
 * Write a log entry (internal only - uses console.log)
 * eslint-disable-next-line no-console is intentional here
 */
function write(level: LogLevel, msg: string, ctx: Record<string, unknown> = {}): void {
  if (!shouldLog(level)) {
    return;
  }

  const redactedCtx = redact(ctx) as Record<string, unknown>;

  try {
     
    console.log(
      JSON.stringify({
        level,
        msg,
        ts: new Date().toISOString(),
        ...redactedCtx,
      }),
    );
  } catch {
    // Fallback if JSON.stringify fails
     
    console.log(
      JSON.stringify({
        level,
        msg,
        ts: new Date().toISOString(),
        error: "LOG_SERIALIZE_FAIL",
      }),
    );
  }
}

/**
 * Logger interface with 4 levels
 */
export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => { write("debug", msg, ctx); },
  info: (msg: string, ctx?: Record<string, unknown>) => { write("info", msg, ctx); },
  warn: (msg: string, ctx?: Record<string, unknown>) => { write("warn", msg, ctx); },
  error: (msg: string, ctx?: Record<string, unknown>) => { write("error", msg, ctx); },
};

/**
 * Reset cached log level (for testing)
 */
export function _resetLogLevelCache(): void {
  cachedMinLevel = null;
}
