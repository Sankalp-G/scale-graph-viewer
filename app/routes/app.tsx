import BackgroundMap from "~/welcome/components/background-map";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Graph Pipeline viewer" },
    { name: "description", content: "Graph Pipeline viewer" },
  ];
}

export default function App() {
  return (
    <main className="flex items-center justify-center text-black bg-transparent">
        <BackgroundMap />
    </main>
  );
}
