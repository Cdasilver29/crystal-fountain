"use client";

import {
  CONFIRMATION_METHODS,
  type ConfirmationMethod,
} from "@/server/contracts/pledges";

/**
 * How the treasurer confirmed something with the real pledger.
 *
 * Shared by the held additions queue and the change request queue, so the
 * question is asked the same way everywhere a decision depends on having
 * spoken to the pledger. Nothing is preselected: the button it guards stays
 * disabled until somebody has said which, and the answer goes into the audit
 * row.
 */
export function ConfirmationMethodPicker({
  name,
  value,
  onChange,
}: {
  /** Unique per card, so two cards' radios are separate groups. */
  name: string;
  value: ConfirmationMethod | null;
  onChange: (method: ConfirmationMethod) => void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium text-navy">
        How did you confirm it?
      </legend>
      <div className="mt-2 space-y-2">
        {(Object.keys(CONFIRMATION_METHODS) as ConfirmationMethod[]).map((key) => (
          <label key={key} className="flex items-start gap-3 text-sm text-neutral-800">
            <input
              type="radio"
              name={name}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
              className="mt-0.5 size-4"
            />
            {CONFIRMATION_METHODS[key]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
