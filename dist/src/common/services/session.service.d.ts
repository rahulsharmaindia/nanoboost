import { OnModuleDestroy } from '@nestjs/common';
export interface Session {
    accessToken: string | null;
    userId: string | null;
    businessId: string | null;
    hashedPassword: string | null;
    brandData: Record<string, any> | null;
    status: 'pending' | 'authenticated' | 'error';
    createdAt: number;
}
export declare class SessionService implements OnModuleDestroy {
    private readonly sessions;
    private cleanupTimer;
    constructor();
    onModuleDestroy(): void;
    create(): string;
    get(id: string): Session | undefined;
    remove(id: string): void;
    findBy(predicate: (session: Session) => boolean): {
        id: string;
        session: Session;
    } | null;
    private cleanup;
}
