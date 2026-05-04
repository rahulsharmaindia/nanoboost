"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_CAMPAIGN_FIELDS = exports.VALID_TRANSITIONS = void 0;
exports.VALID_TRANSITIONS = {
    Draft: ['Published', 'Cancelled'],
    Published: ['Active', 'Cancelled'],
    Active: ['Completed', 'Cancelled'],
    Completed: ['Archived'],
    Cancelled: ['Archived'],
    Archived: [],
};
exports.REQUIRED_CAMPAIGN_FIELDS = [
    'title', 'description', 'objective', 'campaignType',
    'ageGroupMin', 'ageGroupMax', 'gender', 'targetLocation',
    'totalBudget', 'budgetPerCreator', 'paymentModel',
    'startDate', 'endDate', 'applicationDeadline',
    'submissionDeadline', 'contentDeadline',
    'minimumFollowers', 'requiredEngagementRate', 'preferredNiche',
    'totalSlots',
];
//# sourceMappingURL=campaigns.types.js.map