import {
  LayoutDashboard,
  Building2,
  Users,
  UserPlus,
  TrendingUp,
  KanbanSquare,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * WS5 — icon registry for the collapsible CRM nav.
 *
 * Functions (React component types) cannot cross the server/client boundary as
 * props, so the server shell passes serializable `iconName` strings and this
 * client-side registry resolves them to lucide components. Keep the union in
 * sync with the keys below.
 */
export type NavIconName =
  | "dashboard"
  | "accounts"
  | "contacts"
  | "leads"
  | "opportunities"
  | "pipeline"
  | "shield";

export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  accounts: Building2,
  contacts: Users,
  leads: UserPlus,
  opportunities: TrendingUp,
  pipeline: KanbanSquare,
  shield: Shield,
};
