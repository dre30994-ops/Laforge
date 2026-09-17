import { createFileRoute } from "@tanstack/react-router";
import DocsPage from "@/pages/docs";

export const Route = createFileRoute("/docs")({ component: DocsPage });
