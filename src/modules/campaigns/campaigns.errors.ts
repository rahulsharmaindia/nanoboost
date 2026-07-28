// ── Campaign-specific errors ─────────────────────────────────

import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../common/errors/app.errors';

export class CampaignNotFoundError extends NotFoundError {
  constructor() { super('Campaign not found'); }
}

export class CampaignValidationError extends ValidationError {
  constructor(message: string) { super(message); }
}

export class InvalidStatusTransitionError extends ValidationError {
  constructor(from: string, to: string) {
    super(`Invalid status transition from ${from} to ${to}`);
  }
}

export class CampaignNotEditableError extends ValidationError {
  constructor() { super('Only draft campaigns can be edited'); }
}

export class ApplicationNotFoundError extends NotFoundError {
  constructor() { super('Application not found'); }
}

export class DuplicateApplicationError extends ConflictError {
  constructor() { super('You have already applied to this campaign'); }
}

export class SlotsFullError extends ValidationError {
  constructor() { super('All influencer slots are filled'); }
}

export class SubmissionNotFoundError extends NotFoundError {
  constructor() { super('Submission not found'); }
}

export class SubmissionForbiddenError extends ForbiddenError {
  constructor() { super('You must have an approved application to submit content'); }
}

export class SubmissionNotEditableError extends ValidationError {
  constructor() {
    super('Only submissions with a revision request or rejection can be edited');
  }
}

export class ContentLimitReachedError extends ValidationError {
  constructor() {
    super('You have reached the content limit for this campaign');
  }
}

export class CollaborationNotFoundError extends NotFoundError {
  constructor() { super('Collaboration not found'); }
}

export class CollaborationForbiddenError extends ForbiddenError {
  constructor() { super('You do not have access to this collaboration'); }
}
