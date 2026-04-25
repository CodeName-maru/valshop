import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import CredentialForm from "@/app/(app)/login/credential-form";

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
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/계정 정보가 올바르지 않/);
  });

  it("givenFilledForm_whenSubmitted_thenOnSubmitCalledWithCredentials", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CredentialForm loading={false} error={null} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/라이엇 아이디|아이디/i), "player#KR1");
    await user.type(screen.getByLabelText(/비밀번호/i), "pw1234");
    await user.click(screen.getByRole("button", { name: /로그인/ }));

    expect(onSubmit).toHaveBeenCalledWith({
      username: "player#KR1",
      password: "pw1234",
    });
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

  it("givenCredentialForm_whenRendered_thenUsernameInputHasAutocomplete", () => {
    render(
      <CredentialForm loading={false} error={null} onSubmit={vi.fn()} />
    );
    const u = screen.getByLabelText(/라이엇 아이디|아이디/i);

    expect(u).toHaveAttribute("autoComplete", "username");
    expect(u).toHaveAttribute("name", "username");
  });
});
