import { getRecentPledges } from "@/lib/campaign";

/**
 * GET /api/campaign/recent
 *
 * The recent pledges feed, for the poll that keeps the home page list moving.
 *
 * Public, and deliberately narrow. Everything it can return has been consented
 * to appearing on a public page in exactly this form: a first name and an
 * amount. There is no phone number, no email address and no full name in the
 * shape the service hands back, so there is nothing here to filter out.
 *
 * Reads through the same cache the home page renders from, so a poll every
 * thirty seconds from every open tab costs one query per thirty seconds rather
 * than one per visitor.
 */
export async function GET() {
  const entries = await getRecentPledges();

  return Response.json(entries, {
    headers: { "cache-control": "no-store" },
  });
}
