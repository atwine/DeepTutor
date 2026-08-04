// Learning Space is admin-only: the RoleGuard here blocks direct URL
// access (and every sub-route — /space/notebooks, /space/cli-apps, etc.)
// for students and instructors, redirecting them to "/". Matches the
// partners layout pattern. Auth-disabled deployments are unaffected.
import { RoleGuard } from "@/components/auth/RoleGuard";
import SpaceMain from "@/components/space/SpaceMain";

export default function SpaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RoleGuard allow={["admin"]} redirectTo="/">
      <SpaceMain>{children}</SpaceMain>
    </RoleGuard>
  );
}
