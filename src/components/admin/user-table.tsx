"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ADMIN_ROLES,
  createAdminUserInput,
  MAX_ADMIN_USERS,
  type AdminUserRole,
} from "@/server/contracts/admin-users";

/**
 * Who can sign in to the portal, and what can be done about it.
 *
 * Every destructive control here asks twice, because none of them can be undone
 * by the person who pressed them: a reset ends the other person's sessions and
 * hands them a password only the presser has seen, and deactivating somebody at
 * five o'clock means they cannot get back in that evening.
 *
 * A generated password is shown once and never again. It is not stored anywhere
 * readable and not in the journal, so the panel that displays it stays open
 * until it is dismissed on purpose rather than disappearing on the next render.
 */

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  role: AdminUserRole;
  isActive: boolean;
  isSuper: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Issued = { email: string; password: string; reason: "created" | "reset" };

export function UserTable({
  initial,
  capacity,
  me,
}: {
  initial: UserRow[];
  capacity: { active: number; limit: number; full: boolean };
  me: { id: string; isSuper: boolean };
}) {
  const [users, setUsers] = useState(initial);
  const [room, setRoom] = useState(capacity);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as {
      users: UserRow[];
      capacity: typeof capacity;
    };
    setUsers(body.users);
    setRoom(body.capacity);
  }

  /** Runs one action, keeping the error and busy handling in one place. */
  async function act(
    key: string,
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(path, {
        headers: { "content-type": "application/json" },
        ...init,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          body?.errors
            ? Object.values(body.errors as Record<string, string>)[0]
            : (body?.title ?? "That did not work. Please try again."),
        );
        return null;
      }

      await refresh();
      return body ?? {};
    } catch {
      setError("We could not reach the server. Check your connection.");
      return null;
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {issued && (
        <div
          role="status"
          className="rounded-xl border border-campfire/30 bg-campfire/5 p-4"
        >
          <h3 className="font-semibold text-navy">
            {issued.reason === "created"
              ? "Account created"
              : "Password reset"}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-neutral-700">
            Give this password to {issued.email} yourself. It is shown once and
            cannot be looked up again. They will be asked to set their own the
            first time they sign in.
          </p>
          <p className="tabular mt-3 rounded-lg bg-white px-3 py-2 text-lg font-semibold tracking-wide text-navy select-all">
            {issued.password}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => setIssued(null)}
          >
            I have written it down
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {room.active} of {room.limit} accounts in use
        </p>

        {room.full ? (
          <p className="text-sm text-neutral-500">
            Maximum {MAX_ADMIN_USERS} administrators reached.
          </p>
        ) : (
          <Button type="button" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add user"}
          </Button>
        )}
      </div>

      {adding && !room.full && (
        <AddUserForm
          canCreateAdmin={me.isSuper}
          busy={busy === "create"}
          onSubmit={async (input) => {
            const body = await act("create", "/api/admin/users", {
              method: "POST",
              body: JSON.stringify(input),
            });
            if (body?.temporaryPassword) {
              setIssued({
                email: String(body.email),
                password: String(body.temporaryPassword),
                reason: "created",
              });
              setAdding(false);
            }
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Two factor</th>
              <th className="px-4 py-3 font-medium">Last signed in</th>
              <th className="px-4 py-3 font-medium">Added</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {users.map((user) => {
              const self = user.id === me.id;
              return (
                <tr
                  key={user.id}
                  className={cn(!user.isActive && "bg-neutral-50 text-neutral-500")}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-navy">
                      {user.fullName}
                    </span>
                    {self && <span className="text-neutral-500"> (you)</span>}
                    <span className="block text-xs text-neutral-500">
                      {user.email}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.isSuper ? "super admin" : user.role}
                    {!user.isActive && (
                      <span className="block text-xs">retired</span>
                    )}
                    {user.isActive && user.mustChangePassword && (
                      <span className="block text-xs text-campfire">
                        must set a password
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.twoFactorEnabled ? "Enrolled" : "Not enrolled"}
                  </td>
                  <td className="px-4 py-3">
                    {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-4 py-3">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {user.isActive && !self && (
                        <RowButton
                          busy={busy === `reset-${user.id}`}
                          confirming={confirming === `reset-${user.id}`}
                          onArm={() => setConfirming(`reset-${user.id}`)}
                          onConfirm={async () => {
                            const body = await act(
                              `reset-${user.id}`,
                              `/api/admin/users/${user.id}/password`,
                              { method: "POST" },
                            );
                            if (body?.temporaryPassword) {
                              setIssued({
                                email: user.email,
                                password: String(body.temporaryPassword),
                                reason: "reset",
                              });
                            }
                          }}
                          label="Reset password"
                          confirmLabel="Reset and sign them out?"
                        />
                      )}

                      {user.isActive && !self && !user.isSuper && (
                        <RowButton
                          busy={busy === `off-${user.id}`}
                          confirming={confirming === `off-${user.id}`}
                          onArm={() => setConfirming(`off-${user.id}`)}
                          onConfirm={() =>
                            act(`off-${user.id}`, `/api/admin/users/${user.id}`, {
                              method: "DELETE",
                            })
                          }
                          label="Deactivate"
                          confirmLabel="Deactivate this account?"
                          danger
                        />
                      )}

                      {!user.isActive && !room.full && (
                        <RowButton
                          busy={busy === `on-${user.id}`}
                          confirming={confirming === `on-${user.id}`}
                          onArm={() => setConfirming(`on-${user.id}`)}
                          onConfirm={() =>
                            act(`on-${user.id}`, `/api/admin/users/${user.id}`, {
                              method: "POST",
                            })
                          }
                          label="Reactivate"
                          confirmLabel="Let them sign in again?"
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A row action that asks before it acts.
 *
 * Two presses, not a browser confirm dialog: a dialog blocks the page and reads
 * as a browser fault rather than as a question this screen is asking.
 */
function RowButton({
  label,
  confirmLabel,
  busy,
  confirming,
  onArm,
  onConfirm,
  danger = false,
}: {
  label: string;
  confirmLabel: string;
  busy: boolean;
  confirming: boolean;
  onArm: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  if (confirming) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none disabled:opacity-60"
      >
        {busy ? "Working" : confirmLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onArm}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none",
        danger
          ? "border-neutral-200 text-red-700 hover:border-red-300"
          : "border-neutral-200 text-navy hover:border-denim",
      )}
    >
      {label}
    </button>
  );
}

function AddUserForm({
  canCreateAdmin,
  busy,
  onSubmit,
}: {
  canCreateAdmin: boolean;
  busy: boolean;
  onSubmit: (input: {
    fullName: string;
    email: string;
    role: AdminUserRole;
  }) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminUserRole>("viewer");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A role somebody cannot create is left off the list rather than shown and
  // refused. The route checks again regardless.
  const roles = canCreateAdmin
    ? ADMIN_ROLES
    : ADMIN_ROLES.filter((r) => r !== "admin");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = createAdminUserInput.safeParse({ fullName, email, role });
        if (!parsed.success) {
          const next: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = String(issue.path[0] ?? "form");
            if (!next[key]) next[key] = issue.message;
          }
          setErrors(next);
          return;
        }
        setErrors({});
        onSubmit(parsed.data);
      }}
      className="rounded-xl border border-neutral-200 bg-white p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="new-name">Full name</Label>
          <Input
            id="new-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-2"
          />
          {errors.fullName && (
            <p className="mt-1 text-sm text-red-700">{errors.fullName}</p>
          )}
        </div>

        <div>
          <Label htmlFor="new-email">Email address</Label>
          <Input
            id="new-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-700">{errors.email}</p>
          )}
        </div>

        <div>
          <Label htmlFor="new-role">Role</Label>
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AdminUserRole)}
            className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-navy focus-visible:ring-2 focus-visible:ring-campfire focus-visible:outline-none"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-3 text-sm text-neutral-600">
        A temporary password is generated and shown once. Pass it on yourself;
        nothing is emailed.
      </p>

      <Button type="submit" disabled={busy} className="mt-3">
        {busy ? "Creating" : "Create account"}
      </Button>
    </form>
  );
}
