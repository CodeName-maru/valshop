/**
 * Riot API 에러 타입 체계
 *
 * discriminated union 으로 타입 안전한 에러 처리를 제공합니다.
 * 모든 에러 코드는 switch 문에서 exhaustive 하게 처리될 수 있습니다.
 */

export type RiotError =
  | { code: "TOKEN_EXPIRED"; upstreamStatus: number }
  | {
      code: "RATE_LIMITED";
      retryAfterMs: number;
      upstreamStatus: number;
    }
  | { code: "SERVER_ERROR"; upstreamStatus: number }
  | { code: "AUTH_FAILED"; reason: AuthFailureReason; upstreamStatus: number }
  | { code: "CLIENT_VERSION_MISMATCH"; upstreamStatus: number }
  | { code: "UPSTREAM_UNAVAILABLE"; upstreamStatus: number };

export type AuthFailureReason =
  | "mfa_required"
  | "invalid_credentials"
  | "rate_limited"
  | "upstream_unavailable";

/**
 * HTTP 응답을 RiotError 로 분류합니다.
 * 2xx 응답은 null 을 반환합니다.
 */
export async function classifyRiotResponse(
  res: Response,
): Promise<RiotError | null> {
  const status = res.status;

  // 2xx 는 성공
  if (status >= 200 && status < 300) {
    return null;
  }

  // 401 토큰 만료
  if (status === 401) {
    return {
      code: "TOKEN_EXPIRED",
      upstreamStatus: status,
    };
  }

  // 429 Rate Limit
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    return {
      code: "RATE_LIMITED",
      retryAfterMs,
      upstreamStatus: status,
    };
  }

  // 5xx 서버 에러
  if (status >= 500 && status < 600) {
    return {
      code: "SERVER_ERROR",
      upstreamStatus: status,
    };
  }

  // 400 클라이언트 버전 불일치 체크
  if (status === 400) {
    try {
      const body = await res.json();
      if (body.errorCode === "INVALID_CLIENT_VERSION") {
        return {
          code: "CLIENT_VERSION_MISMATCH",
          upstreamStatus: status,
        };
      }
    } catch {
      // JSON 파싱 실패 시 일반 4xx 처리
    }
  }

  // 그 외 4xx 는 인증 실패로 처리 (일반적인 경우)
  if (status >= 400 && status < 500) {
    return {
      code: "SERVER_ERROR",
      upstreamStatus: status,
    };
  }

  // 알 수 없는 에러
  return {
    code: "SERVER_ERROR",
    upstreamStatus: status,
  };
}

/**
 * Auth 응답 본문에서 인증 실패 사유를 분류합니다.
 */
export function classifyAuthResponse(
  body: unknown,
): RiotError | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const b = body as Record<string, unknown>;

  // 2FA 첼린지
  if (b.type === "multifactor") {
    return {
      code: "AUTH_FAILED",
      reason: "mfa_required",
      upstreamStatus: 401, // Auth 실패는 일반적으로 401
    };
  }

  // 인증 실패
  if (b.error === "auth_failure") {
    return {
      code: "AUTH_FAILED",
      reason: "invalid_credentials",
      upstreamStatus: 401,
    };
  }

  return null;
}

/**
 * Retry-After 헤더를 파싱하여 밀리초 단위로 반환합니다.
 * - 초 단위 숫자: 해당 초를 ms 로 변환
 * - HTTP-date: 파싱하여 차이를 ms 로 변환 (구현 생략, 기본값 사용)
 * - null 또는 파싱 실패: 기본값 300ms
 * - 상한: 3초 (3000ms)
 */
export function parseRetryAfter(header: string | null): number {
  const DEFAULT_MS = 300;
  const MAX_MS = 3000;

  if (!header) {
    return DEFAULT_MS;
  }

  const seconds = Number.parseInt(header, 10);
  if (Number.isNaN(seconds)) {
    // HTTP-date 형식은 현재 구현하지 않음
    return DEFAULT_MS;
  }

  const ms = seconds * 1000;
  return Math.min(Math.max(ms, 0), MAX_MS);
}

/**
 * 사용자에게 보여줄 안전한 메시지를 반환합니다.
 * 토큰, 쿠키, 헤더 등 민정 정보는 절대 포함하지 않습니다.
 */
export function toUserMessage(err: RiotError): string {
  switch (err.code) {
    case "TOKEN_EXPIRED":
      return "로그인 세션이 만료되었습니다. 다시 로그인해주세요.";
    case "RATE_LIMITED":
      return "너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.";
    case "SERVER_ERROR":
    case "UPSTREAM_UNAVAILABLE":
      return "서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
    case "AUTH_FAILED":
      if (err.reason === "mfa_required") {
        return "2단계 인증이 필요합니다.";
      }
      if (err.reason === "invalid_credentials") {
        return "로그인 정보가 올바르지 않습니다.";
      }
      return "로그인 중 오류가 발생했습니다. 다시 시도해주세요.";
    case "CLIENT_VERSION_MISMATCH":
      return "클라이언트 버전이 업데이트되었습니다. 페이지를 새로고침해주세요.";
  }
}

/**
 * 로그 출력용 안전한 페이로드를 반환합니다.
 * 민감 정보는 redact 됩니다.
 */
export function toLogPayload(err: RiotError): Record<string, unknown> {
  const base = {
    code: err.code,
    upstreamStatus: err.upstreamStatus,
    ts: new Date().toISOString(),
  };

  // 서브 타입별 추가 필드
  if (err.code === "RATE_LIMITED") {
    (base as Record<string, unknown>).retryAfterMs = err.retryAfterMs;
  }
  if (err.code === "AUTH_FAILED") {
    (base as Record<string, unknown>).reason = err.reason;
  }

  // context 가 있는 경우 화이트리스트 기반 필터링
  const extended = err as unknown as { context?: Record<string, unknown> };
  if (extended.context) {
    const safeContext: Record<string, unknown> = {};
    const ALLOWED_KEYS = ["path", "method", "safeField"];

    for (const key of ALLOWED_KEYS) {
      if (key in extended.context) {
        safeContext[key] = extended.context[key];
      }
    }

    // 헤더 redaction
    if (extended.context.headers) {
      safeContext.headers = redactHeaders(
        extended.context.headers as Record<string, string>,
      );
    }

    // puuid masking
    if (extended.context.puuid) {
      safeContext.puuid = maskPuuid(String(extended.context.puuid));
    }

    return { ...base, ...safeContext };
  }

  return base;
}

/**
 * 헤더에서 민감 정보를 redact 합니다.
 */
export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const SENSITIVE_KEYS = ["authorization", "cookie", "set-cookie", "x-auth-token"];
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sk) => lowerKey === sk)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * PUUID 를 masking 합니다. 뒷 4자리만 노출합니다.
 */
export function maskPuuid(puuid: string): string {
  if (!puuid) {
    return "";
  }
  if (puuid.length <= 4) {
    return `***${puuid}`;
  }
  return `***${puuid.slice(-4)}`;
}

/**
 * AuthErrorCode - Riot 인증 에러 코드 (spec § 5 단일 소스)
 *
 * 7종 에러 코드:
 * - invalid_credentials: 잘못된 자격증명
 * - mfa_required: MFA 필요
 * - mfa_invalid: 잘못된 MFA 코드
 * - mfa_expired: MFA 만료 (pending-jar 소관, plan 0020)
 * - rate_limited: Rate limit 초과
 * - riot_unavailable: Riot 서버 장애
 * - session_expired: 세션 만료 (ssid 재인증 실패)
 * - unknown: 알 수 없는 에러
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "mfa_required"
  | "mfa_invalid"
  | "mfa_expired"
  | "rate_limited"
  | "riot_unavailable"
  | "session_expired"
  | "unknown";

/**
 * NormalizedRiotError - 정규화된 Riot 에러
 */
export interface NormalizedRiotError {
  code: AuthErrorCode;
  logPayload: Record<string, unknown>;
}

/**
 * normalizeRiotError - Riot 응답을 AuthErrorCode 로 정규화
 *
 * spec § 5 에 따른 table-driven 매핑.
 * 민ensitive 필드는 로그 페이로드에서 redact 됩니다.
 *
 * @param raw - Riot 응답 데이터
 * @returns 정규화된 에러 코드와 로그 페이로드
 */
export function normalizeRiotError(raw: {
  body?: unknown;
  status: number;
  phase?: "credential" | "mfa" | "reauth";
  response?: Response;
}): NormalizedRiotError {
  const { body, status, phase, response } = raw;
  const logPayload: Record<string, unknown> = {
    upstreamStatus: status,
    phase: phase || "unknown",
  };

  // 1. Response 헤더 redaction (먼저 처리하여 logPayload에 포함)
  if (response) {
    const headers: Record<string, unknown> = {};
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (REDACT_KEYS.some((rk) => lowerKey === rk || lowerKey === "set-cookie")) {
        headers[key] = "[REDACTED]";
      } else {
        headers[key] = value;
      }
    }
    logPayload.headers = headers;
  }

  // 2. Status 기본 분류
  if (status === 0) {
    // timeout/AbortError
    return {
      code: "unknown",
      logPayload: redactLogPayload({ ...logPayload, reason: "timeout_or_abort" }),
    };
  }

  // 3. Cloudflare 1020 체크 (body가 문자열이고 cloudflare 포함)
  if (
    typeof body === "string" &&
    body.toLowerCase().includes("cloudflare") &&
    (status === 403 || status === 503)
  ) {
    return {
      code: "rate_limited",
      logPayload: redactLogPayload({ ...logPayload, detected: "cloudflare_1020" }),
    };
  }

  // 4. HTTP 상태 코드 기반 분류
  if (status === 429) {
    return {
      code: "rate_limited",
      logPayload: redactLogPayload(logPayload),
    };
  }

  if (status >= 500 && status < 600) {
    return {
      code: "riot_unavailable",
      logPayload: redactLogPayload(logPayload),
    };
  }

  // 5. 401 + auth_failure 조합은 session_expired (reauth 맥락)
  if (status === 401) {
    if (typeof body === "object" && body !== null) {
      const b = body as Record<string, unknown>;
      if (b.error === "auth_failure") {
        return {
          code: "session_expired",
          logPayload: redactLogPayload(logPayload),
        };
      }
    }
    // 일반 401
    return {
      code: "session_expired",
      logPayload: redactLogPayload(logPayload),
    };
  }

  // 6. Body 기반 분류 (Riot 응답 스키마)
  if (typeof body === "object" && body !== null) {
    const b = body as Record<string, unknown>;

    // MFA 필요
    if (b.type === "multifactor") {
      const multifactor = b.multifactor as Record<string, unknown> | undefined;
      return {
        code: "mfa_required",
        logPayload: redactLogPayload({ ...logPayload, multifactorEmail: multifactor?.email }),
      };
    }

    // MFA 시도 실패
    if (
      b.type === "multifactor_attempt_failed" ||
      b.error === "multifactor_attempt_failed"
    ) {
      return {
        code: "mfa_invalid",
        logPayload: redactLogPayload(logPayload),
      };
    }

    // 인증 실패 - phase에 따라 분기
    if (b.error === "auth_failure") {
      if (phase === "reauth") {
        return {
          code: "session_expired",
          logPayload: redactLogPayload(logPayload),
        };
      }
      return {
        code: "invalid_credentials",
        logPayload: redactLogPayload(logPayload),
      };
    }

    // Rate limit (body에 포함된 경우)
    if (b.error === "rate_limited") {
      return {
        code: "rate_limited",
        logPayload: redactLogPayload(logPayload),
      };
    }

    // Body를 logPayload에 추가 (redact 포함)
    logPayload.body = redactDeep(body);
  } else if (typeof body === "string") {
    logPayload.body = body;
  }

  // 7. 분류 실패 시 unknown
  return {
    code: "unknown",
    logPayload: redactLogPayload(logPayload),
  };
}

/**
 * Redact keys - 민정 정보 키 목록
 */
const REDACT_KEYS = [
  "access_token",
  "id_token",
  "ssid",
  "password",
  "authentication_code",
  "refresh_token",
  "entitlements_token",
  "set-cookie",
  "cookie",
  "authorization",
];

/**
 * redactDeep - 객체를 재귀적으로 redact
 */
function redactDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    // 문자열 값 자체는 redact하지 않음 (키-based redact만)
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }

  if (typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (REDACT_KEYS.some((rk) => lowerKey === rk)) {
        obj[key] = "[REDACTED]";
      } else {
        obj[key] = redactDeep(val);
      }
    }
    return obj;
  }

  return value;
}

/**
 * redactLogPayload - 로그 페이로드를 redact
 */
function redactLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactDeep(payload) as Record<string, unknown>;
}
