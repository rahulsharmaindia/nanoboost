"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = exports.SUPABASE_ADMIN_CLIENT = exports.DRIZZLE_CLIENT = void 0;
const common_1 = require("@nestjs/common");
const database_client_1 = require("./database.client");
const supabase_client_1 = require("./supabase.client");
exports.DRIZZLE_CLIENT = 'DRIZZLE_CLIENT';
exports.SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: exports.DRIZZLE_CLIENT,
                useFactory: () => (0, database_client_1.getDrizzleClient)(),
            },
            {
                provide: exports.SUPABASE_ADMIN_CLIENT,
                useFactory: () => (0, supabase_client_1.getSupabaseAdminClient)(),
            },
        ],
        exports: [exports.DRIZZLE_CLIENT, exports.SUPABASE_ADMIN_CLIENT],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map