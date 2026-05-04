import { SessionService } from '../../common/services/session.service';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
export declare class BrandsService {
    private readonly sessionService;
    constructor(sessionService: SessionService);
    private hashPassword;
    register(dto: RegisterBrandDto): {
        sessionId: string;
        brandData: Record<string, any>;
    };
    login(dto: LoginBrandDto): {
        sessionId: string;
        brandData: Record<string, any>;
    };
    getProfile(sessionId: string): Record<string, any>;
}
