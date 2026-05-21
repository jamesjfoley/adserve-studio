"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MePermissionsResponse } from "../app/api/me/permissions/route";

type Track = "super_admin" | "tenant";

type LoadedState = {
  isLoading: false;
  error: null;
  track: Track;
  isSuperAdmin: boolean;
  role: string | null;
  roleName: string | null;
  permissions: string[];
  tenant: { id: string; name: string; status: string } | null;
};

type LoadingState = {
  isLoading: true;
  error: null;
  track: null;
  isSuperAdmin: false;
  role: null;
  roleName: null;
  permissions: [];
  tenant: null;
};

type ErrorState = {
  isLoading: false;
  error: string;
  track: null;
  isSuperAdmin: false;
  role: null;
  roleName: null;
  permissions: [];
  tenant: null;
};

type State = LoadedState | LoadingState | ErrorState;

type PermissionsValue = State & {
  hasPermission: (key: string) => boolean;
  refetch: () => Promise<void>;
};

const initial: LoadingState = {
  isLoading: true,
  error: null,
  track: null,
  isSuperAdmin: false,
  role: null,
  roleName: null,
  permissions: [],
  tenant: null,
};

const PermissionsContext = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/me/permissions", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.status === 401) {
        // Not signed in — treat like a tenant user with nothing.
        setState({
          isLoading: false,
          error: null,
          track: "tenant",
          isSuperAdmin: false,
          role: null,
          roleName: null,
          permissions: [],
          tenant: null,
        });
        return;
      }
      if (!res.ok) {
        setState({
          ...initial,
          isLoading: false,
          error: `Failed to load permissions (${res.status})`,
        });
        return;
      }
      const body = (await res.json()) as MePermissionsResponse;
      if (body.track === "super_admin") {
        setState({
          isLoading: false,
          error: null,
          track: "super_admin",
          isSuperAdmin: true,
          role: null,
          roleName: null,
          permissions: [],
          tenant: null,
        });
      } else {
        setState({
          isLoading: false,
          error: null,
          track: "tenant",
          isSuperAdmin: false,
          role: body.role,
          roleName: body.roleName,
          permissions: body.permissions,
          tenant: body.tenant,
        });
      }
    } catch (e) {
      setState({
        ...initial,
        isLoading: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  const value = useMemo<PermissionsValue>(() => {
    const permSet = new Set(state.permissions);
    return {
      ...state,
      hasPermission: (key: string) => permSet.has(key),
      refetch: fetchPermissions,
    };
  }, [state, fetchPermissions]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error(
      "usePermissions must be used inside a <PermissionsProvider>."
    );
  }
  return ctx;
}

/**
 * Client-side gate. Renders children if the current user has the named
 * permission, otherwise renders the optional fallback (default: nothing).
 * While permissions are loading, renders nothing.
 *
 * Super admins never satisfy tenant-scoped permission checks (track =
 * "super_admin" exposes permissions: []), matching the role-separation
 * model. Use `isSuperAdmin` from usePermissions() to gate super-admin UI.
 */
export function PermissionGate({
  permission,
  fallback = null,
  children,
}: {
  permission: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { hasPermission, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!hasPermission(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
