// ── Social accounts controller ───────────────────────────────
// Profile, media, insights, and niche endpoints for creators.

import { Controller, Get, Patch, Query, Body, Req, UseGuards } from '@nestjs/common';
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
    const accessToken = (req as any).accessToken as string | null;
    // Google-only influencers have no Instagram token — return a minimal
    // profile built from the influencer row so the profile screen renders.
    if (!accessToken) {
      const influencerId = (req as any).influencerId as string;
      return this.socialAccountsService.getProfileFromDb(influencerId);
    }
    return this.socialAccountsService.getProfile(
      accessToken,
      (req as any).influencerId,
    );
  }

  // GET /api/profile/niches
  @Get('api/profile/niches')
  async getNiches(@Req() req: Request) {
    const niches = await this.socialAccountsService.getNiches(
      (req as any).influencerId,
    );
    return { niches };
  }

  // PATCH /api/profile/niches
  @Patch('api/profile/niches')
  async updateNiches(@Req() req: Request, @Body() body: { niches: string[] }) {
    const niches = await this.socialAccountsService.updateNiches(
      (req as any).influencerId,
      body.niches || [],
    );
    return { niches };
  }

  // GET /api/media
  @Get('api/media')
  async getMedia(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    // Google-only influencers have no Instagram token — return empty media.
    if (!accessToken) {
      return { data: [] };
    }
    return this.socialAccountsService.getMedia(accessToken);
  }

  // GET /api/media/insights?media_id=
  @Get('api/media/insights')
  async getMediaInsights(@Req() req: Request, @Query('media_id') mediaId: string) {
    if (!mediaId) return { error: 'Missing media_id' };
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: [] };
    return this.socialAccountsService.getMediaInsights(accessToken, mediaId);
  }

  // ── Account insights ─────────────────────────────────────

  @Get('api/insights/overview')
  async getOverview(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    const query = 'metric=accounts_engaged,reach,views,likes,comments,shares,saves,total_interactions&period=day&metric_type=total_value';
    return this.socialAccountsService.getAccountInsights(accessToken, query);
  }

  @Get('api/insights/reach-media')
  async getReachByMedia(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getAccountInsights(
      accessToken,
      'metric=reach&period=day&metric_type=total_value&breakdown=media_product_type',
    );
  }

  @Get('api/insights/reach-follower')
  async getReachByFollower(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getAccountInsights(
      accessToken,
      'metric=reach&period=day&metric_type=total_value&breakdown=follow_type',
    );
  }

  @Get('api/insights/views-media')
  async getViewsByMedia(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getAccountInsights(
      accessToken,
      'metric=views&period=day&metric_type=total_value&breakdown=media_product_type',
    );
  }

  @Get('api/insights/follows')
  async getFollows(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getAccountInsights(
      accessToken,
      'metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type',
    );
  }

  @Get('api/insights/profile-taps')
  async getProfileTaps(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getAccountInsights(
      accessToken,
      'metric=profile_links_taps&period=day&metric_type=total_value&breakdown=contact_button_type',
    );
  }

  // ── Demographics ─────────────────────────────────────────

  @Get('api/insights/demographics/country')
  async getDemoCountry(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'follower_demographics', 'country');
  }

  @Get('api/insights/demographics/city')
  async getDemoCity(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'follower_demographics', 'city');
  }

  @Get('api/insights/demographics/age')
  async getDemoAge(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'follower_demographics', 'age');
  }

  @Get('api/insights/demographics/gender')
  async getDemoGender(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'follower_demographics', 'gender');
  }

  @Get('api/insights/engaged/country')
  async getEngagedCountry(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'engaged_audience_demographics', 'country');
  }

  @Get('api/insights/engaged/city')
  async getEngagedCity(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'engaged_audience_demographics', 'city');
  }

  @Get('api/insights/engaged/age')
  async getEngagedAge(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'engaged_audience_demographics', 'age');
  }

  @Get('api/insights/engaged/gender')
  async getEngagedGender(@Req() req: Request) {
    const accessToken = (req as any).accessToken as string | null;
    if (!accessToken) return { data: { results: [] } };
    return this.socialAccountsService.getDemographicInsights(accessToken, 'engaged_audience_demographics', 'gender');
  }
}
