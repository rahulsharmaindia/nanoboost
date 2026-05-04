// ── Campaign domain types ────────────────────────────────────

export type CampaignStatus =
  | 'Draft'
  | 'Published'
  | 'Active'
  | 'Completed'
  | 'Cancelled'
  | 'Archived';

export type ApplicationStatus = 'Pending' | 'Approved' | 'Rejected';

export type SubmissionStatus = 'Pending_Review' | 'Approved' | 'Revision_Requested';

export const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  Draft: ['Published', 'Cancelled'],
  Published: ['Active', 'Cancelled'],
  Active: ['Completed', 'Cancelled'],
  Completed: ['Archived'],
  Cancelled: ['Archived'],
  Archived: [],
};

export const REQUIRED_CAMPAIGN_FIELDS = [
  'title', 'description', 'objective', 'campaignType',
  'ageGroupMin', 'ageGroupMax', 'gender', 'targetLocation',
  'totalBudget', 'budgetPerCreator', 'paymentModel',
  'startDate', 'endDate', 'applicationDeadline',
  'submissionDeadline', 'contentDeadline',
  'minimumFollowers', 'requiredEngagementRate', 'preferredNiche',
  'totalSlots',
] as const;
