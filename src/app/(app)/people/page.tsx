import type { Metadata } from "next";

import { PeopleList } from "@/app/(app)/people/people-list";
import { SimpleEmpty } from "@/components/shared/empty-state";
import { requireSession } from "@/server/auth/session";
import { suggestedUsers } from "@/server/queries/social";

export const metadata: Metadata = { title: "Find people" };

export default async function PeoplePage() {
  const session = await requireSession("/people");
  const people = await suggestedUsers(session.user.id, 24);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Find people</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Follow someone so you have a benchmark to feel superior to.
        </p>
      </header>

      {people.length === 0 ? (
        <SimpleEmpty
          title="You already follow everyone"
          body="Impressive. Or the site is very small. One of those."
        />
      ) : (
        <PeopleList initial={people} />
      )}
    </div>
  );
}
