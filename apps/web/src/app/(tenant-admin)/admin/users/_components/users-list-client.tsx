"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Status = "active" | "invited" | "suspended";

type Membership = {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  status: Status;
  joinedAt: string | null;
  roleId: string;
  roleSlug: string;
  roleName: string;
};

type Role = {
  id: string;
  name: string;
  slug: string;
};

type Invitation = {
  id: string;
  email: string;
  createdAt: string;
  roleName: string;
  roleSlug: string;
  invitedByName: string | null;
};

type Props = {
  actorUserId: string;
  actorIsOwner: boolean;
  initialQuery: string;
  initialRoleFilter: string;
  initialStatusFilter: string;
  memberships: Membership[];
  roles: Role[];
  invitations: Invitation[];
};

const statusStyles: Record<Status, string> = {
  active: "bg-green-100 text-green-800",
  invited: "bg-amber-100 text-amber-800",
  suspended: "bg-gray-200 text-gray-700",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB");
}

export function UsersListClient({
  actorUserId,
  actorIsOwner,
  initialQuery,
  initialRoleFilter,
  initialStatusFilter,
  memberships,
  roles,
  invitations,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(initialQuery);
  const [roleFilter, setRoleFilter] = useState(initialRoleFilter);
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rowError, setRowError] = useState<{ userId: string; msg: string } | null>(
    null
  );

  function applyFilters(
    nextQuery = query,
    nextRole = roleFilter,
    nextStatus = statusFilter
  ) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextRole) params.set("role", nextRole);
    if (nextStatus) params.set("status", nextStatus);
    const qs = params.toString();
    startTransition(() => router.push(`/admin/users${qs ? `?${qs}` : ""}`));
  }

  async function patchMembership(
    userId: string,
    body: Record<string, unknown>
  ) {
    setRowError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setRowError({
        userId,
        msg: j.error ?? `Request failed (${res.status})`,
      });
      return;
    }
    startTransition(() => router.refresh());
  }

  async function revokeInvitation(id: string) {
    const res = await fetch(`/api/admin/users/invitations/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  // For role assignment dropdown: Owner is only selectable by Owners.
  function assignableRoles() {
    return roles.filter((r) => r.slug !== "owner" || actorIsOwner);
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          method="GET"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Search
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
              className="mt-1 w-64 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Role
            </label>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                applyFilters(query, e.target.value, statusFilter);
              }}
              className="mt-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                applyFilters(query, roleFilter, e.target.value);
              }}
              className="mt-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
          >
            Apply
          </button>
        </form>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
        >
          Invite user
        </button>
      </div>

      {/* Users table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {memberships.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                >
                  No users match.
                </td>
              </tr>
            )}
            {memberships.map((m) => {
              const isSelf = m.userId === actorUserId;
              const isExpanded = expandedUserId === m.userId;
              const canTouchOwner =
                actorIsOwner || m.roleSlug !== "owner";
              return (
                <Fragment key={m.membershipId}>
                  <tr
                    className="hover:bg-[var(--muted)]/50 cursor-pointer"
                    onClick={() =>
                      setExpandedUserId(isExpanded ? null : m.userId)
                    }
                  >
                    <td className="px-4 py-3 font-medium">
                      {m.fullName} {isSelf && (
                        <span className="ml-1 text-xs italic text-[var(--muted-foreground)]">
                          (you)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {m.email}
                    </td>
                    <td className="px-4 py-3">{m.roleName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[m.status] ?? ""}`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {formatDate(m.joinedAt)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--muted-foreground)]">
                      {isExpanded ? "▾" : "▸"}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-[var(--muted)]/30">
                      <td colSpan={6} className="px-4 py-4">
                        {isSelf ? (
                          <p className="text-xs italic text-[var(--muted-foreground)]">
                            You cannot edit your own role or status.
                          </p>
                        ) : !canTouchOwner ? (
                          <p className="text-xs italic text-[var(--muted-foreground)]">
                            Only an Owner can edit another Owner.
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="text-xs font-medium text-[var(--muted-foreground)]">
                              Role
                              <select
                                className="ml-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                                defaultValue={m.roleId}
                                onChange={(e) =>
                                  patchMembership(m.userId, {
                                    roleId: e.target.value,
                                  })
                                }
                              >
                                {assignableRoles().map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                                {/* If target is currently Owner but actor isn't, show it disabled */}
                                {m.roleSlug === "owner" &&
                                  !actorIsOwner && (
                                    <option value={m.roleId} disabled>
                                      Owner (cannot change)
                                    </option>
                                  )}
                              </select>
                            </label>
                            {m.status === "active" && (
                              <button
                                type="button"
                                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)]"
                                onClick={() =>
                                  patchMembership(m.userId, {
                                    status: "suspended",
                                  })
                                }
                              >
                                Disable
                              </button>
                            )}
                            {m.status === "suspended" && (
                              <button
                                type="button"
                                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)]"
                                onClick={() =>
                                  patchMembership(m.userId, {
                                    status: "active",
                                  })
                                }
                              >
                                Enable
                              </button>
                            )}
                          </div>
                        )}
                        {rowError?.userId === m.userId && (
                          <p className="mt-2 text-xs text-red-600" role="alert">
                            {rowError.msg}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invitations */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">
          Pending invitations
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {invitations.length === 0
            ? "No invitations awaiting acceptance."
            : `${invitations.length} invitation${invitations.length === 1 ? "" : "s"} awaiting acceptance.`}
        </p>
        {invitations.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Invited by</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[var(--muted)]/50">
                    <td className="px-4 py-3 font-medium">{inv.email}</td>
                    <td className="px-4 py-3">{inv.roleName}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {inv.invitedByName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {formatDate(inv.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => revokeInvitation(inv.id)}
                        className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {inviteOpen && (
        <InviteModal
          roles={assignableRoles()}
          onClose={() => setInviteOpen(false)}
          onCreated={() => {
            setInviteOpen(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function InviteModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: Role[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(
    roles.find((r) => r.slug === "member")?.id ?? roles[0]?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Request failed (${res.status})`);
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[var(--background)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight">Invite user</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Send a Clerk organisation invitation. The user will join when they
          accept and sign in.
        </p>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Role
            </label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email || !roleId}
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
