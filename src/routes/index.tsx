import { createFileRoute } from "@tanstack/react-router";
import HomePage from "@/pages/index";

/** `/` is the cinematic landing — this is the first page Vercel serves. */
export const Route = createFileRoute("/")({ component: HomePage });
