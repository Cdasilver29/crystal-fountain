import { cookies } from "next/headers";

import { env } from "@/env";
import { decodeOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/owner-cookie";

/**
 * Whether the browser asking made this pledge, for server components.
 *
 * Reads the signed ownership cookie through next/headers. Reading a cookie
 * makes the page render per request, so a page that varies by viewer can never
 * be prerendered once and served to everybody. With no OWNER_COOKIE_SECRET
 * nobody owns anything, and everybody sees the masked view.
 */
export async function ownsPledge(pledgeId: string): Promise<boolean> {
  const store = await cookies();
  const owned = decodeOwnerCookie(
    store.get(OWNER_COOKIE_NAME)?.value,
    env.OWNER_COOKIE_SECRET,
  );
  return owned.includes(pledgeId);
}
