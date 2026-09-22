import { createFileRoute } from "@tanstack/react-router";
import ReferralPage from "@/pages/referral";

export const Route = createFileRoute("/referral")({ component: ReferralPage });
