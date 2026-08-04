// Partners is admin-only: the RoleGuard here blocks direct URL access (and
// every sub-route — /partners/new, /partners/[partnerId]) for students and
// instructors, redirecting them to "/". Auth-disabled deployments are
// unaffected (treated as admin server-side). Matches the settings layout
// pattern, which guards its whole route tree the same way.
import { RoleGuard } from "@/components/auth/RoleGuard";

export default function PartnersLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RoleGuard allow={["admin"]} redirectTo="/">{children}</RoleGuard>;
}
