"use client";

import { useState, type SubmitEventHandler } from "react";

interface MfaFormProps {
  emailHint: string;
  loading: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onBack: () => void;
}

/**
 * MFA 코드 입력 폼
 *
 * 6자리 숫자 코드를 입력받아 onSubmit 콜백을 호출합니다.
 * prop-driven pure component로 상태는 부모가 관리합니다.
 */
export default function MfaForm({
  emailHint,
  loading,
  error,
  onSubmit,
  onBack,
}: MfaFormProps) {
  const [code, setCode] = useState("");

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) return;
    onSubmit(code.trim());
  };

  // 숫자만 입력되도록 필터
  const handleChange = (value: string) => {
    const filtered = value.replace(/\D/g, "").slice(0, 6);
    setCode(filtered);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          인증 코드가 <strong className="text-foreground">{emailHint}</strong>{" "}
          (으)로 전송되었습니다.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="mfa-code" className="text-sm font-medium">
          인증 코드
        </label>
        <input
          id="mfa-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          disabled={loading}
          value={code}
          onChange={(e) => { handleChange(e.target.value); }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="000000"
          required
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          처음으로
        </button>
        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "인증 중…" : "인증"}
        </button>
      </div>
    </form>
  );
}
