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
} from 'class-validator';

const PAYMENT_MODELS = ['Fixed', 'Commission', 'Barter'] as const;
const CAMPAIGN_TYPES = ['Promotion', 'UGC', 'Review', 'Giveaway'] as const;
const GENDERS = ['Male', 'Female', 'All'] as const;

export class CreateCampaignDto {
  // ── Basics ────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  objective!: string;

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
  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(65)
  ageGroupMin!: number;

  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(65)
  ageGroupMax!: number;

  @IsString()
  @IsIn(GENDERS as readonly string[])
  gender!: string;

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
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalBudget!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetPerCreator!: number;

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
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsDateString()
  applicationDeadline!: string;

  @IsDateString()
  submissionDeadline!: string;

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumFollowers!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  requiredEngagementRate!: number;

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
