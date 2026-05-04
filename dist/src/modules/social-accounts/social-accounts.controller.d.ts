import { Request } from 'express';
import { SocialAccountsService } from './social-accounts.service';
export declare class SocialAccountsController {
    private readonly socialAccountsService;
    constructor(socialAccountsService: SocialAccountsService);
    getProfile(req: Request): Promise<any>;
    getMedia(req: Request): Promise<any>;
    getMediaInsights(req: Request, mediaId: string): Promise<any>;
    getOverview(req: Request): Promise<any>;
    getReachByMedia(req: Request): Promise<any>;
    getReachByFollower(req: Request): Promise<any>;
    getViewsByMedia(req: Request): Promise<any>;
    getFollows(req: Request): Promise<any>;
    getProfileTaps(req: Request): Promise<any>;
    getDemoCountry(req: Request): Promise<any>;
    getDemoCity(req: Request): Promise<any>;
    getDemoAge(req: Request): Promise<any>;
    getDemoGender(req: Request): Promise<any>;
    getEngagedCountry(req: Request): Promise<any>;
    getEngagedCity(req: Request): Promise<any>;
    getEngagedAge(req: Request): Promise<any>;
    getEngagedGender(req: Request): Promise<any>;
}
