/**
 * Centralized React Query configuration
 * Defines default staleTime and cacheTime for different data types
 * 
 * SCALING PRINCIPLE: Longer stale times = fewer DB reads.
 * At 1K+ users, every second shaved off polling = ~1K fewer reads/interval.
 * Use Appwrite Realtime, Fairlx query-sync (agent MCP writes + other tabs),
 * or manual invalidation instead of short polling.
 */

export const QUERY_CONFIG = {
  // Static/rarely changing data (workspaces, spaces, projects)
  STATIC: {
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  },
  
  // Semi-dynamic data (members, teams, workflows)
  SEMI_DYNAMIC: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  },
  
  // Dynamic data (tasks, work items, notifications)
  DYNAMIC: {
    staleTime: 2 * 60 * 1000, // 2 minutes (was 30s — too aggressive)
    gcTime: 5 * 60 * 1000, // 5 minutes
  },
  
  // Real-time data (activity logs, live updates)
  // Use Appwrite Realtime subscription, not polling
  REALTIME: {
    staleTime: 1 * 60 * 1000, // 1 minute (was 0 — never use staleTime:0 at scale)
    gcTime: 3 * 60 * 1000, // 3 minutes
  },
  
  // Analytics and reports
  ANALYTICS: {
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  },
} as const;
