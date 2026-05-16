import {
  db,
  users,
  tenantMemberships,
  tenants,
} from "@adserve/database";
import { desc, eq, ilike, inArray, or } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/super-admin";
import { UserActions } from "./_components/user-actions";

const statusStyles: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  invited: "bg-amber-100 text-amber-800",
  disabled: "bg-gray-200 text-gray-700",
};

type SearchParams = Promise<{ q?: string }>;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const self = await requireSuperAdmin();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const where =
    query.length > 0
      ? or(
          ilike(users.email, `%${query}%`),
          ilike(users.fullName, `%${query}%`)
        )
      : undefined;

  const userRows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt));

  const userIds = userRows.map((u) => u.id);

  const memberships =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: tenantMemberships.userId,
            tenantId: tenants.id,
            tenantName: tenants.name,
            tenantSlug: tenants.slug,
          })
          .from(tenantMemberships)
          .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
          .where(inArray(tenantMemberships.userId, userIds));

  type Membership = (typeof memberships)[number];
  const byUser = new Map<string, Membership[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push(m);
    byUser.set(m.userId, list);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            {userRows.length} user{userRows.length === 1 ? "" : "s"}
            {query && (
              <>
                {" "}
                matching{" "}
                <span className="font-mono text-xs">
                  {`"${query}"`}
                </span>
              </>
            )}
            .
          </p>
        </div>
        <form className="flex items-center gap-2" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name or email"
            className="w-64 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Search
          </button>
          {query && (
            <a
              href="/super-admin/users"
              className="text-xs text-[var(--muted-foreground)] hover:underline"
            >
              Clear
            </a>
          )}
        </form>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Super admin</th>
              <th className="px-4 py-3 font-medium">Tenants</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {userRows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                >
                  {query ? "No users match." : "No users yet."}
                </td>
              </tr>
            )}
            {userRows.map((u) => {
              const memberOf = byUser.get(u.id) ?? [];
              const isSelf = u.id === self.id;
              return (
                <tr key={u.id} className="hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-3 font-medium">{u.fullName}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        statusStyles[u.status] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isSuperAdmin ? (
                      <span className="inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {memberOf.length === 0
                      ? "—"
                      : memberOf.map((m) => m.tenantName).join(", ")}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {new Date(u.createdAt).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3">
                    <UserActions
                      userId={u.id}
                      status={u.status}
                      isSuperAdmin={u.isSuperAdmin}
                      isSelf={isSelf}
                    />
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
