import type { Metadata } from "next";

import { Connections } from "@/components/social/connections";

export async function generateMetadata({
  params,
}: PageProps<"/u/[username]/following">): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username} · following` };
}

export default async function FollowingPage({ params }: PageProps<"/u/[username]/following">) {
  const { username } = await params;
  return <Connections username={username} tab="following" />;
}
