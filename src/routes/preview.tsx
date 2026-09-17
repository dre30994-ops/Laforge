import { createFileRoute } from "@tanstack/react-router";
import PreviewPage from "@/pages/preview";

export const Route = createFileRoute("/preview")({ component: PreviewPage });
