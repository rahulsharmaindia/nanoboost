import { Pool } from 'pg';
export declare function getDrizzleClient(): import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, unknown>> & {
    $client: Pool;
};
export type DrizzleClient = ReturnType<typeof getDrizzleClient>;
