import { describe, it, expect } from "vitest";
import {
  loginReducer,
  initialLoginState,
  type LoginState,
  type LoginEvent,
} from "@/app/(app)/login/page";
import { AUTH_ERROR_MESSAGES, NETWORK_ERROR_MESSAGE } from "@/app/(app)/login/error-messages";

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
    const event: LoginEvent = { type: "SUBMIT_MFA" };
    const submittingState = loginReducer(state, event);
    expect(submittingState.status).toBe("mfaSubmitting");

    const errorEvent: LoginEvent = { type: "MFA_ERROR", code: "mfa_invalid" };
    const errorState = loginReducer(submittingState, errorEvent);

    expect(errorState.status).toBe("mfa");
    expect(errorState.mfaFormKey).toBe(6); // key incremented
    expect(errorState.error).toBe(AUTH_ERROR_MESSAGES.mfa_invalid);
  });

  it("givenNonMfaInvalidError_whenDispatched_thenMfaFormKeyNotIncremented", () => {
    const state: LoginState = {
      status: "mfa",
      error: null,
      emailHint: "test@test.com",
      mfaFormKey: 5,
    };
    const event: LoginEvent = { type: "SUBMIT_MFA" };
    const submittingState = loginReducer(state, event);

    const errorEvent: LoginEvent = { type: "MFA_ERROR", code: "rate_limited" };
    const errorState = loginReducer(submittingState, errorEvent);

    expect(errorState.status).toBe("mfa");
    expect(errorState.mfaFormKey).toBe(5); // key unchanged
    expect(errorState.error).toBe(AUTH_ERROR_MESSAGES.rate_limited);
  });

  it("givenMfaExpired_whenDispatched_thenReturnsToCredentialWithMessage", () => {
    const state: LoginState = {
      status: "mfaSubmitting",
      error: null,
      emailHint: "test@test.com",
      mfaFormKey: 1,
    };
    const event: LoginEvent = { type: "MFA_EXPIRED" };
    const next = loginReducer(state, event);

    expect(next.status).toBe("credential");
    expect(next.emailHint).toBeNull();
    expect(next.error).toBe(AUTH_ERROR_MESSAGES.mfa_expired);
  });

  it("givenNetworkErrorInCredentialStep_whenDispatched_thenShowsNetworkMessage", () => {
    const state: LoginState = {
      status: "credentialSubmitting",
      error: null,
      emailHint: null,
      mfaFormKey: 0,
    };
    const event: LoginEvent = { type: "NETWORK_ERROR" };
    const next = loginReducer(state, event);

    expect(next.status).toBe("credential");
    expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("givenBackToCredential_whenDispatched_thenClearsEmailHint", () => {
    const state: LoginState = {
      status: "mfa",
      error: "some error",
      emailHint: "test@test.com",
      mfaFormKey: 3,
    };
    const event: LoginEvent = { type: "BACK_TO_CREDENTIAL" };
    const next = loginReducer(state, event);

    expect(next.status).toBe("credential");
    expect(next.emailHint).toBeNull();
    expect(next.error).toBeNull();
  });
});
