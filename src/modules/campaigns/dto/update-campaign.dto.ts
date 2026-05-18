// ── Update Campaign DTO ──────────────────────────────────────
// Partial of CreateCampaignDto. PUT /api/campaigns/:id accepts any
// subset of fields; only provided values are persisted. Validation
// rules per field mirror the create DTO so values that arrive must
// still be the right shape.

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const PAYMENT_MODELS = ['Fixed', 'Commission', 'Barter'] as const;
const CAMPAIGN_TYPES = ['Promotion', 'UGC', 'Review', 'Giveaway'] as const;
const GENDERS = ['Male', 'Female', 'All'] as const;

export class UpdateCampaignDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsIn(CAMPAIGN_TYPES as readonly string[]) campaignType?: string;
  @IsOptional() @IsString() platform?: string;

  @IsOptional() @IsArray() postTypes?: string[];
  @IsOptional() @IsObject() deliverables?: Record<string, number>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) contentCountPerInfluencer?: number;
  @IsOptional() @IsString() captionGuidelines?: string;
  @IsOptional() @IsArray() hashtags?: string[];
  @IsOptional() @IsArray() mentions?: string[];
  @IsOptional() @IsString() handleToTag?: string;
  @IsOptional() @IsArray() referenceImages?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(13) @Max(65) ageGroupMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(13) @Max(65) ageGroupMax?: number;
  @IsOptional() @IsIn(GENDERS as readonly string[]) gender?: string;
  @IsOptional() @IsString() targetLocation?: string;
  @IsOptional() @IsArray() interests?: string[];
  @IsOptional() @IsString() languagePreference?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalBudget?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) budgetPerCreator?: number;
  @IsOptional() @IsIn(PAYMENT_MODELS as readonly string[]) paymentModel?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) commissionRate?: number;
  @IsOptional() @IsString() productDetails?: string;
  @IsOptional() @IsString() bonusCriteria?: string;
  @IsOptional() @IsString() performanceIncentive?: string;

  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() applicationDeadline?: string;
  @IsOptional() @IsDateString() submissionDeadline?: string;
  @IsOptional() @IsDateString() contentDeadline?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) revisionAllowedCount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reviewTurnaroundHours?: number;
  @IsOptional() @IsString() postingTimeWindow?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minimumFollowers?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) requiredEngagementRate?: number;
  @IsOptional() @IsString() preferredNiche?: string;
  @IsOptional() @IsString() contentStyleExpectations?: string;
  @IsOptional() @IsString() audienceGenderRatio?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) totalSlots?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reserveSlots?: number;
  @IsOptional() @IsArray() priorityInviteList?: string[];

  @IsOptional() @IsString() guidelinesDos?: string;
  @IsOptional() @IsString() guidelinesDonts?: string;
  @IsOptional() @IsString() brandMessaging?: string;
  @IsOptional() @IsString() approvalProcessDescription?: string;
  @IsOptional() @IsBoolean() requireApproval?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) autoApproveAfterHours?: number;

  @IsOptional() @IsIn(['Draft', 'Published', 'Active', 'Completed', 'Cancelled', 'Archived'])
  status?: string;
}
