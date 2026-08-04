// Book is admin-only: the RoleGuard here blocks direct URL access (and
// every sub-route) for students and instructors, redirecting them to "/".
// Matches the partners layout pattern. Auth-disabled deployments are
// unaffected (treated as admin server-side).
import { RoleGuard } from "@/components/auth/RoleGuard";

export default function BookLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RoleGuard allow={["admin"]} redirectTo="/">{children}</RoleGuard>;
}
