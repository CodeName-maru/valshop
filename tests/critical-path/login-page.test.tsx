import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  loginReducer,
  initialLoginState,
  type LoginState,
  type LoginEvent,
} from "@/app/(app)/login/page";
import { AUTH_ERROR_MESSAGES, NETWORK_ERROR_MESSAGE } from "@/app/(app)/login/error-messages";

// useSearchParams mock - Plan 0022에서는 사용하지 않으나 빈 mock 유지
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: () => null,
  }),
}));

// MSW server import
import { mswServer } from "@/vitest.setup";

import LoginPage from "@/app/(app)/login/page";
import CredentialForm from "@/app/(app)/login/credential-form";
import MfaForm from "@/app/(app)/login/mfa-form";
import NoticeBanner from "@/app/(app)/login/notice-banner";

describe("Feature: Login 2-step FSM", () => {
  describe("Scenario: 초기 credential step", () => {
    it("givenFreshMount_whenRendered_thenCredentialFormVisible", () => {
      render(<LoginPage />);

      // username/password input 존재
      expect(
        screen.getByLabelText(/라이엇 아이디|아이디|username/i)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/비밀번호|password/i)).toBeInTheDocument();

      // mfa input 부재
      expect(screen.queryByLabelText(/인증 코드|mfa/i)).toBeNull();

      // notice-banner 존재
      expect(screen.getByTestId("notice-banner")).toBeInTheDocument();
    });

    it("givenLoginPage_whenRendered_thenNoticeBannerIsStickyTop", () => {
      const { container } = render(<LoginPage />);
      const banner = container.querySelector('[data-testid="notice-banner"]');

      expect(banner?.className).toMatch(/sticky/);
      expect(banner?.className).toMatch(/top-0/);
    });
  });

  describe("Scenario: credential → mfa 전이", () => {
    it("givenMfaRequired_whenResponseReceived_thenMfaFormWithEmailHint", async () => {
      const user = userEvent.setup();

      // MSW stub - mfa_required 응답
      mswServer.use(
        http.post("/api/auth/login", () =>
          HttpResponse.json({
            status: "mfa_required",
            email_hint: "j***@gmail.com",
          })
        )
      );

      render(<LoginPage />);

      await user.type(screen.getByLabelText(/라이엇 아이디|아이디/i), "u");
      await user.type(screen.getByLabelText(/비밀번호/i), "p");
      await user.click(screen.getByRole("button", { name: /로그인/ }));

      // mfa form 렌더 + email_hint 표시
      await expect(
        screen.findByLabelText(/인증 코드/i)
      ).resolves.toBeInTheDocument();
      expect(screen.getByText(/j\*\*\*@gmail.com/)).toBeInTheDocument();

      // password input 사라짐
      expect(screen.queryByLabelText(/비밀번호/i)).toBeNull();
    });
  });
});

describe("CredentialForm", () => {
  it("givenLoadingTrue_whenRendered_thenInputsAndButtonDisabled", () => {
    const onSubmit = vi.fn();
    render(<CredentialForm loading={true} error={null} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/라이엇 아이디|아이디|username/i)).toBeDisabled();
    expect(screen.getByLabelText(/비밀번호|password/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /인증 중/ })).toBeDisabled();
  });

  it("givenErrorProp_whenRendered_thenAlertBannerShown", () => {
    render(
      <CredentialForm
        loading={false}
        error="계정 정보가 올바르지 않습니다."
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/계정 정보가 올바르지 않/);
  });

  it("givenCredentialForm_whenRendered_thenPasswordInputHasSecurityAttributes", () => {
    render(
      <CredentialForm loading={false} error={null} onSubmit={vi.fn()} />
    );
    const pw = screen.getByLabelText(/비밀번호/i);

    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autoComplete", "current-password");
    expect(pw).toHaveAttribute("name", "password");
  });
});

describe("MfaForm", () => {
  it("givenMfaForm_withEmailHint_whenRendered_thenHintDisplayed", () => {
    render(
      <MfaForm
        emailHint="a***@b.com"
        loading={false}
        error={null}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText(/a\*\*\*@b.com/)).toBeInTheDocument();
  });

  it("givenMfaForm_whenRendered_thenCodeInputHasOtpAttributes", () => {
    render(
      <MfaForm
        emailHint="x"
        loading={false}
        error={null}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const input = screen.getByLabelText(/인증 코드/i);
    expect(input).toHaveAttribute("inputMode", "numeric");
    expect(input).toHaveAttribute("autoComplete", "one-time-code");
    expect(input).toHaveAttribute("maxLength", "6");
  });
});

describe("NoticeBanner", () => {
  it("givenNoticeBanner_whenRendered_thenContainsAllRequiredPhrases", () => {
    render(<NoticeBanner />);

    expect(
      screen.getByText(/공식.*아닙니다|공식 서비스가 아닙니다/)
    ).toBeInTheDocument();
    expect(screen.getByText(/본인 계정 시연/)).toBeInTheDocument();
    expect(screen.getByText(/2FA.*권장|2단계 인증.*권장/)).toBeInTheDocument();
  });
});

describe("AUTH_ERROR_MESSAGES", () => {
  it.each([
    ["invalid_credentials", /계정 정보/],
    ["mfa_required", /^$/],
    ["mfa_invalid", /인증 코드가 올바르지 않/],
    ["mfa_expired", /세션.*만료|처음부터/],
    ["rate_limited", /요청이 너무 많|잠시 후/],
    ["riot_unavailable", /라이엇.*서버|일시적/],
    ["session_expired", /세션.*만료|다시 로그인/],
    ["unknown", /알 수 없는|다시 시도/],
  ])(
    "givenAuthErrorCode_%s_whenLookedUp_thenKoreanMessageReturned",
    (code, pattern) => {
      expect(
        AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES]
      ).toMatch(pattern);
    }
  );
});

describe("Feature: Login FSM reducer", () => {
  it.each([
    [{ status: "credential" }, { type: "SUBMIT_CREDENTIAL" }, "credentialSubmitting"],
    [{ status: "credentialSubmitting" }, { type: "CREDENTIAL_OK" }, "success"],
    [{ status: "credentialSubmitting" }, { type: "CREDENTIAL_MFA", emailHint: "test@test.com" }, "mfa"],
    [
      { status: "credentialSubmitting" },
      { type: "CREDENTIAL_ERROR", code: "invalid_credentials" },
      "credential",
    ],
    [{ status: "credentialSubmitting" }, { type: "NETWORK_ERROR" }, "credential"],
    [{ status: "mfa", emailHint: "test@test.com" }, { type: "SUBMIT_MFA" }, "mfaSubmitting"],
    [{ status: "mfa", emailHint: "test@test.com" }, { type: "BACK_TO_CREDENTIAL" }, "credential"],
    [{ status: "mfaSubmitting" }, { type: "MFA_OK" }, "success"],
    [{ status: "mfaSubmitting" }, { type: "MFA_ERROR", code: "mfa_invalid" }, "mfa"],
    [{ status: "mfaSubmitting" }, { type: "MFA_EXPIRED" }, "credential"],
    [{ status: "mfaSubmitting" }, { type: "NETWORK_ERROR" }, "mfa"],
  ])(
    "givenState_%s_whenEvent_%s_thenNextStatus",
    (from, event, expectedStatus) => {
      const state = { ...initialLoginState, ...from } as LoginState;
      const next = loginReducer(state, event);
      expect(next.status).toBe(expectedStatus);
    }
  );

  it("givenMfaInvalidError_whenDispatched_thenMfaFormKeyIncrements", () => {
    const state: LoginState = {
      status: "mfa",
      error: null,
      emailHint: "test@test.com",
      mfaFormKey: 5,
    };
    const event = { type: "SUBMIT_MFA" } as const;
    const submittingState = loginReducer(state, event);
    expect(submittingState.status).toBe("mfaSubmitting");

    const errorEvent = { type: "MFA_ERROR", code: "mfa_invalid" as const };
    const errorState = loginReducer(submittingState, errorEvent);

    expect(errorState.status).toBe("mfa");
    expect(errorState.mfaFormKey).toBe(6); // key incremented
    expect(errorState.error).toBe(AUTH_ERROR_MESSAGES.mfa_invalid);
  });

  it("givenMfaExpired_whenDispatched_thenReturnsToCredentialWithMessage", () => {
    const state: LoginState = {
      status: "mfaSubmitting",
      error: null,
      emailHint: "test@test.com",
      mfaFormKey: 1,
    };
    const event = { type: "MFA_EXPIRED" };
    const next = loginReducer(state, event);

    expect(next.status).toBe("credential");
    expect(next.emailHint).toBeNull();
    expect(next.error).toBe(AUTH_ERROR_MESSAGES.mfa_expired);
  });
});
