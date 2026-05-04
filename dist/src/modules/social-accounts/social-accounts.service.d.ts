import { MetaService } from '../meta/meta.service';
export declare class SocialAccountsService {
    private readonly metaService;
    constructor(metaService: MetaService);
    getProfile(accessToken: string): Promise<any>;
    getMedia(accessToken: string): Promise<any>;
    getMediaInsights(accessToken: string, mediaId: string): Promise<any>;
    getAccountInsights(accessToken: string, query: string): Promise<any>;
    getDemographicInsights(accessToken: string, metric: string, breakdown: string): Promise<any>;
}
