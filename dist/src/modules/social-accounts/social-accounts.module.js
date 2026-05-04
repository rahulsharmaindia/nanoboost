"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialAccountsModule = void 0;
const common_1 = require("@nestjs/common");
const social_accounts_controller_1 = require("./social-accounts.controller");
const social_accounts_service_1 = require("./social-accounts.service");
const meta_module_1 = require("../meta/meta.module");
let SocialAccountsModule = class SocialAccountsModule {
};
exports.SocialAccountsModule = SocialAccountsModule;
exports.SocialAccountsModule = SocialAccountsModule = __decorate([
    (0, common_1.Module)({
        imports: [meta_module_1.MetaModule],
        controllers: [social_accounts_controller_1.SocialAccountsController],
        providers: [social_accounts_service_1.SocialAccountsService],
        exports: [social_accounts_service_1.SocialAccountsService],
    })
], SocialAccountsModule);
//# sourceMappingURL=social-accounts.module.js.map