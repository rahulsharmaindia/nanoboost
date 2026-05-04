"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCorsOptions = getCorsOptions;
const env_1 = require("./env");
function getCorsOptions() {
    const origins = env_1.env.corsOrigins === '*'
        ? '*'
        : env_1.env.corsOrigins.split(',').map(o => o.trim());
    return {
        origin: origins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: origins !== '*',
    };
}
//# sourceMappingURL=cors.js.map