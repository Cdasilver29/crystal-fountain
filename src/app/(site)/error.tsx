"use client";

import Link from "next/link";

import {
  STATUS_PRIMARY,
  STATUS_SECONDARY,
  StatusPage,
} from "@/components/site/status-page";

/**
 * What a public page shows when it throws while rendering.
 *
 * Sits inside the (site) layout, so the header and footer stay put and only
 * the page itself is replaced.
 *
 * Reporting happens on the server, not here. A server component that throws
 * is sent to Sentry by onRequestError in src/instrumentation.ts, with the same
 * digest this boundary receives. The browser SDK is deliberately not loaded
 * (see sentry.client.config.ts), so calling captureException here would add
 * the SDK to the bundle and send nothing.
 *
 * The error is never rendered. In production Next has already replaced a
 * server error's message with a generic one, but a client error arrives
 * intact, so the rule is simply that nothing from it reaches the page.
 */
export default function SiteError({ reset }: { reset: () => void }) {
  return (
    <StatusPage
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
          <Link href="/" className={STATUS_SECONDARY}>
            Home
          </Link>
          <Link href="/pledge" className={STATUS_PRIMARY}>
            Make a pledge
          </Link>
        </>
      }
    />
  );
}
