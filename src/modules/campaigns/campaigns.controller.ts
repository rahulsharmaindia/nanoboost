// ── Campaigns controller ─────────────────────────────────────
// Brand-side: CRUD, status, applications, submissions.
// Influencer-side: marketplace, apply, my-application, submit, my-campaigns.

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { BrandAuthGuard } from '../../common/guards/brand-auth.guard';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller()
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  // ── Brand endpoints ───────────────────────────────────────

  @UseGuards(BrandAuthGuard)
  @Post('api/campaigns')
  createCampaign(@Req() req: Request, @Body() body: Record<string, any>) {
    return this.campaignsService.createCampaign((req as any).sessionId, body);
  }

  @UseGuards(BrandAuthGuard)
  @Get('api/campaigns')
  listCampaigns(@Req() req: Request) {
    return this.campaignsService.listCampaigns((req as any).sessionId);
  }

  @UseGuards(BrandAuthGuard)
  @Get('api/campaigns/:campaignId')
  getCampaign(@Req() req: Request, @Param('campaignId') campaignId: string) {
    return this.campaignsService.getCampaign((req as any).sessionId, campaignId);
  }

  @UseGuards(BrandAuthGuard)
  @Put('api/campaigns/:campaignId')
  updateCampaign(
    @Req() req: Request,
    @Param('campaignId') campaignId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.campaignsService.updateCampaign((req as any).sessionId, campaignId, body);
  }

  @UseGuards(BrandAuthGuard)
  @Patch('api/campaigns/:campaignId/status')
  updateStatus(
    @Req() req: Request,
    @Param('campaignId') campaignId: string,
    @Body('status') status: string,
  ) {
    return this.campaignsService.updateStatus((req as any).sessionId, campaignId, status);
  }

  @UseGuards(BrandAuthGuard)
  @Get('api/campaigns/:campaignId/applications')
  listApplications(@Req() req: Request, @Param('campaignId') campaignId: string) {
    return this.campaignsService.listApplications((req as any).sessionId, campaignId);
  }

  @UseGuards(BrandAuthGuard)
  @Patch('api/campaigns/:campaignId/applications/:applicationId')
  reviewApplication(
    @Req() req: Request,
    @Param('campaignId') campaignId: string,
    @Param('applicationId') applicationId: string,
    @Body('status') status: string,
  ) {
    return this.campaignsService.reviewApplication(
      (req as any).sessionId,
      campaignId,
      applicationId,
      status,
    );
  }

  @UseGuards(BrandAuthGuard)
  @Get('api/campaigns/:campaignId/submissions')
  listSubmissions(@Req() req: Request, @Param('campaignId') campaignId: string) {
    return this.campaignsService.listSubmissions((req as any).sessionId, campaignId);
  }

  @UseGuards(BrandAuthGuard)
  @Patch('api/campaigns/:campaignId/submissions/:submissionId')
  reviewSubmission(
    @Req() req: Request,
    @Param('campaignId') campaignId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: { status: string; revisionNotes?: string },
  ) {
    return this.campaignsService.reviewSubmission(
      (req as any).sessionId,
      campaignId,
      submissionId,
      body.status,
      body.revisionNotes,
    );
  }

  // ── Influencer endpoints ──────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('api/marketplace/campaigns')
  listMarketplace(@Req() req: Request) {
    return this.campaignsService.listMarketplace((req as any).sessionId);
  }

  @UseGuards(AuthGuard)
  @Post('api/campaigns/:campaignId/applications')
  applyToCampaign(@Req() req: Request, @Param('campaignId') campaignId: string) {
    return this.campaignsService.applyToCampaign(
      (req as any).sessionId,
      campaignId,
      (req as any).accessToken,
    );
  }

  @UseGuards(AuthGuard)
  @Get('api/campaigns/:campaignId/my-application')
  getMyApplication(@Req() req: Request, @Param('campaignId') campaignId: string) {
    return this.campaignsService.getMyApplication((req as any).sessionId, campaignId);
  }

  @UseGuards(AuthGuard)
  @Post('api/campaigns/:campaignId/submissions')
  submitContent(
    @Req() req: Request,
    @Param('campaignId') campaignId: string,
    @Body() body: { contentUrl?: string; contentCaption?: string; notesToBrand?: string },
  ) {
    return this.campaignsService.submitContent((req as any).sessionId, campaignId, body);
  }

  @UseGuards(AuthGuard)
  @Get('api/my-campaigns')
  getMyCampaigns(@Req() req: Request) {
    return this.campaignsService.getMyCampaigns((req as any).sessionId);
  }
}
