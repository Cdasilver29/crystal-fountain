import Link from "next/link";

/**
 * The 403 screen.
 *
 * Rendered by next/navigation's forbidden(), which is what makes the response
 * an actual 403 rather than a 200 carrying an apology. That distinction
 * matters: a monitor, a script or a verification run reads the status, and a
 * refusal that returns 200 is a refusal nothing can detect.
 *
 * Deliberately says nothing about what is behind the wall. Somebody who
 * reached this either knows already or has no business finding out.
 */
export default function Forbidden() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-neutral-50 px-4 py-20 text-center">
      <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
        403
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy">
        Your account cannot open this
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-600">
        This screen is limited to administrators. If you think that is wrong,
        ask an administrator to check your role.
      </p>
      <Link
        href="/admin/pledges"
        className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0a2f6b] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Back to pledges
      </Link>
    </div>
  );
}
