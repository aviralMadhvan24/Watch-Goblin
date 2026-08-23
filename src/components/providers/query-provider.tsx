"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * TanStack Query is used only for genuinely client-driven data: infinite
 * feeds, typeahead search, and optimistic tracking mutations. Everything that
 * can be rendered on the server is rendered on the server and never enters the
 * query cache — that is why there is no global store in this app.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // Created in state so each browser tab gets exactly one client, and so the
  // client is never shared across requests during SSR.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry an authorisation or validation failure — the answer
              // will not change, and retrying just delays the error toast.
              const status = (error as { status?: number } | null)?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
