import { createFileRoute } from "@tanstack/react-router";
import PoolDashboardPage from "@/pages/pool";

export const Route = createFileRoute("/pool/$chainId/$address")({
  component: PoolDashboardPage,
});
