export declare class MetaService {
    private readonly logger;
    private fetchJSON;
    private postForm;
    exchangeCodeForToken(code: string): Promise<any>;
    getUserId(token: string): Promise<string>;
    getUserProfile(token: string): Promise<any>;
    getUserMedia(token: string): Promise<any>;
    getMediaInsights(token: string, mediaId: string): Promise<any>;
    getAccountInsights(token: string, query: string): Promise<any>;
    getDemographicInsights(token: string, metric: string, breakdown: string): Promise<any>;
    getBasicProfile(token: string): Promise<{
        username: string;
        followerCount: number;
    }>;
}
