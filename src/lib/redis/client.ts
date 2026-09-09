import Redis from "ioredis";

/**
 * Redis Client Singleton
 * 
 * Creates a single Redis connection shared across all server-side code.
 * Gracefully handles connection failures — app NEVER breaks if Redis is down.
 * 
 * ARCHITECTURE:
 * - Completely OPTIONAL: if REDIS_URL is not set, returns null (no connection attempts)
 * - Single connection for cache reads/writes
 * - Separate subscriber connection for Pub/Sub (Socket.IO adapter)
 * - Auto-reconnect with exponential backoff
 */

const REDIS_URL = process.env.REDIS_URL;

let redis: Redis | null = null;
let redisInitialized = false;

export function getRedisClient(): Redis | null {
    if (!REDIS_URL) return null;

    if (!redisInitialized) {
        redisInitialized = true;
        redis = new Redis(REDIS_URL, {
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                return Math.min(times * 100, 3000);
            },
            enableOfflineQueue: false, // Don't queue commands when disconnected
            connectTimeout: 5000,
            commandTimeout: 3000, // Individual command timeout
        });

        redis.on("error", (err) => {
            console.error("[Redis] Connection error:", err.message);
        });

        redis.on("connect", () => {
            console.log("[Redis] Connected successfully");
        });

        redis.on("close", () => {
            console.warn("[Redis] Connection closed");
        });
    }
    return redis;
}

/**
 * Get a duplicate client for Redis Pub/Sub (subscriber needs dedicated connection)
 * Used by Socket.IO Redis adapter
 */
export function getRedisSubscriber(): Redis | null {
    if (!REDIS_URL) return null;

    const sub = new Redis(REDIS_URL, {
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
            if (times > 10) return null;
            return Math.min(times * 100, 3000);
        },
        enableOfflineQueue: false,
        lazyConnect: true,
        connectTimeout: 5000,
    });

    sub.on("error", (err) => {
        console.error("[Redis:Sub] Connection error:", err.message);
    });

    return sub;
}

/**
 * Check if Redis is connected and responsive
 */
export async function isRedisHealthy(): Promise<boolean> {
    try {
        const client = getRedisClient();
        if (!client) return false;
        const result = await client.ping();
        return result === "PONG";
    } catch {
        return false;
    }
}

/**
 * Gracefully close Redis connections (for shutdown)
 */
export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit().catch(() => {});
        redis = null;
    }
}
