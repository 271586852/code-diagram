import MainCard from "~/components/main-card";
import Hero from "~/components/hero";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitDiagram - Visualize Local Code Folders",
  description:
    "Turn any local code folder into an interactive architecture diagram for quick codebase understanding.",
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100svh-8.5rem)] flex-col justify-center px-4 py-8 sm:block sm:min-h-0 sm:px-8 sm:pt-8 sm:pb-8 md:p-8">
      <div className="mx-auto mb-9 max-w-4xl sm:mb-4 lg:my-8">
        <Hero />
        <div className="mx-auto mt-7 max-w-[21rem] space-y-2 text-center text-base leading-7 text-[hsl(var(--neo-soft-text))] sm:mt-12 sm:max-w-2xl sm:text-lg sm:leading-normal">
          <p>
            Turn any local code folder into an interactive diagram for
            visualization.
          </p>
          <p className="hidden sm:block">
            Paste an absolute folder path and generate with your Kimi API key.
          </p>
        </div>
      </div>
      <div className="flex justify-center sm:mb-16 lg:mb-0">
        <MainCard />
      </div>
    </main>
  );
}
