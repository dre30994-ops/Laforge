import { useEffect, useState } from "react";
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

  useEffect(() => {
    const refresh = () => {
      setActivity(listActivity(address));
      setStakes(listUserStakes(address));
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(LEDGER_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LEDGER_EVENT, refresh);
    };
  }, [address]);

  return { activity, stakes };
}
