"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderError = exports.ValidationError = exports.ConflictError = exports.NotFoundError = exports.ForbiddenError = exports.UnauthorizedError = exports.AppError = exports.AppErrorCode = void 0;
var AppErrorCode;
(function (AppErrorCode) {
    AppErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    AppErrorCode["FORBIDDEN"] = "FORBIDDEN";
    AppErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    AppErrorCode["NOT_FOUND"] = "NOT_FOUND";
    AppErrorCode["CONFLICT"] = "CONFLICT";
    AppErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    AppErrorCode["PROVIDER_ERROR"] = "PROVIDER_ERROR";
    AppErrorCode["PROVIDER_PERMISSION_DENIED"] = "PROVIDER_PERMISSION_DENIED";
    AppErrorCode["PROVIDER_TOKEN_EXPIRED"] = "PROVIDER_TOKEN_EXPIRED";
    AppErrorCode["PROVIDER_CONNECTION_REVOKED"] = "PROVIDER_CONNECTION_REVOKED";
    AppErrorCode["DELETION_PENDING"] = "DELETION_PENDING";
    AppErrorCode["DELETION_COMPLETED"] = "DELETION_COMPLETED";
    AppErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
})(AppErrorCode || (exports.AppErrorCode = AppErrorCode = {}));
class AppError extends Error {
    constructor(code, message, statusCode = 500) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
class UnauthorizedError extends AppError {
    constructor(message = 'Not authenticated') {
        super(AppErrorCode.UNAUTHORIZED, message, 401);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(AppErrorCode.FORBIDDEN, message, 403);
    }
}
exports.ForbiddenError = ForbiddenError;
class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(AppErrorCode.NOT_FOUND, message, 404);
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends AppError {
    constructor(message) {
        super(AppErrorCode.CONFLICT, message, 409);
    }
}
exports.ConflictError = ConflictError;
class ValidationError extends AppError {
    constructor(message) {
        super(AppErrorCode.VALIDATION_ERROR, message, 400);
    }
}
exports.ValidationError = ValidationError;
class ProviderError extends AppError {
    constructor(message) {
        super(AppErrorCode.PROVIDER_ERROR, message, 502);
    }
}
exports.ProviderError = ProviderError;
//# sourceMappingURL=app.errors.js.map