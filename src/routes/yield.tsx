import { createFileRoute } from "@tanstack/react-router";
import YieldPage from "@/pages/yield";

export const Route = createFileRoute("/yield")({ component: YieldPage });
