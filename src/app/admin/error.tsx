"use client";

import Link from "next/link";

import {
  STATUS_PRIMARY,
  STATUS_SECONDARY,
  StatusPage,
} from "@/components/site/status-page";

/**
 * What an admin screen shows when it throws while rendering.
 *
 * The same treatment as the public error page, on the admin width, and the
 * way out is the pledge list rather than the public site. Reporting is done on
 * the server by onRequestError, for the reason given in (site)/error.tsx, and
 * the error itself is never shown.
 */
export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <StatusPage
      width="container-table"
      title="Something went wrong"
      lead="The page could not load. This has been reported and we are looking at it."
      actions={
        <>
          <button
            type="button"
            onClick={() => reset()}
            className={STATUS_SECONDARY}
          >
            Try again
          </button>
          <Link href="/admin/pledges" className={STATUS_PRIMARY}>
            Back to pledges
          </Link>
        </>
      }
    />
  );
}
