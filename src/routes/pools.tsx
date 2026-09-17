import { createFileRoute } from "@tanstack/react-router";
import PoolsPage from "@/pages/pools";

export const Route = createFileRoute("/pools")({ component: PoolsPage });
