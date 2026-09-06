// In Next.js, this file would be called: app/providers.tsx
"use client";

// Since QueryClientProvider relies on useContext under the hood, we have to put 'use client' on top
import {
  isServer,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { FairlxQuerySyncBridge } from "@/hooks/use-fairlx-query-sync";
import { installFairlxQuerySync } from "@/lib/fairlx-query-sync";

function makeQueryClient() {
  return installFairlxQuerySync(
    new QueryClient({
      defaultOptions: {
        queries: {
          // SCALING: These defaults apply to ALL queries that don't override.
          // At 1K+ users, aggressive refetching will exceed Appwrite plan limits.
          staleTime: 5 * 60 * 1000, // 5 minutes (was 2 min)
          refetchOnWindowFocus: false, // DISABLED globally — #1 cause of surprise reads
          refetchOnMount: true, // Refetch if data is stale on mount (respects staleTime)
          refetchOnReconnect: true,
          gcTime: 15 * 60 * 1000, // 15 minutes (was 5 min)
          retry: 1, // Only 1 retry to avoid amplifying failed requests
        },
      },
    }),
  );
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

interface QueryProviderProps {
  children: React.ReactNode;
}

export const QueryProvider = ({ children }: QueryProviderProps) => {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <FairlxQuerySyncBridge />
      {children}
    </QueryClientProvider>
  );
};
