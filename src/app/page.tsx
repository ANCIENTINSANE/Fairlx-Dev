import { getCurrent } from "@/features/auth/queries";
import { getWorkspaces } from "@/features/workspaces/queries";
import { routes } from "@/lib/routes";
import { redirect } from "next/navigation";


export default async function Home() {
  const user = await getCurrent();

  if (user) {
    const workspaces = await getWorkspaces();

    if (workspaces.total === 0) {
      // Zero-workspace state handling
      const prefs = user.prefs || {};
      if (prefs.accountType === "ORG") {
        // ORG accounts: Can access dashboard without workspaces
        redirect("/welcome");
      } else {
        // PERSONAL accounts or no account type: Go through main onboarding flow
        redirect("/onboarding");
      }
    } else {
      redirect(routes.agentDashboard());
    }
  }

  redirect("/sign-in");
}
