import { Request, Response } from 'express';
import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    startOAuth(): {
        session_id: string;
        auth_url: string;
    };
    handleCallback(rawCode: string, state: string, error: string, errorDescription: string, res: Response): Promise<any>;
    getStatus(sessionId: string): {
        status: string;
        user_id?: undefined;
    } | {
        status: string;
        user_id: string;
    };
    logout(req: Request): {
        status: string;
    };
}
