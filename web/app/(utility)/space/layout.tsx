// Learning Space is an admin/instructor workspace: the RoleGuard here
// blocks direct URL access (and every sub-route — /space/notebooks,
// /space/cli-apps, etc.) for students, redirecting them to "/".
// Instructors are allowed (issue #56). Auth-disabled deployments are
// unaffected.
import { RoleGuard } from "@/components/auth/RoleGuard";
import SpaceMain from "@/components/space/SpaceMain";

export default function SpaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RoleGuard allow={["admin", "instructor"]} redirectTo="/">
      <SpaceMain>{children}</SpaceMain>
    </RoleGuard>
  );
}
