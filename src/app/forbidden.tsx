import Link from "next/link";

import { STATUS_PRIMARY, StatusPage } from "@/components/site/status-page";
import { frauncesStatus } from "@/lib/fonts-status";

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
 *
 * It sits outside the (site) layout, so it applies the display serif variable
 * itself for its heading.
 */
export default function Forbidden() {
  return (
    <div className={`${frauncesStatus.variable} contents`}>
      <StatusPage
        title="Your account cannot open this"
        lead="This screen is limited to administrators. If you think that is wrong, ask an administrator to check your role."
        actions={
          <Link href="/admin/pledges" className={STATUS_PRIMARY}>
            Back to pledges
          </Link>
        }
      />
    </div>
  );
}
