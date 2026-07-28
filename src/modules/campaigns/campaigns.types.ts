// ── Campaign domain types ────────────────────────────────────

export type CampaignStatus =
  | 'Draft'
  | 'Published'
  | 'Active'
  | 'Completed'
  | 'Cancelled'
  | 'Archived';

export type ApplicationStatus = 'Pending' | 'Approved' | 'Rejected' | 'Withdrawn';

export type SubmissionStatus =
  | 'Pending_Review'
  | 'Approved'
  | 'Revision_Requested'
  | 'Rejected'
  | 'Published';

export type CollaborationStatus = 'Active' | 'Completed' | 'Withdrawn' | 'Cancelled';

export type CollaborationEventType =
  | 'message'
  | 'collaboration_started'
  | 'submission_created'
  | 'submission_resubmitted'
  | 'revision_requested'
  | 'submission_approved'
  | 'submission_rejected'
  | 'submission_published'
  | 'status_changed';

// The actor that produced a thread entry.
export type CollaborationActorType = 'brand' | 'influencer' | 'system';

// Submission statuses from which an influencer may edit + resubmit.
export const RESUBMITTABLE_STATUSES: SubmissionStatus[] = [
  'Revision_Requested',
  'Rejected',
];

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
