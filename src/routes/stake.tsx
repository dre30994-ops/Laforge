import { createFileRoute } from "@tanstack/react-router";
import StakePage from "@/pages/stake";

export const Route = createFileRoute("/stake")({ component: StakePage });
