/**
 * Bytea Serialization Helpers
 *
 * Plan 0014: PostgREST 가 bytea 컬럼을 `\x` 접두사 hex string 으로 직렬화한다.
 * pg(node-postgres) 는 Buffer 로, JSON round-trip 은 `{type:"Buffer",data}` 로 들어올 수 있다.
 * 이 모듈은 4가지 입력을 모두 수용하여 `Uint8Array` 로 정규화하고, 반대 방향으로
 * `Uint8Array` → `\x<hex>` literal 로 직렬화한다 (PostgREST write 표준).
 *
 * Security: 잘못된 입력에 대한 에러 메시지에는 토큰 평문/ciphertext 본문이 새지 않도록
 * prefix 8자만 노출한다.
 */

const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const PREFIX_LEN = 8;

export class BytEaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BytEaParseError";
  }
}

interface JsonBufferShape {
  type: "Buffer";
  data: number[];
}

function isJsonBufferShape(v: unknown): v is JsonBufferShape {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.type === "Buffer" && Array.isArray(o.data);
}

function sanitize(input: unknown, label?: string): string {
  let preview: string;
  if (typeof input === "string") {
    preview = input.slice(0, PREFIX_LEN);
  } else if (input === null) {
    preview = "null";
  } else if (typeof input === "undefined") {
    preview = "undefined";
  } else {
    preview = `<${typeof input}>`;
  }
  const labelPart = label ? `[${label}] ` : "";
  return `${labelPart}prefix="${preview}..."`;
}

/**
 * Parse a value coming back from PostgREST/pg/JSON-roundtrip into raw bytes.
 *
 * Accepts:
 *  - `Uint8Array` / `Buffer` (passthrough)
 *  - `"\x<hex>"` PostgREST string
 *  - base64 string
 *  - `{type:"Buffer",data:[...]}` JSON shape
 *
 * Throws `BytEaParseError` for anything else, with a sanitized message.
 */
export function parseBytea(input: unknown, columnLabel?: string): Uint8Array {
  // Buffer / Uint8Array passthrough.
  // NOTE: in jsdom test env, Node's Buffer uses Node's primordial Uint8Array
  // which is a *different* constructor from jsdom's `Uint8Array`. So a direct
  // `instanceof Uint8Array` check fails for Node Buffer. We accept any
  // ArrayBuffer-backed view with `.byteLength` / `.buffer`.
  if (input instanceof Uint8Array) {
    return input;
  }
  if (
    input &&
    typeof input === "object" &&
    typeof (input as { byteLength?: unknown }).byteLength === "number" &&
    (input as { buffer?: unknown }).buffer != null &&
    typeof (input as { buffer: { byteLength?: unknown } }).buffer.byteLength === "number"
  ) {
    const view = input as ArrayBufferView;
    // Copy bytes to a fresh Uint8Array using the current realm's constructor.
    // This handles Node Buffer in jsdom realm where constructor identity differs.
    const out = new Uint8Array(view.byteLength);
    const src = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    out.set(src);
    return out;
  }

  // JSON round-trip Buffer shape
  if (isJsonBufferShape(input)) {
    return Uint8Array.from(input.data);
  }

  if (typeof input === "string") {
    // PostgREST hex literal: "\x4855..."
    if (input.startsWith("\\x")) {
      const hex = input.slice(2);
      if (hex.length === 0) {
        return new Uint8Array(0);
      }
      if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
        throw new BytEaParseError(
          `invalid hex after \\x ${sanitize(input, columnLabel)}`
        );
      }
      return new Uint8Array(Buffer.from(hex, "hex"));
    }

    // Try base64
    if (!BASE64_RE.test(input)) {
      throw new BytEaParseError(
        `invalid bytea string ${sanitize(input, columnLabel)}`
      );
    }
    const buf = Buffer.from(input, "base64");
    // Round-trip check to catch silently-truncated base64
    if (buf.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, "")) {
      throw new BytEaParseError(
        `base64 decode mismatch ${sanitize(input, columnLabel)}`
      );
    }
    return new Uint8Array(buf);
  }

  throw new BytEaParseError(
    `unsupported bytea input ${sanitize(input, columnLabel)}`
  );
}

/**
 * Encode raw bytes as a PostgREST/pg `\x<hex>` literal for write paths.
 */
export function encodeBytea(bytes: Uint8Array): string {
  return "\\x" + Buffer.from(bytes).toString("hex");
}
