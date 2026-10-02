import { describe, expect, it } from "vitest";

import {
  decodeOwnerCookie,
  encodeOwnerCookie,
  OWNER_COOKIE_MAX_AGE_SECONDS,
  ownerSetCookie,
  readCookie,
} from "@/lib/owner-cookie";

const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("the ownership cookie", () => {
  it("round trips the ids it was given", () => {
    const value = encodeOwnerCookie([A, B], SECRET)!;
    expect(decodeOwnerCookie(value, SECRET)).toEqual([A, B]);
  });

  it("is never written without a secret", () => {
    expect(encodeOwnerCookie([A], undefined)).toBeNull();
    expect(encodeOwnerCookie([A], "too short")).toBeNull();
    expect(ownerSetCookie([A], undefined)).toBeNull();
  });

  it("is never accepted without a secret, even if it was once valid", () => {
    const value = encodeOwnerCookie([A], SECRET)!;
    expect(decodeOwnerCookie(value, undefined)).toEqual([]);
  });

  it("is refused when signed with another secret", () => {
    const value = encodeOwnerCookie([A], `${SECRET}-other`)!;
    expect(decodeOwnerCookie(value, SECRET)).toEqual([]);
  });

  it("is refused when the payload is edited to name another pledge", () => {
    const [, signature] = encodeOwnerCookie([A], SECRET)!.split(".");
    const forged = Buffer.from(JSON.stringify({ ids: [B], iat: Date.now() / 1000 })).toString(
      "base64url",
    );
    expect(decodeOwnerCookie(`${forged}.${signature}`, SECRET)).toEqual([]);
  });

  it("expires after ninety days", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const value = encodeOwnerCookie([A], SECRET, issued)!;
    const later = new Date(issued.getTime() + (OWNER_COOKIE_MAX_AGE_SECONDS + 60) * 1000);
    expect(decodeOwnerCookie(value, SECRET, later)).toEqual([]);
  });

  it("keeps the newest ten and drops anything that is not a pledge id", () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const value = encodeOwnerCookie([...ids, "not-an-id"], SECRET)!;
    expect(decodeOwnerCookie(value, SECRET)).toEqual(ids.slice(-10));
  });

  it("reads garbage as nothing rather than throwing", () => {
    for (const junk of ["", ".", "a.b", "a.b.c", "%%%.%%%"]) {
      expect(decodeOwnerCookie(junk, SECRET)).toEqual([]);
    }
  });

  it("is httpOnly, Secure and SameSite=Lax, for ninety days", () => {
    const header = ownerSetCookie([A], SECRET)!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${OWNER_COOKIE_MAX_AGE_SECONDS}`);
  });

  it("is found in a Cookie header among others", () => {
    expect(readCookie(`a=1; cf_owner=xyz.abc; b=2`, "cf_owner")).toBe("xyz.abc");
    expect(readCookie(null, "cf_owner")).toBeNull();
  });
});
