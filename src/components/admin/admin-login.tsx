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

/** What the password stage decided the next screen should be. */
type Outcome =
  | { kind: "verify" }
  | { kind: "enrol"; totpUri: string; backupCodes: string[] }
  | { kind: "failed"; message: string };

export function AdminLogin({
  next,
  googleEnabled = false,
  rejection = null,
}: {
  next: string;
  /** Whether both Google keys are configured. Decided on the server. */
  googleEnabled?: boolean;
  /**
   * The mapped sentence for a refused Google sign in, already turned from a
   * code into words on the server. Never text taken from the query string.
   */
  rejection?: string | null;
}) {
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Seeded with the refusal, so a bounce back from Google reads as an error on
  // this form rather than as a page that silently forgot what happened.
  const [error, setError] = useState<string | null>(rejection);
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

  /**
   * The password stage, and the decision about what comes after it.
   *
   * Verify or enrol turns on what the account can actually do, not on the
   * twoFactorRedirect flag alone. That flag only says a second factor is
   * expected; twoFactorMethods says which ones are enrolled, and an account
   * whose enrolment row was deleted answers the first without the second. The
   * old code read the flag by itself and sent those accounts to a code field
   * that could never pass.
   *
   * That case is repaired by the login route before it signs anybody in, so it
   * should not reach here at all. If it does, because the row went missing in
   * between, one more attempt goes through the repair and comes back with a
   * session. One, and then it gives up rather than looping.
   */
  async function runPasswordStage(attempt = 0): Promise<Outcome> {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return { kind: "failed", message: body?.title ?? "That did not work." };
    }

    if (body?.twoFactorRedirect) {
      const methods: unknown = body.twoFactorMethods;
      // An older shape with no list at all is taken at its word.
      const enrolled = Array.isArray(methods) ? methods.includes("totp") : true;

      if (enrolled) return { kind: "verify" };
      if (attempt === 0) return runPasswordStage(attempt + 1);

      return {
        kind: "failed",
        message:
          "This account expects a second factor but has nothing enrolled. Ask the super administrator to reset it.",
      };
    }

    // Signed in with no second factor on the account. Enrol before going
    // anywhere: TOTP is mandatory for an admin.
    // method is passed explicitly: the response is a union and only the totp
    // branch carries a URI to build a QR from.
    const started = await authClient.twoFactor.enable({
      password,
      method: "totp",
    });

    if (started.error || !started.data || !("totpURI" in started.data)) {
      return {
        kind: "failed",
        message:
          started.error?.message ??
          "Signed in, but two factor enrolment could not start.",
      };
    }

    return {
      kind: "enrol",
      totpUri: started.data.totpURI,
      backupCodes: started.data.backupCodes ?? [],
    };
  }

  /** Moves the form to whichever screen the password stage settled on. */
  function show(outcome: Outcome) {
    setBusy(false);

    if (outcome.kind === "failed") {
      setError(outcome.message);
      return;
    }

    if (outcome.kind === "verify") {
      setStep("totp");
      return;
    }

    setTotpUri(outcome.totpUri);
    setBackupCodes(outcome.backupCodes);
    setCode("");
    setStep("enrol");
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      show(await runPasswordStage());
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
      /*
       * "TOTP not enabled" means the enrolment this code would be checked
       * against is not there, so no code will ever work and repeating the
       * message is a dead end. The way out is enrolment, which needs a
       * session, and this screen has none: the password stage traded it for a
       * two factor challenge. So the password goes back through that stage,
       * which repairs the account on the way and hands back a session and a
       * fresh QR.
       */
      const missing =
        result.error.code === "TOTP_NOT_ENABLED" ||
        result.error.message === "TOTP not enabled";

      if (missing) {
        setCode("");

        try {
          const outcome = await runPasswordStage();

          if (outcome.kind === "enrol") {
            show(outcome);
            setError(
              "This account has no second factor enrolled any more. Set one up below.",
            );
            return;
          }
        } catch {
          setError("Could not reach the server. Check your connection.");
          setBusy(false);
          return;
        }
      }

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

      {step === "password" && googleEnabled && (
        <>
          <GoogleButton next={next} onFailure={setError} />
          <Divider />
        </>
      )}

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

/**
 * The four colour G, drawn inline.
 *
 * Inline rather than an image file or a CDN link on purpose. It is four paths
 * and a viewBox, so it costs less than the request it replaces, it cannot fail
 * to load and leave a button with a gap where the mark should be, and it asks
 * nothing of a third party at the moment somebody is signing in.
 *
 * aria-hidden because the button's own text already says Google. A title here
 * would have a screen reader announce the word twice.
 */
function GoogleLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

/**
 * The Google option, offered above the password form.
 *
 * The whole exchange is a full page navigation to Google and back, so there is
 * no success path to handle here. Only the failure to leave at all is caught:
 * if Better Auth cannot even produce a redirect, the person is told rather
 * than left looking at a button that did nothing.
 *
 * errorCallbackURL is what brings a refusal back to this page instead of
 * Better Auth's own error screen. It carries next through, so somebody who was
 * sent here from a deep link still lands there once they get in.
 */
function GoogleButton({
  next,
  onFailure,
}: {
  next: string;
  onFailure: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    onFailure("");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: next,
        errorCallbackURL: `/admin/login?next=${encodeURIComponent(next)}`,
      });

      // Reached only when the redirect never happened.
      if (result?.error) {
        onFailure(
          result.error.message ??
            "Sign-in failed. Try again or use your email and password.",
        );
        setBusy(false);
      }
    } catch {
      onFailure("Could not reach the server. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className="btn-secondary mt-6 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-3 border border-neutral-300 bg-white px-6 text-base font-medium text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleLogo />
      {busy ? "Taking you to Google" : "Continue with Google"}
    </button>
  );
}

/**
 * The word "or" sitting on a rule.
 *
 * The rule is decorative, so it is aria-hidden and the word carries no
 * meaning of its own to a screen reader, which reaches the button and the form
 * in order regardless.
 */
function Divider() {
  return (
    <div className="mt-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-neutral-200" />
      <span className="text-sm text-neutral-500">or</span>
      <span className="h-px flex-1 bg-neutral-200" />
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
      className="btn-primary inline-flex h-11 w-full cursor-pointer items-center justify-center bg-campfire px-6 text-base font-semibold text-white focus-visible:ring-2 focus-visible:ring-campfire focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
