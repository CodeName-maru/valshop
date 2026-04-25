"use client";

import { useState, type FormEvent } from "react";

interface CredentialFormProps {
  loading: boolean;
  error: string | null;
  onSubmit: (credentials: { username: string; password: string }) => void;
}

/**
 * Credential 자격증명 입력 폼
 *
 * username/password를 입력받아 onSubmit 콜백을 호출합니다.
 * prop-driven pure component로 상태는 부모가 관리합니다.
 */
export default function CredentialForm({
  loading,
  error,
  onSubmit,
}: CredentialFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    onSubmit({ username: username.trim(), password });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="login-username" className="text-sm font-medium">
          라이엇 아이디
        </label>
        <input
          id="login-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="예: Player#KR1"
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="login-password" className="text-sm font-medium">
          비밀번호
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          disabled={loading}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading || !username.trim() || !password.trim()}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "인증 중…" : "로그인"}
      </button>
    </form>
  );
}
