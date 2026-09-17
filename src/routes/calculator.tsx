import { createFileRoute } from "@tanstack/react-router";
import CalculatorPage from "@/pages/calculator";

export const Route = createFileRoute("/calculator")({ component: CalculatorPage });
