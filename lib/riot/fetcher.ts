/**
 * Riot Fetcher Port (owned by Plan 0006)
 * Plan 0001 consumes this for DI
 */

export interface RiotFetcher {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Default fetcher using global fetch
 * Plan 0006 will replace this with enhanced version (timeout, retry, logging)
 */
export const defaultRiotFetcher: RiotFetcher = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
};
