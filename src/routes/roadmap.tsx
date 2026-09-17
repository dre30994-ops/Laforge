import { createFileRoute } from "@tanstack/react-router";
import RoadmapPage from "@/pages/roadmap";

export const Route = createFileRoute("/roadmap")({ component: RoadmapPage });
