import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import MfaForm from "@/app/(app)/login/mfa-form";

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

  it("givenMfaForm_whenCodeSubmitted_thenOnSubmitCalled", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <MfaForm
        emailHint="x"
        loading={false}
        error={null}
        onSubmit={onSubmit}
        onBack={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/인증 코드/i), "123456");
    await user.click(screen.getByRole("button", { name: /^인증$/ }));

    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("givenMfaForm_whenBackClicked_thenOnBackCalled", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <MfaForm
        emailHint="x"
        loading={false}
        error={null}
        onSubmit={vi.fn()}
        onBack={onBack}
      />
    );

    await user.click(screen.getByRole("button", { name: /처음으로/ }));

    expect(onBack).toHaveBeenCalled();
  });

  it("givenMfaForm_whenNonNumericInput_thenOnlyNumbersAccepted", async () => {
    const user = userEvent.setup();
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
    await user.type(input, "abc123def");

    // 숫자만 남아야 함
    expect(input.value).toBe("123");
  });

  it("givenMfaForm_whenMoreThan6Digits_thenTruncatedTo6", async () => {
    const user = userEvent.setup();
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
    await user.type(input, "123456789");

    expect(input.value).toBe("123456");
  });
});
