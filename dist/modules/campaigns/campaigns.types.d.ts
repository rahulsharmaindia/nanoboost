export type CampaignStatus = 'Draft' | 'Published' | 'Active' | 'Completed' | 'Cancelled' | 'Archived';
export type ApplicationStatus = 'Pending' | 'Approved' | 'Rejected';
export type SubmissionStatus = 'Pending_Review' | 'Approved' | 'Revision_Requested';
export declare const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]>;
export declare const REQUIRED_CAMPAIGN_FIELDS: readonly ["title", "description", "objective", "campaignType", "ageGroupMin", "ageGroupMax", "gender", "targetLocation", "totalBudget", "budgetPerCreator", "paymentModel", "startDate", "endDate", "applicationDeadline", "submissionDeadline", "contentDeadline", "minimumFollowers", "requiredEngagementRate", "preferredNiche", "totalSlots"];
