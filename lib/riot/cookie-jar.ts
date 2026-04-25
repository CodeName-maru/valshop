/**
 * Riot Cookie Jar
 *
 * per-request 쿠키 관리를 위한 thin wrapper.
 * tough-cookie를 사용하여 Riot의 asid/clid/tdid/ssid 쿠키를 관리합니다.
 *
 * 보안 고려사항:
 * - 이 jar는 메모리에만 존재하며 직렬화 시 plan 0020에서 AES-GCM 암호화 필요
 * - 쿠키는 요청 생명주기 동안만 유효
 */

import { CookieJar as ToughCookieJar, Cookie } from "tough-cookie";

/**
 * RiotCookieJar - tough-cookie의 래퍼
 *
 * 공개 메서드:
 * - storeFromResponse(url, res): Response의 Set-Cookie 헤더를 저장
 * - getHeader(url): 해당 URL에 매칭되는 쿠키 문자열 반환
 * - serialize(): JSON 문자열로 직렬화 (암호화되지 않음 - 상위 레이어에서 암호화 필요)
 * - deserialize(blob): JSON 문자열에서 역직렬화
 */
export class RiotCookieJar {
  private jar: ToughCookieJar;

  constructor() {
    this.jar = new ToughCookieJar();
  }

  /**
   * Response의 Set-Cookie 헤더를 jar에 저장합니다.
   * @param url - 요청 URL
   * @param res - Response 객체
   */
  async storeFromResponse(url: string, res: Response): Promise<void> {
    const cookies = res.headers.getSetCookie();
    if (cookies.length === 0) {
      return;
    }

    for (const cookieHeader of cookies) {
      const cookie = Cookie.parse(cookieHeader);
      if (cookie) {
        await this.jar.setCookie(cookie, url);
      }
    }
  }

  /**
   * 해당 URL에 매칭되는 쿠키 문자열을 반환합니다.
   * @param url - 요청 URL
   * @returns 쿠키 헤더 문자열 (없으면 빈 문자열)
   */
  async getHeader(url: string): Promise<string> {
    const cookies = await this.jar.getCookies(url);
    if (cookies.length === 0) {
      return "";
    }
    return cookies.map((c) => c.cookieString()).join("; ");
  }

  /**
   * jar를 JSON 문자열로 직렬화합니다.
   * 주의: 암호화되지 않으므로 저장 시 상위 레이어에서 암호화 필요.
   */
  serialize(): string {
    return JSON.stringify(this.jar.toJSON());
  }

  /**
   * JSON 문자열에서 jar를 역직렬화합니다.
   * 실패 시 빈 jar를 반환합니다.
   */
  static deserialize(blob: string): RiotCookieJar {
    try {
      const parsed = JSON.parse(blob);
      // tough-cookie의 CookieJar는 fromJSON 스태틱 메서드를 제공
      const jar = ToughCookieJar.fromJSON(parsed);
      const wrapper = new RiotCookieJar();
      wrapper.jar = jar;
      return wrapper;
    } catch {
      // 파싱 실패 시 빈 jar 반환
      return new RiotCookieJar();
    }
  }
}
