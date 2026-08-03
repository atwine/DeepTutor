"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/hooks/useAuthStatus";

interface AdminLinkProps {
  collapsed?: boolean;
}

export function AdminLink({ collapsed = false }: AdminLinkProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { enabled, isAdmin } = useAuthStatus();

  if (!enabled || !isAdmin) return null;

  // Instructors now get their own "My Course Units" entry in the primary
  // nav (placed directly below "Browse Courses"), so this footer link is
  // admin-only — avoids a duplicate entry for instructors. Admins land on
  // user management (their primary admin surface, with a cross-link to the
  // global Course Units catalog from there).
  //
  // Labeled "Accounts Management" rather than "Admin" — with a separate
  // admin-only "Settings" nav item already in the sidebar, a plain "Admin"
  // label here read as a duplicate/ambiguous destination.
  const href = "/admin/users";
  const label = t("Accounts Management");
  const title = t("Manage registered accounts");
  const active = pathname.startsWith(href);

  if (collapsed) {
    return (
      <Link
        href={href}
        className={`rounded-lg p-2 transition-colors
          ${
            active
              ? "bg-[var(--primary)]/10 text-[var(--primary)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
          }`}
        aria-label={label}
        title={title}
      >
        <ShieldCheck size={16} strokeWidth={1.5} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors
        ${
          active
            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
        }`}
    >
      <ShieldCheck size={16} strokeWidth={1.5} />
      <span>{label}</span>
    </Link>
  );
}
