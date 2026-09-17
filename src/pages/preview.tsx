import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { SampleDashboardsBanner, SampleDashboardsGrid } from "@/components/SampleDashboards";

export default function PreviewPage() {
  return (
    <TerminalShell>
      <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Link to="/pools" className="text-xs font-semibold text-lo hover:text-hi">
                ← Live pools
              </Link>
              <h1 className="text-xl font-semibold tracking-tight text-hi mt-2">
                Sample pool dashboards
              </h1>
              <p className="label-term mt-1">
                Bronze, Ecosystem, and Marketing — sample data only
              </p>
            </div>
            <CreatePoolButton />
          </div>

          <SampleDashboardsBanner />

          <SampleDashboardsGrid />
        </div>
      </main>
    </TerminalShell>
  );
}
