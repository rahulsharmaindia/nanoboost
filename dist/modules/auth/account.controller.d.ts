import { Request } from 'express';
import { SessionService } from '../../common/services/session.service';
export declare class AccountController {
    private readonly sessionService;
    constructor(sessionService: SessionService);
    deleteAccount(req: Request): {
        confirmationCode: string;
        status: string;
        message: string;
    };
    disconnectInstagram(req: Request): {
        status: string;
    };
    metaDeletionCallback(req: Request): {
        error: string;
        url?: undefined;
        confirmation_code?: undefined;
    } | {
        url: string;
        confirmation_code: string;
        error?: undefined;
    };
    deletionStatus(code: string): {
        error: string;
        confirmation_code?: undefined;
        status?: undefined;
        message?: undefined;
    } | {
        confirmation_code: string;
        status: string;
        message: string;
        error?: undefined;
    };
}
