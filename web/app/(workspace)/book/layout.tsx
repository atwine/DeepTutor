// Book is an admin/instructor feature: the RoleGuard here blocks direct
// URL access (and every sub-route) for students, redirecting them to "/".
// Instructors are allowed (issue #56 — Book is how instructors compile
// course notes). Auth-disabled deployments are unaffected (treated as
// admin server-side).
import { RoleGuard } from "@/components/auth/RoleGuard";

export default function BookLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RoleGuard allow={["admin", "instructor"]} redirectTo="/">{children}</RoleGuard>;
}
