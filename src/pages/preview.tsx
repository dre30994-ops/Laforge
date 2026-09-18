import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { SampleDashboardsBanner, SampleDashboardsGrid } from "@/components/SampleDashboards";
import { useI18n } from "@/components/LanguageProvider";

export default function PreviewPage() {
  const { t } = useI18n();
  return (
    <TerminalShell>
      <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <Link to="/pools" className="text-xs font-semibold text-lo hover:text-hi">
                {t("sample.live")}
              </Link>
              <h1 className="text-xl font-semibold tracking-tight text-hi mt-2">
                {t("sample.pageTitle")}
              </h1>
              <p className="label-term mt-1">
                {t("sample.pageSub")}
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
