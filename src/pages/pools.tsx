import { TerminalShell } from "@/components/TerminalShell";
import { PoolDirectory } from "@/components/PoolDirectory";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { ChainSwitch } from "@/components/ChainSwitch";
import { useI18n } from "@/components/LanguageProvider";

export default function PoolsPage() {
  const { t } = useI18n();
  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1600px] mx-auto space-y-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-hi">{t("poolsPage.title")}</h1>
                <p className="label-term mt-1" data-testid="protocol-tvl-caption">
                  {t("poolsPage.caption")}
                </p>
              </div>
              <CreatePoolButton />
            </div>
            <div className="lg:hidden">
              <ChainSwitch compact />
            </div>
            <PoolDirectory limit={null} showAllLink={false} />
          </div>
        </main>
    </TerminalShell>
  );
}
