const crypto = require('crypto');

const campaigns = new Map();
const applications = new Map();
const submissions = new Map();

// ── Campaign CRUD ────────────────────────────────────────────

function createCampaign(businessId, data) {
  const campaignId = crypto.randomUUID();
  const campaign = {
    campaignId,
    businessId,
    ...data,
    status: data.status || 'Draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  campaigns.set(campaignId, campaign);
  return campaign;
}

function getCampaign(campaignId) {
  return campaigns.get(campaignId) || null;
}

function listByBusiness(businessId) {
  const result = [];
  for (const campaign of campaigns.values()) {
    if (campaign.businessId === businessId) result.push(campaign);
  }
  return result.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function updateCampaign(campaignId, data) {
  const campaign = campaigns.get(campaignId);
  if (!campaign) return null;
  Object.assign(campaign, data, { updatedAt: new Date().toISOString() });
  return campaign;
}

function listPublished() {
  const now = new Date();
  const result = [];
  for (const campaign of campaigns.values()) {
    if (
      (campaign.status === 'Published' || campaign.status === 'Active') &&
      new Date(campaign.applicationDeadline) > now
    ) {
      result.push(campaign);
    }
  }
  return result.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
}

// ── Applications ─────────────────────────────────────────────

function createApplication(campaignId, influencerId, influencerData) {
  const applicationId = crypto.randomUUID();
  const application = {
    applicationId,
    campaignId,
    influencerId,
    ...influencerData,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };
  applications.set(applicationId, application);
  return application;
}

function getApplication(applicationId) {
  return applications.get(applicationId) || null;
}

function listApplicationsByCampaign(campaignId) {
  const result = [];
  for (const app of applications.values()) {
    if (app.campaignId === campaignId) result.push(app);
  }
  return result;
}

function findApplication(campaignId, influencerId) {
  for (const app of applications.values()) {
    if (app.campaignId === campaignId && app.influencerId === influencerId) {
      return app;
    }
  }
  return null;
}

function listApplicationsByInfluencer(influencerId) {
  const result = [];
  for (const app of applications.values()) {
    if (app.influencerId === influencerId) result.push(app);
  }
  return result.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function updateApplication(applicationId, data) {
  const app = applications.get(applicationId);
  if (!app) return null;
  Object.assign(app, data);
  return app;
}

// ── Submissions ──────────────────────────────────────────────

function createSubmission(campaignId, influencerId, data) {
  const submissionId = crypto.randomUUID();
  const submission = {
    submissionId,
    campaignId,
    influencerId,
    ...data,
    status: 'Pending_Review',
    createdAt: new Date().toISOString(),
  };
  submissions.set(submissionId, submission);
  return submission;
}

function getSubmission(submissionId) {
  return submissions.get(submissionId) || null;
}

function listSubmissionsByCampaign(campaignId) {
  const result = [];
  for (const sub of submissions.values()) {
    if (sub.campaignId === campaignId) result.push(sub);
  }
  return result;
}

function updateSubmission(submissionId, data) {
  const sub = submissions.get(submissionId);
  if (!sub) return null;
  Object.assign(sub, data);
  return sub;
}

module.exports = {
  createCampaign, getCampaign, listByBusiness, updateCampaign, listPublished,
  createApplication, getApplication, listApplicationsByCampaign,
  findApplication, listApplicationsByInfluencer, updateApplication,
  createSubmission, getSubmission, listSubmissionsByCampaign, updateSubmission,
};
