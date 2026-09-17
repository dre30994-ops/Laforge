import { createFileRoute } from "@tanstack/react-router";
import FaqsPage from "@/pages/faqs";

export const Route = createFileRoute("/faqs")({ component: FaqsPage });
