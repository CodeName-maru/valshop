/**
 * Plan 0014 Phase 2: user-tokens-repo unit tests with mocked supabase client.
 */

import { describe, it, expect, vi } from "vitest";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import { BytEaParseError } from "@/lib/supabase/bytea";

interface SelectChain {
  eq: ReturnType<typeof vi.fn>;
  single?: ReturnType<typeof vi.fn>;
}

function makeListActiveClient(rows: any[] | null, error: any = null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, _spies: { from, select, eq } };
}

function makeGetClient(row: any | null, error: any = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, _spies: { from, select, eq, single } };
}

function makeUpdateClient() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, _spies: { from, update, eq } };
}

function makeUpsertClient(returningRow: any | null, error: any = null) {
  const single = vi.fn().mockResolvedValue({ data: returningRow, error });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { from, _spies: { from, upsert, select, single } };
}

describe("createUserTokensRepo", () => {
  it("Test 2-1: listActive normalizes \\x hex bytea fields to Uint8Array", async () => {
    const client = makeListActiveClient([
      {
        user_id: "u1",
        puuid: "p1",
        access_token_enc: "\\x4855",
        refresh_token_enc: "\\x4856",
        entitlements_jwt_enc: "\\x4857",
        expires_at: "2030-01-01T00:00:00Z",
        created_at: "2030-01-01T00:00:00Z",
        updated_at: "2030-01-01T00:00:00Z",
        needs_reauth: false,
      },
    ]);
    const repo = createUserTokensRepo(client);
    const rows = await repo.listActive();
    expect(rows).toHaveLength(1);
    expect(rows[0].access_token_enc).toBeInstanceOf(Uint8Array);
    expect(Array.from(rows[0].access_token_enc)).toEqual([0x48, 0x55]);
    expect(Array.from(rows[0].refresh_token_enc)).toEqual([0x48, 0x56]);
    expect(Array.from(rows[0].entitlements_jwt_enc)).toEqual([0x48, 0x57]);
    expect(client._spies.eq).toHaveBeenCalledWith("needs_reauth", false);
  });

  it("Test 2-2: get normalizes \\x hex bytea fields to Uint8Array", async () => {
    const client = makeGetClient({
      user_id: "u1",
      puuid: "p1",
      access_token_enc: "\\x4855",
      refresh_token_enc: "\\x4856",
      entitlements_jwt_enc: "\\x4857",
      expires_at: "2030-01-01T00:00:00Z",
      created_at: "2030-01-01T00:00:00Z",
      updated_at: "2030-01-01T00:00:00Z",
      needs_reauth: false,
    });
    const repo = createUserTokensRepo(client);
    const row = await repo.get("u1");
    expect(row).not.toBeNull();
    expect(row!.access_token_enc).toBeInstanceOf(Uint8Array);
    expect(Array.from(row!.access_token_enc)).toEqual([0x48, 0x55]);
  });

  it("Test 2-3: get throws BytEaParseError with column label on invalid bytea", async () => {
    const client = makeGetClient({
      user_id: "u1",
      puuid: "p1",
      access_token_enc: "not-bytea-and-not-base64!!!",
      refresh_token_enc: "\\x4856",
      entitlements_jwt_enc: "\\x4857",
      expires_at: "2030-01-01T00:00:00Z",
      created_at: "2030-01-01T00:00:00Z",
      updated_at: "2030-01-01T00:00:00Z",
      needs_reauth: false,
    });
    const repo = createUserTokensRepo(client);
    await expect(repo.get("u1")).rejects.toThrow(BytEaParseError);
    try {
      await repo.get("u1");
    } catch (e) {
      expect((e as Error).message).toContain("access_token_enc");
    }
  });

  it("Test 2-4: upsert serializes Uint8Array bytea fields to \\x hex literals", async () => {
    const client = makeUpsertClient({ user_id: "u-new" });
    const repo = createUserTokensRepo(client);
    const access = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const refresh = new Uint8Array([0x01, 0x02]);
    const ent = new Uint8Array([0xab]);
    const out = await repo.upsert({
      puuid: "puuid-1",
      access_token_enc: access,
      refresh_token_enc: refresh,
      entitlements_jwt_enc: ent,
      expires_at: new Date("2030-06-01T00:00:00Z"),
    });
    expect(out.user_id).toBe("u-new");
    expect(client._spies.upsert).toHaveBeenCalledTimes(1);
    const payload = client._spies.upsert.mock.calls[0][0];
    expect(payload.access_token_enc).toBe("\\xdeadbeef");
    expect(payload.refresh_token_enc).toBe("\\x0102");
    expect(payload.entitlements_jwt_enc).toBe("\\xab");
    expect(payload.puuid).toBe("puuid-1");
    expect(payload.needs_reauth).toBe(false);
    expect(payload.expires_at).toBe("2030-06-01T00:00:00.000Z");
    // onConflict option used
    const opts = client._spies.upsert.mock.calls[0][1];
    expect(opts).toMatchObject({ onConflict: "puuid" });
  });

  it("Test 2-5: markNeedsReauth calls update({needs_reauth:true}).eq(user_id, ...)", async () => {
    const client = makeUpdateClient();
    const repo = createUserTokensRepo(client);
    await repo.markNeedsReauth("u1");
    expect(client._spies.update).toHaveBeenCalledTimes(1);
    expect(client._spies.update).toHaveBeenCalledWith({ needs_reauth: true });
    expect(client._spies.eq).toHaveBeenCalledWith("user_id", "u1");
  });
});
