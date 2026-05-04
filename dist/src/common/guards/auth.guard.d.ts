import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService } from '../services/session.service';
export declare class AuthGuard implements CanActivate {
    private readonly reflector;
    private readonly sessionService;
    constructor(reflector: Reflector, sessionService: SessionService);
    canActivate(context: ExecutionContext): boolean;
}
