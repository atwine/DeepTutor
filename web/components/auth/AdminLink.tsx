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
  const { enabled, isAdmin, isInstructor } = useAuthStatus();

  if (!enabled || (!isAdmin && !isInstructor)) return null;

  // Admins land on user management (their primary admin surface, with a
  // cross-link to Course Units from there); instructors have no access to
  // user management, so their sidebar entry goes straight to the units
  // they teach.
  //
  // Labeled "Accounts Management" rather than "Admin" — with a separate
  // admin-only "Settings" nav item already in the sidebar, a plain "Admin"
  // label here read as a duplicate/ambiguous destination.
  const href = isAdmin ? "/admin/users" : "/admin/course-units";
  const label = isAdmin ? t("Accounts Management") : t("Course Units");
  const title = isAdmin ? t("Manage registered accounts") : t("Course units you teach");
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
