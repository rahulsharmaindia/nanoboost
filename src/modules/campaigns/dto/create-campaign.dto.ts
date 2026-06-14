// ── Create Campaign DTO ──────────────────────────────────────
// Field-level validation for /api/campaigns POST. Cross-field rules
// (e.g. endDate > startDate, age min < max) live in the service —
// they're easier to express in code than as decorator chains.

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const PAYMENT_MODELS = ['Fixed', 'Commission', 'Barter'] as const;
const CAMPAIGN_TYPES = ['Promotion', 'UGC', 'Review', 'Giveaway'] as const;
const GENDERS = ['Male', 'Female', 'All'] as const;

/// Applied to every field that is mandatory for a real campaign but
/// optional while the campaign is still a draft. When status === 'Draft'
/// class-validator skips all other validators on the property, so a
/// half-filled draft can be saved without tripping the required checks.
const RequiredUnlessDraft = () =>
  ValidateIf((o: CreateCampaignDto) => o.status !== 'Draft');

export class CreateCampaignDto {
  // ── Basics ────────────────────────────────────────────────
  @RequiredUnlessDraft()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @RequiredUnlessDraft()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @RequiredUnlessDraft()
  @IsString()
  @IsNotEmpty()
  objective!: string;

  @RequiredUnlessDraft()
  @IsString()
  @IsIn(CAMPAIGN_TYPES as readonly string[])
  campaignType!: string;

  @IsOptional()
  @IsString()
  platform?: string;

  // ── Content ───────────────────────────────────────────────
  @IsOptional()
  @IsArray()
  postTypes?: string[];

  @IsOptional()
  @IsObject()
  deliverables?: Record<string, number>;

  @IsOptional()
  @IsInt()
  @Min(0)
  contentCountPerInfluencer?: number;

  @IsOptional()
  @IsString()
  captionGuidelines?: string;

  @IsOptional()
  @IsArray()
  hashtags?: string[];

  @IsOptional()
  @IsArray()
  mentions?: string[];

  @IsOptional()
  @IsString()
  handleToTag?: string;

  @IsOptional()
  @IsArray()
  referenceImages?: string[];

  // ── Audience ──────────────────────────────────────────────
  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(65)
  ageGroupMin!: number;

  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(65)
  ageGroupMax!: number;

  @RequiredUnlessDraft()
  @IsString()
  @IsIn(GENDERS as readonly string[])
  gender!: string;

  @RequiredUnlessDraft()
  @IsString()
  @IsNotEmpty()
  targetLocation!: string;

  @IsOptional()
  @IsArray()
  interests?: string[];

  @IsOptional()
  @IsString()
  languagePreference?: string;

  // ── Budget ────────────────────────────────────────────────
  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalBudget!: number;

  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetPerCreator!: number;

  @RequiredUnlessDraft()
  @IsString()
  @IsIn(PAYMENT_MODELS as readonly string[])
  paymentModel!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @IsOptional()
  @IsString()
  productDetails?: string;

  @IsOptional()
  @IsString()
  bonusCriteria?: string;

  @IsOptional()
  @IsString()
  performanceIncentive?: string;

  // ── Timeline ──────────────────────────────────────────────
  @RequiredUnlessDraft()
  @IsDateString()
  startDate!: string;

  @RequiredUnlessDraft()
  @IsDateString()
  endDate!: string;

  @RequiredUnlessDraft()
  @IsDateString()
  applicationDeadline!: string;

  @RequiredUnlessDraft()
  @IsDateString()
  submissionDeadline!: string;

  @RequiredUnlessDraft()
  @IsDateString()
  contentDeadline!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  revisionAllowedCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reviewTurnaroundHours?: number;

  @IsOptional()
  @IsString()
  postingTimeWindow?: string;

  // ── Creator requirements ──────────────────────────────────
  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumFollowers!: number;

  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  requiredEngagementRate!: number;

  @RequiredUnlessDraft()
  @IsString()
  @IsNotEmpty()
  preferredNiche!: string;

  @IsOptional()
  @IsString()
  contentStyleExpectations?: string;

  @IsOptional()
  @IsString()
  audienceGenderRatio?: string;

  // ── Slots ─────────────────────────────────────────────────
  @RequiredUnlessDraft()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalSlots!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reserveSlots?: number;

  @IsOptional()
  @IsArray()
  priorityInviteList?: string[];

  // ── Guidelines ────────────────────────────────────────────
  @IsOptional()
  @IsString()
  guidelinesDos?: string;

  @IsOptional()
  @IsString()
  guidelinesDonts?: string;

  @IsOptional()
  @IsString()
  brandMessaging?: string;

  @IsOptional()
  @IsString()
  approvalProcessDescription?: string;

  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  autoApproveAfterHours?: number;

  // ── Lifecycle ─────────────────────────────────────────────
  @IsOptional()
  @IsIn(['Draft', 'Published'])
  status?: string;
}
