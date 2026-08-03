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

  // Account management moved under the Settings hub (issue #9), so admins
  // no longer get a standalone sidebar entry here — this footer link is
  // instructor-only, pointing them at the course units they teach (which
  // they have no other sidebar entry for).
  if (!enabled || isAdmin || !isInstructor) return null;

  const href = "/admin/course-units";
  const label = t("Course Units");
  const title = t("Course units you teach");
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
