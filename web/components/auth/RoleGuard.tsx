"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAuthStatus } from "@/lib/auth";

/**
 * Blocks a route's content unless the signed-in account's role is in
 * `allow`. When auth is disabled (solo/local use, no real accounts), every
 * request is treated as admin server-side, so nothing is blocked here
 * either — role-gating only makes sense once accounts are real.
 */
export function RoleGuard({
  allow,
  redirectTo = "/",
  children,
}: {
  allow: ("admin" | "instructor" | "user")[];
  redirectTo?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.enabled || (status.role && allow.includes(status.role as "admin" | "instructor" | "user"))) {
        setAllowed(true);
        return;
      }
      router.replace(redirectTo);
    });
    // `allow` is a small literal array at each call site; re-running on every
    // render would be harmless but pointless — only re-check on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, redirectTo]);

  if (!allowed) return null;
  return <>{children}</>;
}
