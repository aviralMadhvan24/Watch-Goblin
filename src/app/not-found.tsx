import Link from "next/link";

import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center">
      <span aria-hidden className="text-5xl">
        {brand.mascot}
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
        This page does not exist
      </h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        Unlike your backlog, which very much does.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/discover">Browse shows</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
