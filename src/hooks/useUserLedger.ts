import { useEffect, useState } from "react";
import { loadOnchainAccount, mergeActivity, mergeStakes } from "@/lib/accountHistory";
import {
  LEDGER_EVENT,
  listActivity,
  listUserStakes,
  type ActivityItem,
  type UserStake,
} from "@/lib/userLedger";

export function useUserLedger(address: string | undefined | null) {
  const [activity, setActivity] = useState<ActivityItem[]>(() => listActivity(address));
  const [stakes, setStakes] = useState<UserStake[]>(() => listUserStakes(address));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const localActivity = listActivity(address);
      const localStakes = listUserStakes(address);
      if (!address) {
        if (!cancelled) {
          setActivity([]);
          setStakes([]);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setActivity(localActivity);
        setStakes(localStakes);
        setLoading(true);
      }
      try {
        const chain = await loadOnchainAccount(address);
        if (cancelled) return;
        setActivity(mergeActivity(chain.activity, listActivity(address)));
        setStakes(mergeStakes(chain.stakes, listUserStakes(address)));
      } catch {
        if (!cancelled) {
          setActivity(listActivity(address));
          setStakes(listUserStakes(address));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(LEDGER_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LEDGER_EVENT, refresh);
    };
  }, [address]);

  return { activity, stakes, loading };
}
