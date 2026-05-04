// ── Social accounts controller ───────────────────────────────
// Profile, media, and insights endpoints for authenticated creators.
// All routes require Instagram session auth (accessToken in session).

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SocialAccountsService } from './social-accounts.service';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller()
@UseGuards(AuthGuard)
export class SocialAccountsController {
  constructor(private readonly socialAccountsService: SocialAccountsService) {}

  // GET /api/profile
  @Get('api/profile')
  async getProfile(@Req() req: Request) {
    return this.socialAccountsService.getProfile((req as any).accessToken);
  }

  // GET /api/media
  @Get('api/media')
  async getMedia(@Req() req: Request) {
    return this.socialAccountsService.getMedia((req as any).accessToken);
  }

  // GET /api/media/insights?media_id=
  @Get('api/media/insights')
  async getMediaInsights(@Req() req: Request, @Query('media_id') mediaId: string) {
    if (!mediaId) {
      return { error: 'Missing media_id' };
    }
    return this.socialAccountsService.getMediaInsights((req as any).accessToken, mediaId);
  }

  // ── Account insights ─────────────────────────────────────

  @Get('api/insights/overview')
  async getOverview(@Req() req: Request) {
    const query = 'metric=accounts_engaged,reach,views,likes,comments,shares,saves,total_interactions&period=day&metric_type=total_value';
    return this.socialAccountsService.getAccountInsights((req as any).accessToken, query);
  }

  @Get('api/insights/reach-media')
  async getReachByMedia(@Req() req: Request) {
    return this.socialAccountsService.getAccountInsights(
      (req as any).accessToken,
      'metric=reach&period=day&metric_type=total_value&breakdown=media_product_type',
    );
  }

  @Get('api/insights/reach-follower')
  async getReachByFollower(@Req() req: Request) {
    return this.socialAccountsService.getAccountInsights(
      (req as any).accessToken,
      'metric=reach&period=day&metric_type=total_value&breakdown=follow_type',
    );
  }

  @Get('api/insights/views-media')
  async getViewsByMedia(@Req() req: Request) {
    return this.socialAccountsService.getAccountInsights(
      (req as any).accessToken,
      'metric=views&period=day&metric_type=total_value&breakdown=media_product_type',
    );
  }

  @Get('api/insights/follows')
  async getFollows(@Req() req: Request) {
    return this.socialAccountsService.getAccountInsights(
      (req as any).accessToken,
      'metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type',
    );
  }

  @Get('api/insights/profile-taps')
  async getProfileTaps(@Req() req: Request) {
    return this.socialAccountsService.getAccountInsights(
      (req as any).accessToken,
      'metric=profile_links_taps&period=day&metric_type=total_value&breakdown=contact_button_type',
    );
  }

  // ── Demographics ─────────────────────────────────────────

  @Get('api/insights/demographics/country')
  async getDemoCountry(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'follower_demographics', 'country');
  }

  @Get('api/insights/demographics/city')
  async getDemoCity(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'follower_demographics', 'city');
  }

  @Get('api/insights/demographics/age')
  async getDemoAge(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'follower_demographics', 'age');
  }

  @Get('api/insights/demographics/gender')
  async getDemoGender(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'follower_demographics', 'gender');
  }

  @Get('api/insights/engaged/country')
  async getEngagedCountry(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'engaged_audience_demographics', 'country');
  }

  @Get('api/insights/engaged/city')
  async getEngagedCity(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'engaged_audience_demographics', 'city');
  }

  @Get('api/insights/engaged/age')
  async getEngagedAge(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'engaged_audience_demographics', 'age');
  }

  @Get('api/insights/engaged/gender')
  async getEngagedGender(@Req() req: Request) {
    return this.socialAccountsService.getDemographicInsights((req as any).accessToken, 'engaged_audience_demographics', 'gender');
  }
}
