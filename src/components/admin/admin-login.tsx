"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * The admin login form.
 *
 * Three steps behind one card. Password first, then either a TOTP code or, if
 * this account has never enrolled, the enrolment QR followed by the same code
 * field. Enrolment is not optional for an admin, so there is no way past it:
 * the only route out of the enrol step is a verified code.
 *
 * The password stage posts to /api/admin/login rather than to Better Auth, so
 * the per email lockout wraps it. The two factor steps talk to Better Auth
 * directly, where the plugin's own account lockout applies.
 */

type Step = "password" | "totp" | "enrol";

export function AdminLogin({ next }: { next: string }) {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enrolment material, held only for the life of this form.
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // The QR is drawn in the browser because the URI never reaches the server in
  // a form it could render from. Imported on demand so the encoder is not in
  // the bundle for the password step.
  useEffect(() => {
    if (!totpUri) return;
    let live = true;
    void (async () => {
      const QRCode = (await import("qrcode")).default;
      const svg = await QRCode.toString(totpUri, {
        type: "svg",
        margin: 1,
        width: 200,
      });
      if (live) setQrSvg(svg);
    })();
    return () => {
      live = false;
    };
  }, [totpUri]);

  function done() {
    // A full navigation, not router.push, so the new session cookie is read by
    // the server on the way in rather than a cached RSC payload being reused.
    window.location.assign(next);
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.title ?? "That did not work.");
        setBusy(false);
        return;
      }

      // Better Auth answers with twoFactorRedirect when the account already has
      // a verified second factor.
      if (body?.twoFactorRedirect) {
        setStep("totp");
        setBusy(false);
        return;
      }

      // Signed in with no second factor on the account. Enrol before going
      // anywhere: TOTP is mandatory for an admin.
      // method is passed explicitly: the response is a union and only the totp
      // branch carries a URI to build a QR from.
      const enrolled = await authClient.twoFactor.enable({
        password,
        method: "totp",
      });

      if (enrolled.error || !enrolled.data || !("totpURI" in enrolled.data)) {
        setError(
          enrolled.error?.message ??
            "Signed in, but two factor enrolment could not start.",
        );
        setBusy(false);
        return;
      }

      setTotpUri(enrolled.data.totpURI);
      setBackupCodes(enrolled.data.backupCodes ?? []);
      setStep("enrol");
      setBusy(false);
    } catch {
      setError("Could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });

    if (result.error) {
      setError(
        result.error.message ?? "That code is not right. Try the next one.",
      );
      setCode("");
      setBusy(false);
      return;
    }

    done();
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight text-navy">
        {step === "password" ? "Admin sign in" : "Two factor"}
      </h1>

      {step === "password" && (
        <form onSubmit={submitPassword} className="mt-6 space-y-4">
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            autoFocus
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <Problem message={error} />
          <Submit busy={busy} label="Sign in" busyLabel="Signing in" />

          {/*
            There is no self-service reset, and this says so plainly rather
            than offering a link that goes nowhere. A page that emails a reset
            link needs an email provider, and one that shows the link on screen
            would hand any passer by an account: type an address, read the
            link, take the account. The super administrator resets passwords
            from the portal instead.
          */}
          <p className="mt-4 text-center text-sm text-neutral-600">
            Forgot your password? Ask the super administrator to reset it for
            you from the administrators screen.
          </p>
        </form>
      )}

      {step === "enrol" && (
        <div className="mt-6">
          <p className="text-sm leading-relaxed text-neutral-700">
            This account has no second factor yet. Scan this with an
            authenticator app, then enter the six digit code it shows.
          </p>

          <div className="mt-5 flex justify-center rounded-xl border border-neutral-200 bg-white p-4">
            {qrSvg ? (
              <div
                aria-label="Two factor enrolment QR code"
                // The SVG comes from the qrcode encoder in this browser, not
                // from anything a user typed.
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <p className="py-16 text-sm text-neutral-500">
                Preparing the code
              </p>
            )}
          </div>

          {totpUri && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-denim">
                Cannot scan it?
              </summary>
              <p className="mt-2 break-all rounded-lg bg-neutral-50 p-3 font-mono text-xs text-neutral-700 select-all">
                {totpUri}
              </p>
            </details>
          )}

          {backupCodes.length > 0 && (
            <div className="mt-4 rounded-xl bg-navy/5 p-4">
              <p className="text-sm font-medium text-navy">
                Write these backup codes down now
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                They are the only way in if you lose the authenticator. They are
                not shown again.
              </p>
              <ul className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-navy">
                {backupCodes.map((backup) => (
                  <li key={backup} className="select-all">
                    {backup}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={submitCode} className="mt-5 space-y-4">
            <CodeField value={code} onChange={setCode} />
            <Problem message={error} />
            <Submit busy={busy} label="Verify and finish" busyLabel="Checking" />
          </form>
        </div>
      )}

      {step === "totp" && (
        <form onSubmit={submitCode} className="mt-6 space-y-4">
          <p className="text-sm leading-relaxed text-neutral-700">
            Enter the six digit code from your authenticator app.
          </p>
          <CodeField value={code} onChange={setCode} autoFocus />
          <Problem message={error} />
          <Submit busy={busy} label="Verify" busyLabel="Checking" />
        </form>
      )}
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
  autoFocus,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
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
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3 text-base text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
      />
    </div>
  );
}

function CodeField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor="code" className="block text-sm font-medium text-navy">
        Six digit code
      </label>
      <input
        id="code"
        // Not type="number": a leading zero must survive and the spinners are
        // useless here.
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        required
        autoFocus={autoFocus}
        autoComplete="one-time-code"
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, 6))
        }
        className="tabular mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3 text-lg tracking-[0.3em] text-navy focus-visible:border-campfire focus-visible:ring-2 focus-visible:ring-campfire/40 focus-visible:outline-none"
      />
    </div>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-800"
    >
      {message}
    </p>
  );
}

function Submit({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-campfire px-6 text-base font-semibold text-white transition-colors hover:bg-[#ef7433] focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
