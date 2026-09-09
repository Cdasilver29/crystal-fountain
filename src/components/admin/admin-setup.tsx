"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The first run form.
 *
 * Creates one administrator and then gets out of the way. It does not sign the
 * new admin in: they go through the normal login screen, which is where TOTP
 * enrolment happens, so there is exactly one enrolment path rather than two.
 */
export function AdminSetup() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});

    try {
      const response = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, email, password, confirmPassword }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrors(body?.errors ?? {});
        setError(body?.errors ? null : (body?.title ?? "That did not work."));
        setBusy(false);
        return;
      }

      router.replace("/admin/login");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight text-navy">
        Create the first administrator
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        This page works once. Once an administrator exists it stops responding,
        and further accounts are created from inside the admin area.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field
          id="fullName"
          label="Full name"
          type="text"
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          error={errors.fullName}
          autoFocus
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          error={errors.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
          hint="At least 12 characters."
        />
        <Field
          id="confirmPassword"
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          error={errors.confirmPassword}
        />

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-campfire px-6 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Creating" : "Create administrator"}
        </button>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-navy">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none aria-[invalid]:border-red-400"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
