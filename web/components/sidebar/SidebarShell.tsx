"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAppShell } from "@/context/AppShellContext";
import {
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  ClipboardList,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  House,
  LayoutGrid,
  Library,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SessionList from "@/components/SessionList";
import { NotificationBell } from "@/components/sidebar/NotificationBell";
import { useSidebarDrawer } from "@/components/layout/AppShell";
import { useDevice } from "@/hooks/useDevice";
import type { SessionSummary } from "@/lib/session-api";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCapabilityAccess } from "@/components/access/CapabilityAccessContext";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import type { Capability } from "@/lib/capability-routes";

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltipKey?: string;
  /** Model capability this feature needs; locked when the user lacks it. */
  requires?: Capability;
  /** Roles that can see this item at all. Omit to show to every role
   * (including a signed-out/auth-disabled deployment). */
  roles?: ("admin" | "instructor" | "user")[];
  /** When true the item is always visible but rendered in a locked state
   * (greyed out, padlock, non-clickable) for anyone who isn't an admin —
   * students and instructors see the feature exists but can't open it.
   * Ignored when auth is disabled (solo/local use, where the single user
   * is effectively the admin). */
  adminOnly?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  {
    href: "/home",
    label: "Home",
    icon: House,
    tooltipKey: "Home tooltip",
    requires: "llm",
  },
  {
    // Pulled out of the footer (was its own CoursesLink component) so its
    // position in the nav is set by array order like everything else, and
    // stays identical for every role — un-gated on ``roles``, same as before.
    href: "/courses",
    label: "Browse Courses",
    icon: GraduationCap,
    tooltipKey: "Courses tooltip",
  },
  {
    // Instructors manage the course units they teach from here. Labeled
    // "My Course Units" to distinguish it from the admin's global catalog
    // and placed directly below "Browse Courses" so an instructor's own
    // units sit right under the catalog. The route is unchanged — only the
    // label and ordering differ. Admins have their own "Course Units" entry
    // below (global catalog administration, not "my" units).
    href: "/admin/course-units",
    label: "My Course Units",
    icon: ClipboardList,
    tooltipKey: "My Course Units tooltip",
    roles: ["instructor"],
  },
  {
    // Instructor's student dashboard (issue #34): bird's-eye view of
    // students enrolled in the instructor's own courses — enrollment
    // counts, course names, submission counts, and completion status.
    // Searchable and filterable. Placed right after "My Course Units"
    // so course-related instructor tools stay grouped. Reuses the same
    // table component as the admin dashboard (#33).
    href: "/instructor/students",
    label: "My Students",
    icon: Users,
    tooltipKey: "My Students tooltip",
    roles: ["instructor"],
  },
  {
    // Admin's global course catalog administration: create course units,
    // assign instructors, manage rosters, archive/delete old units. Labeled
    // "Course Units" (not "My Course Units" — the admin doesn't teach any)
    // and placed right after the instructor's entry so course-related nav
    // items stay grouped. The two entries are mutually exclusive (a user
    // has one role), so there's no visual conflict.
    href: "/admin/course-units",
    label: "Course Units",
    icon: ClipboardList,
    tooltipKey: "Course Units tooltip",
    roles: ["admin"],
  },
  {
    // Admin's student dashboard (issue #33): bird's-eye view of all
    // students with enrollment counts, course names, submission counts,
    // and completion status. Searchable and filterable. Placed right
    // after "Course Units" so course-related admin tools stay grouped.
    href: "/admin/students",
    label: "Student Dashboard",
    icon: Users,
    tooltipKey: "Student Dashboard tooltip",
    roles: ["admin"],
  },
  {
    href: "/partners",
    label: "Partners",
    icon: HeartHandshake,
    tooltipKey: "Partners tooltip",
    requires: "llm",
    // Admin-only feature: shown to everyone but locked (greyed + padlock,
    // non-clickable) for students and instructors. Direct URL access is
    // blocked by the partners route RoleGuard.
    adminOnly: true,
  },
  {
    // My Agents is its own top-level feature (pulled out of the Learning
    // Space): connect a live local Claude Code / Codex to consult in chat,
    // and manage imported agent conversations. Ungated on model capability —
    // managing connections and imports needs no per-user model grant — but
    // it's a developer-facing feature (its own config page under
    // /settings/agents is already admin-only), so it's admin-only: shown to
    // every role but locked (greyed + padlock, non-clickable) for students
    // and instructors. Direct URL access is blocked by the agents route
    // RoleGuard.
    href: "/agents",
    label: "My Agents",
    icon: Bot,
    tooltipKey: "Agents tooltip",
    adminOnly: true,
  },
  {
    href: "/co-writer",
    label: "Co-Writer",
    icon: PenLine,
    tooltipKey: "Co-Writer tooltip",
    requires: "llm",
  },
  {
    href: "/book",
    label: "Book",
    icon: Library,
    tooltipKey: "Book tooltip",
    requires: "llm",
  },
  {
    href: "/space",
    label: "Learning Space",
    icon: LayoutGrid,
    tooltipKey: "Space tooltip",
  },
];

const SECONDARY_NAV: NavEntry[] = [
  {
    // Knowledge Center and Memory sit directly below Learning Space (the
    // last PRIMARY_NAV entry) — both are consoles for the tutor's
    // knowledge/memory stores rather than daily workspaces, so they're
    // grouped together right after it. Ungated on model capability, but
    // creating/deleting KBs and connecting a LightRAG server is
    // admin-level system configuration — admin-only: shown to every role
    // but locked (greyed + padlock, non-clickable) for students and
    // instructors. Direct URL access is blocked by the knowledge route
    // RoleGuard.
    href: "/knowledge",
    label: "Knowledge Center",
    icon: BookOpen,
    tooltipKey: "Knowledge tooltip",
    adminOnly: true,
  },
  {
    // Memory is its own top-level console (pulled out of the Learning Space):
    // a place to inspect and curate the tutor's long-term memory, not a daily
    // workspace. Never gated on model capability, but it's admin-only: shown
    // to every role but locked (greyed + padlock, non-clickable) for students
    // and instructors. Direct URL access is blocked by the memory route
    // RoleGuard.
    href: "/memory",
    label: "Memory",
    icon: Brain,
    tooltipKey: "Memory tooltip",
    adminOnly: true,
  },
  {
    // A plain-language guide to the whole platform, for every role — the
    // options here can be a lot for a first-time user, so this is the
    // "how do I..." reference to point people at. Never gated: it has no
    // model requirement and nothing here is role-sensitive information.
    href: "/docs",
    label: "Docs",
    icon: HelpCircle,
    tooltipKey: "Docs tooltip",
  },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];
const RECENTS_COLLAPSED_KEY = "deeptutor.sidebar.recentsCollapsed";

interface SidebarShellProps {
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  loadingSessions?: boolean;
  showSessions?: boolean;
  /** Clicking the Chat nav item resets to a fresh session via this handler. */
  onNewChat?: () => void;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /**
   * Footer content rendered below the nav. Pass a render function to receive
   * the current ``collapsed`` state so footer items (e.g. Admin / Sign out) can
   * switch to their icon-only variant when the rail is collapsed.
   */
  footerSlot?: ReactNode | ((collapsed: boolean) => ReactNode);
}

export function SidebarShell({
  sessions = [],
  activeSessionId = null,
  loadingSessions = false,
  showSessions = false,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  footerSlot,
}: SidebarShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { has } = useCapabilityAccess();
  const { sidebarCollapsed, setSidebarCollapsed: setCollapsed } = useAppShell();
  const { isMobile } = useDevice();
  const drawer = useSidebarDrawer();
  const { enabled: authEnabled, role } = useAuthStatus();

  // Auth disabled (solo/local use, no real accounts) — the single user is
  // effectively the admin, so role-gated items are shown only if the admin
  // role would see them (e.g. "Course Units" yes, "My Course Units" no).
  // With auth enabled, hide a role-gated item until the role is actually
  // known (mirrors AdminLink, which likewise renders nothing until resolved)
  // rather than flashing it and then pulling it away.
  const visibleForRole = (item: NavEntry) => {
    if (!item.roles) return true;
    if (!authEnabled) return item.roles.includes("admin");
    if (!role) return false;
    return item.roles.includes(role as "admin" | "instructor" | "user");
  };
  const visiblePrimaryNav = PRIMARY_NAV.filter(visibleForRole);
  const visibleSecondaryNav = SECONDARY_NAV.filter(visibleForRole);

  // Inside the mobile drawer the icon-only rail is pointless — the panel is
  // already hidden when you don't want it, so it always opens fully expanded
  // regardless of the persisted desktop preference.
  const collapsed = sidebarCollapsed && !isMobile;

  /** Dismiss the drawer on nav clicks that actually navigate in-place. */
  const closeDrawerOnNav = (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
      return;
    drawer?.close();
  };

  // adminOnly items are locked (greyed + padlock, non-clickable) for anyone
  // who isn't an admin. Auth-disabled deployments never lock — the single
  // user is effectively the admin. While the role is still resolving (auth
  // on, role unknown) we render locked too, so a non-admin never sees a
  // clickable item flash before the lock applies.
  const roleLocked = (item: NavEntry) => {
    if (!item.adminOnly) return false;
    if (!authEnabled) return false;
    return role !== "admin";
  };
  const navLocked = (item: NavEntry) =>
    (item.requires ? !has(item.requires) : false) || roleLocked(item);
  const lockedTooltip = t("Locked — contact your administrator to get access.");
  const renderedFooter =
    typeof footerSlot === "function" ? footerSlot(collapsed) : footerSlot;
  const [recentsCollapsed, setRecentsCollapsed] = useState(false);

  // Hydrate Recents collapse from localStorage after first render to stay SSR-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentsCollapsed(
      window.localStorage.getItem(RECENTS_COLLAPSED_KEY) === "1",
    );
  }, []);

  const toggleRecents = () => {
    setRecentsCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENTS_COLLAPSED_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const handleHomeClick = (event: React.MouseEvent) => {
    // Always reset to a fresh session (mirrors the old "New Chat" affordance);
    // let modifier-clicks fall through to default Link behavior so middle-click
    // open-in-new-tab still works.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
      return;
    event.preventDefault();
    drawer?.close();
    onNewChat?.();
    router.push("/home");
  };

  /* ---- Collapsed state ---- */
  if (collapsed) {
    return (
      <aside className="group/sb relative flex h-dvh w-[60px] shrink-0 flex-col items-center bg-[var(--secondary)] py-3 transition-all duration-200">
        {/* Header: logo + collapse toggle (toggle replaces logo on hover) */}
        <div className="relative mb-2 flex h-9 w-9 items-center justify-center">
          <Link
            href="/"
            aria-label="DeepTutor"
            className="flex items-center justify-center transition-opacity duration-150 group-hover/sb:opacity-0"
          >
            <Image
              src="/logo.png"
              alt="DeepTutor"
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-md"
            />
          </Link>
          <button
            onClick={() => setCollapsed(false)}
            className="absolute inset-0 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all duration-150 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] group-hover/sb:opacity-100"
            aria-label={t("Expand sidebar")}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>

        <NotificationBell />

        {/* Primary nav */}
        <nav className="mt-1 flex w-full flex-col items-center gap-1 px-1.5">
          {visiblePrimaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = navLocked(item);
            const description = locked
              ? lockedTooltip
              : item.tooltipKey
                ? t(item.tooltipKey)
                : undefined;
            if (locked) {
              return (
                <Tooltip
                  key={item.label}
                  label={t(item.label)}
                  description={description}
                  side="right"
                >
                  <div
                    aria-label={`${t(item.label)} — ${lockedTooltip}`}
                    aria-disabled
                    className="relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl text-[var(--muted-foreground)]/40"
                  >
                    <item.icon size={18} strokeWidth={1.6} />
                    <Lock
                      size={10}
                      strokeWidth={2}
                      className="absolute bottom-1 right-1 text-[var(--muted-foreground)]/70"
                    />
                  </div>
                </Tooltip>
              );
            }
            return (
              <Tooltip
                key={item.label}
                label={t(item.label)}
                description={description}
                side="right"
              >
                <Link
                  href={item.href}
                  onClick={item.href === "/home" ? handleHomeClick : undefined}
                  aria-label={t(item.label)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                    active
                      ? "bg-[var(--accent)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                  }`}
                >
                  <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Secondary nav + footer */}
        <div className="flex w-full flex-col items-center gap-1 px-1.5">
          <div className="my-1 h-px w-7 bg-[var(--border)]/40" />
          {visibleSecondaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = navLocked(item);
            // Locked secondary items mirror the locked primary rendering:
            // greyed icon + padlock badge, wrapped in a non-interactive div
            // (no Link) so they can't be clicked.
            if (locked) {
              return (
                <Tooltip
                  key={item.label}
                  label={t(item.label)}
                  description={lockedTooltip}
                  side="right"
                >
                  <div
                    aria-label={`${t(item.label)} — ${lockedTooltip}`}
                    aria-disabled
                    className="relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl text-[var(--muted-foreground)]/40"
                  >
                    <item.icon size={18} strokeWidth={1.6} />
                    <Lock
                      size={10}
                      strokeWidth={2}
                      className="absolute bottom-1 right-1 text-[var(--muted-foreground)]/70"
                    />
                  </div>
                </Tooltip>
              );
            }
            return (
              <Link
                key={item.label}
                href={item.href}
                title={t(item.label) as string}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  active
                    ? "bg-[var(--accent)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
              </Link>
            );
          })}
          {renderedFooter}
        </div>
      </aside>
    );
  }

  /* ---- Expanded state ---- */
  return (
    <aside className="flex w-[220px] h-dvh shrink-0 flex-col bg-[var(--secondary)] transition-all duration-200">
      {/* Header: logo + collapse toggle */}
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="group flex items-center gap-1.5">
          <Image
            src="/logo.png"
            alt="DeepTutor"
            width={22}
            height={22}
            className="h-[22px] w-[22px] transition-transform duration-200 group-hover:scale-105"
          />
          <Image
            src="/banner.png"
            alt="DeepTutor"
            width={897}
            height={236}
            priority
            className="h-[22px] w-auto transition-transform duration-200 group-hover:scale-105"
          />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          {/* The rail is a desktop affordance; in the drawer the scrim and the
              top-bar toggle already own "make this go away". */}
          <button
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] max-md:hidden"
            aria-label={t("Collapse sidebar")}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="px-2 pt-1">
        <div className="space-y-px">
          {visiblePrimaryNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const locked = navLocked(item);
            if (locked) {
              return (
                <Tooltip
                  key={item.label}
                  label={t(item.label)}
                  description={lockedTooltip}
                  side="right"
                >
                  <div
                    aria-label={`${t(item.label)} — ${lockedTooltip}`}
                    aria-disabled
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)]/40"
                  >
                    <item.icon size={16} strokeWidth={1.5} />
                    <span>{t(item.label)}</span>
                    <Lock size={13} strokeWidth={1.8} className="ml-auto" />
                  </div>
                </Tooltip>
              );
            }
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={
                  item.href === "/home" ? handleHomeClick : closeDrawerOnNav
                }
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  active
                    ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
                    : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                <span>{t(item.label)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Chat history — its own region below the nav, takes remaining height */}
      {showSessions && onSelectSession && onRenameSession && onDeleteSession ? (
        <section
          className={`mt-4 flex min-h-0 flex-col ${
            recentsCollapsed ? "" : "flex-1"
          }`}
        >
          <button
            type="button"
            onClick={toggleRecents}
            className="group/recents mx-2 flex items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] font-normal text-[var(--muted-foreground)]/60 transition-colors hover:bg-[var(--background)]/40 hover:text-[var(--muted-foreground)]"
            aria-expanded={!recentsCollapsed}
            aria-label={
              recentsCollapsed
                ? (t("Show recents") as string)
                : (t("Hide recents") as string)
            }
          >
            <span>{t("Recents")}</span>
            <ChevronDown
              size={13}
              strokeWidth={1.7}
              className={`transition-all duration-200 ${
                recentsCollapsed
                  ? "-rotate-90 opacity-60"
                  : "rotate-0 opacity-0 group-hover/recents:opacity-60"
              }`}
            />
          </button>
          {!recentsCollapsed && (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                loading={loadingSessions}
                onSelect={(sessionId) => {
                  drawer?.close();
                  return onSelectSession(sessionId);
                }}
                onRename={onRenameSession}
                onDelete={onDeleteSession}
                compact
              />
            </div>
          )}
        </section>
      ) : null}

      {/* When recents is collapsed or unavailable, fill the gap above the footer. */}
      {(!showSessions ||
        !onSelectSession ||
        !onRenameSession ||
        !onDeleteSession ||
        recentsCollapsed) && <div className="flex-1" />}

      {/* Secondary nav + footer */}
      <div className="border-t border-[var(--border)]/40 px-2 py-2">
        {visibleSecondaryNav.map((item) => {
          const active = pathname.startsWith(item.href);
          const locked = navLocked(item);
          // Locked secondary items mirror the locked primary rendering:
          // greyed label + padlock, wrapped in a non-interactive div (no
          // Link) so they can't be clicked.
          if (locked) {
            return (
              <Tooltip
                key={item.label}
                label={t(item.label)}
                description={lockedTooltip}
                side="right"
              >
                <div
                  aria-label={`${t(item.label)} — ${lockedTooltip}`}
                  aria-disabled
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-[var(--muted-foreground)]/40"
                >
                  <item.icon size={16} strokeWidth={1.5} />
                  <span>{t(item.label)}</span>
                  <Lock size={13} strokeWidth={1.8} className="ml-auto" />
                </div>
              </Tooltip>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={closeDrawerOnNav}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                active
                  ? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
                  : "text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
              }`}
            >
              <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
        {renderedFooter}
      </div>
    </aside>
  );
}
