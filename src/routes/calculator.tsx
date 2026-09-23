import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/calculator")({
  beforeLoad: () => {
    throw redirect({ to: "/yield" });
  },
});
