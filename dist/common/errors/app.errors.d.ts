export declare enum AppErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    NOT_FOUND = "NOT_FOUND",
    CONFLICT = "CONFLICT",
    RATE_LIMITED = "RATE_LIMITED",
    PROVIDER_ERROR = "PROVIDER_ERROR",
    PROVIDER_PERMISSION_DENIED = "PROVIDER_PERMISSION_DENIED",
    PROVIDER_TOKEN_EXPIRED = "PROVIDER_TOKEN_EXPIRED",
    PROVIDER_CONNECTION_REVOKED = "PROVIDER_CONNECTION_REVOKED",
    DELETION_PENDING = "DELETION_PENDING",
    DELETION_COMPLETED = "DELETION_COMPLETED",
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
}
export declare class AppError extends Error {
    readonly code: AppErrorCode;
    readonly statusCode: number;
    constructor(code: AppErrorCode, message: string, statusCode?: number);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string);
}
export declare class ConflictError extends AppError {
    constructor(message: string);
}
export declare class ValidationError extends AppError {
    constructor(message: string);
}
export declare class ProviderError extends AppError {
    constructor(message: string);
}
