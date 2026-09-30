import { cache } from "react";

import { db } from "@/db";
import { publicTokenInput } from "@/server/contracts/pledges";
import * as pledges from "@/server/services/pledges";

/**
 * The pledge behind a public token, looked up once per request.
 *
 * The two token pages, /p/<token> and /pledge/confirmed/<token>, need it
 * twice: the tab title has to know whether the token is real, so a mistyped
 * link says "Page not found" in the tab as well as on the page, and the page
 * needs the pledge itself. React's cache makes the second call within the same
 * request reuse the first, so knowing the title costs no extra query.
 *
 * A token that fails the contract is not looked up at all.
 */
export const findPledgeByToken = cache(async (token: string) => {
  const parsed = publicTokenInput.safeParse({ publicToken: token });
  if (!parsed.success) return null;
  const pledge = await pledges.getByPublicToken(db, {
    publicToken: parsed.data.publicToken,
  });
  return pledge ? { pledge, publicToken: parsed.data.publicToken } : null;
});

/** The tab title of a token page whose token does not match a pledge. */
export const TOKEN_NOT_FOUND_TITLE = "Page not found";
