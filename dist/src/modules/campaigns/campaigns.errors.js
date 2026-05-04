"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubmissionForbiddenError = exports.SubmissionNotFoundError = exports.SlotsFullError = exports.DuplicateApplicationError = exports.ApplicationNotFoundError = exports.CampaignNotEditableError = exports.InvalidStatusTransitionError = exports.CampaignValidationError = exports.CampaignNotFoundError = void 0;
const app_errors_1 = require("../../common/errors/app.errors");
class CampaignNotFoundError extends app_errors_1.NotFoundError {
    constructor() { super('Campaign not found'); }
}
exports.CampaignNotFoundError = CampaignNotFoundError;
class CampaignValidationError extends app_errors_1.ValidationError {
    constructor(message) { super(message); }
}
exports.CampaignValidationError = CampaignValidationError;
class InvalidStatusTransitionError extends app_errors_1.ValidationError {
    constructor(from, to) {
        super(`Invalid status transition from ${from} to ${to}`);
    }
}
exports.InvalidStatusTransitionError = InvalidStatusTransitionError;
class CampaignNotEditableError extends app_errors_1.ValidationError {
    constructor() { super('Only draft campaigns can be edited'); }
}
exports.CampaignNotEditableError = CampaignNotEditableError;
class ApplicationNotFoundError extends app_errors_1.NotFoundError {
    constructor() { super('Application not found'); }
}
exports.ApplicationNotFoundError = ApplicationNotFoundError;
class DuplicateApplicationError extends app_errors_1.ConflictError {
    constructor() { super('You have already applied to this campaign'); }
}
exports.DuplicateApplicationError = DuplicateApplicationError;
class SlotsFullError extends app_errors_1.ValidationError {
    constructor() { super('All influencer slots are filled'); }
}
exports.SlotsFullError = SlotsFullError;
class SubmissionNotFoundError extends app_errors_1.NotFoundError {
    constructor() { super('Submission not found'); }
}
exports.SubmissionNotFoundError = SubmissionNotFoundError;
class SubmissionForbiddenError extends app_errors_1.ForbiddenError {
    constructor() { super('You must have an approved application to submit content'); }
}
exports.SubmissionForbiddenError = SubmissionForbiddenError;
//# sourceMappingURL=campaigns.errors.js.map