/**
 * TokenVault 포트 인터페이스
 * Plan 0002에서 정의된 인터페이스를 MVP에서 구현
 *
 * Phase 2에서는 Supabase 기반 구현체로 대체될 예정
 */

export interface EncryptedTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TokenVault {
  put(userId: string, tokens: EncryptedTokenSet): Promise<void>;
  get(userId: string): Promise<EncryptedTokenSet | null>;
  delete(userId: string): Promise<void>;
}

/**
 * MVP 구현체: No-op Token Vault
 * Phase 2 이전까지 서버측 vault는 no-op으로 동작
 * 토큰은 httpOnly cookie에만 저장됨
 */
export class NoopTokenVault implements TokenVault {
  async put(_userId: string, _tokens: EncryptedTokenSet): Promise<void> {
    // MVP: no-op
  }

  async get(_userId: string): Promise<EncryptedTokenSet | null> {
    // MVP: no-op
    return null;
  }

  async delete(_userId: string): Promise<void> {
    // MVP: no-op (Phase 2에서 Supabase row 삭제로 확장)
  }
}

/**
 * Singleton 인스턴스
 */
export const tokenVault = new NoopTokenVault();
