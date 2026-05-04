import { CanActivate, ExecutionContext } from '@nestjs/common';
import { SessionService } from '../services/session.service';
export declare class BrandAuthGuard implements CanActivate {
    private readonly sessionService;
    constructor(sessionService: SessionService);
    canActivate(context: ExecutionContext): boolean;
}
