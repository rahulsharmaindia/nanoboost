import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../common/errors/app.errors';
export declare class CampaignNotFoundError extends NotFoundError {
    constructor();
}
export declare class CampaignValidationError extends ValidationError {
    constructor(message: string);
}
export declare class InvalidStatusTransitionError extends ValidationError {
    constructor(from: string, to: string);
}
export declare class CampaignNotEditableError extends ValidationError {
    constructor();
}
export declare class ApplicationNotFoundError extends NotFoundError {
    constructor();
}
export declare class DuplicateApplicationError extends ConflictError {
    constructor();
}
export declare class SlotsFullError extends ValidationError {
    constructor();
}
export declare class SubmissionNotFoundError extends NotFoundError {
    constructor();
}
export declare class SubmissionForbiddenError extends ForbiddenError {
    constructor();
}
