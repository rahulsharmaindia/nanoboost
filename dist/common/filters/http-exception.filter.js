"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var HttpExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const app_errors_1 = require("../errors/app.errors");
let HttpExceptionFilter = HttpExceptionFilter_1 = class HttpExceptionFilter {
    constructor() {
        this.logger = new common_1.Logger(HttpExceptionFilter_1.name);
    }
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const requestId = request.requestId || 'unknown';
        let statusCode = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let code = app_errors_1.AppErrorCode.UNKNOWN_ERROR;
        let message = 'Internal server error';
        if (exception instanceof app_errors_1.AppError) {
            statusCode = exception.statusCode;
            code = exception.code;
            message = exception.message;
        }
        else if (exception instanceof common_1.HttpException) {
            statusCode = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            if (typeof exceptionResponse === 'object' && exceptionResponse.message) {
                const msg = exceptionResponse.message;
                message = Array.isArray(msg) ? msg[0] : msg;
            }
            else {
                message = exception.message;
            }
            code = app_errors_1.AppErrorCode.VALIDATION_ERROR;
        }
        else if (exception instanceof Error) {
            this.logger.error(`Unhandled error on ${request.method} ${request.url}`, exception.stack);
        }
        response.status(statusCode).json({
            data: null,
            error: { code, message },
            requestId,
        });
    }
};
exports.HttpExceptionFilter = HttpExceptionFilter;
exports.HttpExceptionFilter = HttpExceptionFilter = HttpExceptionFilter_1 = __decorate([
    (0, common_1.Catch)()
], HttpExceptionFilter);
//# sourceMappingURL=http-exception.filter.js.map