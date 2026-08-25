import type { Metadata } from "next";

import { Connections } from "@/components/social/connections";

export async function generateMetadata({
  params,
}: PageProps<"/u/[username]/followers">): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username} · followers` };
}

export default async function FollowersPage({ params }: PageProps<"/u/[username]/followers">) {
  const { username } = await params;
  return <Connections username={username} tab="followers" />;
}
