"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/hooks/useAuthStatus";

interface CoursesLinkProps {
  collapsed?: boolean;
}

/**
 * Any signed-in account's way to the course catalog — browse course units
 * and request enrollment. Distinct from AdminLink (admin/instructor
 * management surfaces): this is the student-facing entry point, but shown
 * to every role since an instructor or admin may also want to check it.
 */
export function CoursesLink({ collapsed = false }: CoursesLinkProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { enabled, authenticated } = useAuthStatus();

  if (!enabled || !authenticated) return null;

  const active = pathname.startsWith("/courses");

  if (collapsed) {
    return (
      <Link
        href="/courses"
        className={`rounded-lg p-2 transition-colors
          ${
            active
              ? "bg-[var(--primary)]/10 text-[var(--primary)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
          }`}
        aria-label={t("Browse Courses")}
        title={t("Browse and request course units")}
      >
        <BookOpen size={16} strokeWidth={1.5} />
      </Link>
    );
  }

  return (
    <Link
      href="/courses"
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors
        ${
          active
            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]"
        }`}
      title={t("Browse and request course units")}
    >
      <BookOpen size={16} strokeWidth={1.5} />
      <span>{t("Browse Courses")}</span>
    </Link>
  );
}
