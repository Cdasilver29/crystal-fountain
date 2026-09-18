"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { displayName } from "@/server/display-name";

/**
 * The organisation flag, on the pledge detail screen.
 *
 * A checkbox that saves as soon as it is ticked, because there is nothing else
 * on the control to confirm and a Save button beside a single checkbox is a
 * second click for no decision. It is not destructive and it is reversible in
 * the same place, which is what makes that safe here and not on the delete
 * control two sections down.
 *
 * The preview underneath is the point. Whether a name should be published whole
 * is a judgement about that exact string, so the screen shows both renderings
 * rather than asking the treasurer to hold the rule in their head. The same
 * function the public pages use produces it, so what is shown here is what will
 * appear on the site.
 */
export function PledgerOrganisation({
  pledgeId,
  storedName,
  initial,
  displayConsent,
}: {
  pledgeId: string;
  /** The display name as stored, or null when the pledger gave none. */
  storedName: string | null;
  initial: boolean;
  /** Whether this name appears publicly at all, so the copy can say so. */
  displayConsent: boolean;
}) {
  const router = useRouter();
  const [isOrganisation, setIsOrganisation] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    const previous = isOrganisation;

    // Moved before the request, so the checkbox answers the click immediately,
    // and put back below if the server refuses.
    setIsOrganisation(next);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/pledges/${pledgeId}/organisation`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isOrganisation: next }),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setIsOrganisation(previous);
        setError(body?.title ?? "We could not save that.");
        return;
      }

      // So the rest of the screen, and the cached public pages, reflect it.
      router.refresh();
    } catch {
      setIsOrganisation(previous);
      setError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const preview = storedName
    ? displayName(storedName, { isOrganisation })
    : null;

  return (
    <div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isOrganisation}
          disabled={busy}
          onChange={(event) => save(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-neutral-300 text-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none disabled:opacity-50"
        />
        <span className="text-sm text-navy">
          This pledger is an organisation, not an individual
        </span>
      </label>

      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        A fund, a ministry or a choir has no surname to protect, so its name is
        shown in full. An individual is shown as a first name and an initial.
      </p>

      {preview ? (
        <p className="mt-3 text-xs text-neutral-600">
          Shown publicly as{" "}
          <span className="font-medium text-navy">{preview}</span>
          {displayConsent ? "" : ", if this pledger ever gives permission"}
        </p>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          This pledger gave no display name, so nothing appears publicly either
          way.
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
