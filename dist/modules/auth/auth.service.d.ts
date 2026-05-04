import { SessionService } from '../../common/services/session.service';
import { MetaService } from '../meta/meta.service';
export declare class AuthService {
    private readonly sessionService;
    private readonly metaService;
    private readonly logger;
    constructor(sessionService: SessionService, metaService: MetaService);
    startOAuth(): {
        sessionId: string;
        authUrl: string;
    };
    handleCallback(code: string, state: string): Promise<{
        status: string;
        sessionId: string;
    }>;
    getStatus(sessionId: string): {
        status: string;
        userId: string | null;
    };
    logout(sessionId: string): void;
}
