"use client";

import { Suspense, useReducer, useEffect, useCallback } from "react";
import CredentialForm from "./credential-form";
import MfaForm from "./mfa-form";
import NoticeBanner from "./notice-banner";
import { AUTH_ERROR_MESSAGES, NETWORK_ERROR_MESSAGE } from "./error-messages";
import type { AuthErrorCode } from "@/lib/riot/errors";

/**
 * FSM 상태 정의
 *
 * 5상태: credential → credentialSubmitting → mfa → mfaSubmitting → success
 */
type LoginStatus =
  | "credential"
  | "credentialSubmitting"
  | "mfa"
  | "mfaSubmitting"
  | "success";

interface LoginState {
  status: LoginStatus;
  error: string | null;
  emailHint: string | null;
  // mfa_invalid 발생 시 key를 갱신하여 MfaForm 언마운트/리마운트 (코드 리셋)
  mfaFormKey: number;
}

type LoginEvent =
  | { type: "SUBMIT_CREDENTIAL" }
  | { type: "CREDENTIAL_OK" }
  | { type: "CREDENTIAL_MFA"; emailHint: string }
  | { type: "CREDENTIAL_ERROR"; code: AuthErrorCode }
  | { type: "SUBMIT_MFA" }
  | { type: "MFA_OK" }
  | { type: "MFA_ERROR"; code: AuthErrorCode }
  | { type: "MFA_EXPIRED" }
  | { type: "BACK_TO_CREDENTIAL" }
  | { type: "NETWORK_ERROR" };

/**
 * 초기 상태
 */
const initialLoginState: LoginState = {
  status: "credential",
  error: null,
  emailHint: null,
  mfaFormKey: 0,
};

/**
 * FSM Reducer
 *
 * spec § 4-3 전이표의 1:1 구현
 */
function loginReducer(state: LoginState, event: LoginEvent): LoginState {
  switch (state.status) {
    case "credential":
      if (event.type === "SUBMIT_CREDENTIAL") {
        return { ...state, status: "credentialSubmitting", error: null };
      }
      return state;

    case "credentialSubmitting":
      if (event.type === "CREDENTIAL_OK") {
        return { status: "success", error: null, emailHint: null, mfaFormKey: state.mfaFormKey };
      }
      if (event.type === "CREDENTIAL_MFA") {
        return {
          status: "mfa",
          error: null,
          emailHint: event.emailHint,
          mfaFormKey: state.mfaFormKey,
        };
      }
      if (event.type === "CREDENTIAL_ERROR") {
        return {
          ...state,
          status: "credential",
          error: AUTH_ERROR_MESSAGES[event.code],
        };
      }
      if (event.type === "NETWORK_ERROR") {
        return {
          ...state,
          status: "credential",
          error: NETWORK_ERROR_MESSAGE,
        };
      }
      return state;

    case "mfa":
      if (event.type === "SUBMIT_MFA") {
        return { ...state, status: "mfaSubmitting", error: null };
      }
      if (event.type === "BACK_TO_CREDENTIAL") {
        return {
          status: "credential",
          error: null,
          emailHint: null,
          mfaFormKey: state.mfaFormKey,
        };
      }
      return state;

    case "mfaSubmitting":
      if (event.type === "MFA_OK") {
        return { status: "success", error: null, emailHint: null, mfaFormKey: state.mfaFormKey };
      }
      if (event.type === "MFA_ERROR") {
        // mfa_invalid인 경우 mfaFormKey를 갱신하여 코드 리셋
        const shouldResetCode = event.code === "mfa_invalid";
        return {
          ...state,
          status: "mfa",
          error: AUTH_ERROR_MESSAGES[event.code],
          mfaFormKey: shouldResetCode ? state.mfaFormKey + 1 : state.mfaFormKey,
        };
      }
      if (event.type === "MFA_EXPIRED") {
        return {
          status: "credential",
          error: AUTH_ERROR_MESSAGES.mfa_expired,
          emailHint: null,
          mfaFormKey: state.mfaFormKey,
        };
      }
      if (event.type === "NETWORK_ERROR") {
        return {
          ...state,
          status: "mfa",
          error: NETWORK_ERROR_MESSAGE,
          mfaFormKey: state.mfaFormKey,
        };
      }
      return state;

    case "success":
      return state; // terminal state

    default:
      return state;
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const [state, dispatch] = useReducer(loginReducer, initialLoginState);

  // bfcache 복귀 시 disabled 잔존 방지 (기존 패턴 유지)
  useEffect(() => {
    const onShow = () => {
      // submitting 상태에서 원래 상태로 복귀
      if (state.status === "credentialSubmitting") {
        dispatch({ type: "NETWORK_ERROR" }); // credential으로 복귀
      }
      if (state.status === "mfaSubmitting") {
        dispatch({ type: "NETWORK_ERROR" }); // mfa로 복귀
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => { window.removeEventListener("pageshow", onShow); };
  }, [state.status]);

  const handleCredentialSubmit = async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    dispatch({ type: "SUBMIT_CREDENTIAL" });

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.ok) {
        dispatch({ type: "CREDENTIAL_OK" });
        // success 전이 시 window.location="/" 트리거는 reducer 외부에서 처리
        return;
      }

      if (data.status === "mfa_required") {
        dispatch({ type: "CREDENTIAL_MFA", emailHint: data.email_hint });
        return;
      }

      if (data.code) {
        dispatch({ type: "CREDENTIAL_ERROR", code: data.code });
        return;
      }

      // 예상 외 응답
      dispatch({ type: "CREDENTIAL_ERROR", code: "unknown" });
    } catch {
      dispatch({ type: "NETWORK_ERROR" });
    }
  };

  // 성공 시 라우팅 (useEffect로 분리하여 reducer 순수성 유지)
  useEffect(() => {
    if (state.status === "success") {
      window.location.assign("/");
    }
  }, [state.status]);

  // MFA 제출 핸들러 (Phase 3에서 확장)
  const handleMfaSubmit = useCallback(async (code: string) => {
    dispatch({ type: "SUBMIT_MFA" });

    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (data.ok) {
        dispatch({ type: "MFA_OK" });
        return;
      }

      if (data.code === "mfa_expired") {
        dispatch({ type: "MFA_EXPIRED" });
        return;
      }

      if (data.code) {
        dispatch({ type: "MFA_ERROR", code: data.code });
        return;
      }

      // 예상 외 응답
      dispatch({ type: "MFA_ERROR", code: "unknown" });
    } catch {
      dispatch({ type: "NETWORK_ERROR" });
    }
  }, []);

  // 뒤로가기 핸들러
  const handleBack = useCallback(() => {
    dispatch({ type: "BACK_TO_CREDENTIAL" });
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <NoticeBanner />
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold">VAL-Shop</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              라이엇 게임즈 계정으로 로그인하세요
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            {state.status === "credential" ||
            state.status === "credentialSubmitting" ? (
              <CredentialForm
                loading={state.status === "credentialSubmitting"}
                error={state.error}
                onSubmit={handleCredentialSubmit}
              />
            ) : null}

            {/* MFA 단계 */}
            {state.status === "mfa" || state.status === "mfaSubmitting" ? (
              <MfaForm
                key={state.mfaFormKey}
                emailHint={state.emailHint ?? ""}
                loading={state.status === "mfaSubmitting"}
                error={state.error}
                onSubmit={handleMfaSubmit}
                onBack={handleBack}
              />
            ) : null}

            {/* success 상태는 네비게이션 중이므로 아무것도 렌더하지 않음 */}
          </div>
        </div>
      </main>
    </div>
  );
}

// 타입 export (테스트에서 사용)
export type { LoginState, LoginEvent };
