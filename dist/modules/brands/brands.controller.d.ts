import { Request } from 'express';
import { BrandsService } from './brands.service';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
export declare class BrandsController {
    private readonly brandsService;
    constructor(brandsService: BrandsService);
    register(dto: RegisterBrandDto): {
        sessionId: string;
        brandData: Record<string, any>;
    };
    login(dto: LoginBrandDto): {
        sessionId: string;
        brandData: Record<string, any>;
    };
    getProfile(req: Request): Record<string, any>;
}
