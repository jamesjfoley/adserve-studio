import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSuperAdminOrNull } from "@/lib/super-admin";
import { getTenantContextOrNull } from "@/lib/permissions";

export type MePermissionsResponse =
  | {
      track: "super_admin";
      isSuperAdmin: true;
      role: null;
      roleName: null;
      permissions: [];
      tenant: null;
    }
  | {
      track: "tenant";
      isSuperAdmin: false;
      role: string | null;
      roleName: string | null;
      permissions: string[];
      tenant: { id: string; name: string; status: string } | null;
    };

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, {
      status: 401,
      headers: NO_STORE,
    });
  }

  // Track 1: super admin (platform)
  const superAdmin = await getSuperAdminOrNull();
  if (superAdmin) {
    const body: MePermissionsResponse = {
      track: "super_admin",
      isSuperAdmin: true,
      role: null,
      roleName: null,
      permissions: [],
      tenant: null,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  }

  // Track 2: tenant user (may or may not have an active membership)
  const ctx = await getTenantContextOrNull();
  if (!ctx) {
    const body: MePermissionsResponse = {
      track: "tenant",
      isSuperAdmin: false,
      role: null,
      roleName: null,
      permissions: [],
      tenant: null,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  }

  const body: MePermissionsResponse = {
    track: "tenant",
    isSuperAdmin: false,
    role: ctx.role.slug,
    roleName: ctx.role.name,
    permissions: Array.from(ctx.permissions).sort(),
    tenant: {
      id: ctx.tenant.id,
      name: ctx.tenant.name,
      status: ctx.tenant.status,
    },
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
