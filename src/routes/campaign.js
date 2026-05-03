// ── Campaign routes ───────────────────────────────────────────
// CRUD endpoints for campaigns, plus status lifecycle management.

const { Router } = require('express');
const { requireBrandAuth } = require('./brand');
const { requireAuth } = require('../middleware/auth');
const sessionStore = require('../services/session');
const campaignStore = require('../services/campaign');

const router = Router();

// ── Validation helpers ───────────────────────────────────────

const VALID_TRANSITIONS = {
  Draft: ['Published', 'Cancelled'],
  Published: ['Active', 'Cancelled'],
  Active: ['Completed', 'Cancelled'],
  Completed: ['Archived'],
  Cancelled: ['Archived'],
};

const REQUIRED_FIELDS = [
  'title', 'description', 'objective', 'campaignType',
  'ageGroupMin', 'ageGroupMax', 'gender', 'targetLocation',
  'totalBudget', 'budgetPerCreator', 'paymentModel',
  'startDate', 'endDate', 'applicationDeadline',
  'submissionDeadline', 'contentDeadline',
  'minimumFollowers', 'requiredEngagementRate', 'preferredNiche',
  'totalSlots',
];

/**
 * Validate campaign data. Returns an array of error strings (empty = valid).
 */
function validateCampaignData(data) {
  const errors = [];

  // Required fields check
  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      errors.push(`${field} is required`);
    }
  }
  if (errors.length > 0) return errors;

  // Date constraints
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  const appDeadline = new Date(data.applicationDeadline);
  const subDeadline = new Date(data.submissionDeadline);
  const contentDeadline = new Date(data.contentDeadline);

  if (end <= start) errors.push('End date must be after start date');
  if (appDeadline >= start) errors.push('Application deadline must be before start date');
  if (subDeadline > end) errors.push('Submission deadline must be on or before end date');
  if (contentDeadline > subDeadline) errors.push('Content deadline must be on or before submission deadline');

  // Numeric constraints
  if (Number(data.totalSlots) < 1) errors.push('Total slots must be at least 1');
  if (Number(data.minimumFollowers) <= 0) errors.push('Minimum followers must be greater than 0');
  if (Number(data.totalBudget) < 0) errors.push('Total budget cannot be negative');
  if (Number(data.budgetPerCreator) > Number(data.totalBudget)) {
    errors.push('Budget per creator cannot exceed total campaign budget');
  }

  // Age group constraints
  const ageMin = Number(data.ageGroupMin);
  const ageMax = Number(data.ageGroupMax);
  if (ageMin < 13 || ageMin > 65) errors.push('Age must be between 13 and 65');
  if (ageMax < 13 || ageMax > 65) errors.push('Age must be between 13 and 65');
  if (ageMin >= ageMax) errors.push('Minimum age must be less than maximum age');

  // Engagement rate constraint
  const engagementRate = Number(data.requiredEngagementRate);
  if (engagementRate < 0 || engagementRate > 100) {
    errors.push('Engagement rate must be between 0 and 100');
  }

  // Reserve slots constraint
  if (data.reserveSlots !== undefined && data.reserveSlots !== null) {
    if (Number(data.reserveSlots) > Number(data.totalSlots)) {
      errors.push('Reserve slots cannot exceed total slots');
    }
  }

  return errors;
}

/**
 * Check if a status transition is valid.
 */
function isValidTransition(currentStatus, newStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed && allowed.includes(newStatus);
}

// ── POST /api/campaigns ──────────────────────────────────────
router.post('/api/campaigns', requireBrandAuth, (req, res) => {
  try {
    const data = req.body;
    const errors = validateCampaignData(data);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.createCampaign(businessId, data);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/campaigns ───────────────────────────────────────
router.get('/api/campaigns', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaigns = campaignStore.listByBusiness(businessId);
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/campaigns/:campaignId ───────────────────────────
router.get('/api/campaigns/:campaignId', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/campaigns/:campaignId ───────────────────────────
router.put('/api/campaigns/:campaignId', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'Draft') {
      return res.status(400).json({ error: 'Only draft campaigns can be edited' });
    }

    // Merge existing data with updates for validation
    const merged = { ...campaign, ...req.body };
    const errors = validateCampaignData(merged);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const updated = campaignStore.updateCampaign(req.params.campaignId, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/campaigns/:campaignId/status ──────────────────
router.patch('/api/campaigns/:campaignId/status', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const { status: newStatus } = req.body;

    if (!isValidTransition(campaign.status, newStatus)) {
      return res.status(400).json({
        error: `Invalid status transition from ${campaign.status} to ${newStatus}`,
      });
    }

    // On transition to Published: re-validate all required fields and budget
    if (newStatus === 'Published') {
      const errors = validateCampaignData(campaign);
      if (errors.length > 0) {
        return res.status(400).json({ error: errors[0] });
      }
    }

    // On transition to Active: verify current date >= startDate
    if (newStatus === 'Active') {
      const now = new Date();
      const startDate = new Date(campaign.startDate);
      if (now < startDate) {
        return res.status(400).json({
          error: 'Cannot activate campaign before start date',
        });
      }
    }

    const updated = campaignStore.updateCampaign(req.params.campaignId, { status: newStatus });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Business Endpoints: Applications & Submissions ───────────

// ── GET /api/campaigns/:campaignId/applications (Business) ───
router.get('/api/campaigns/:campaignId/applications', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const applications = campaignStore.listApplicationsByCampaign(req.params.campaignId);
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/campaigns/:campaignId/applications/:applicationId (Business) ─
router.patch('/api/campaigns/:campaignId/applications/:applicationId', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const application = campaignStore.getApplication(req.params.applicationId);
    if (!application || application.campaignId !== req.params.campaignId) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const { status } = req.body;
    if (!status || !['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "Approved" or "Rejected"' });
    }

    // On Approved: check slot capacity
    if (status === 'Approved') {
      const allApps = campaignStore.listApplicationsByCampaign(req.params.campaignId);
      const approvedCount = allApps.filter(a => a.status === 'Approved').length;
      if (approvedCount >= Number(campaign.totalSlots)) {
        return res.status(400).json({ error: 'All influencer slots are filled' });
      }
    }

    const updated = campaignStore.updateApplication(req.params.applicationId, { status });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/campaigns/:campaignId/submissions (Business) ────
router.get('/api/campaigns/:campaignId/submissions', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const submissions = campaignStore.listSubmissionsByCampaign(req.params.campaignId);

    // Auto-approve logic: if campaign has requireApproval and autoApproveAfterHours,
    // mark Pending_Review submissions as Approved if enough time has elapsed
    if (campaign.requireApproval && campaign.autoApproveAfterHours) {
      const now = new Date();
      const autoApproveMs = Number(campaign.autoApproveAfterHours) * 60 * 60 * 1000;
      for (const sub of submissions) {
        if (sub.status === 'Pending_Review') {
          const elapsed = now - new Date(sub.createdAt);
          if (elapsed > autoApproveMs) {
            sub.status = 'Approved';
          }
        }
      }
    }

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/campaigns/:campaignId/submissions/:submissionId (Business) ─
router.patch('/api/campaigns/:campaignId/submissions/:submissionId', requireBrandAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const businessId = session.businessId;

    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign || campaign.businessId !== businessId) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const submission = campaignStore.getSubmission(req.params.submissionId);
    if (!submission || submission.campaignId !== req.params.campaignId) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const { status, revisionNotes } = req.body;
    if (!status || !['Approved', 'Revision_Requested'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "Approved" or "Revision_Requested"' });
    }

    const updateData = { status };
    if (revisionNotes) {
      updateData.revisionNotes = revisionNotes;
    }

    const updated = campaignStore.updateSubmission(req.params.submissionId, updateData);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Influencer Endpoints ─────────────────────────────────────

// ── GET /api/marketplace/campaigns (Influencer) ──────────────
router.get('/api/marketplace/campaigns', requireAuth, (req, res) => {
  try {
    const published = campaignStore.listPublished();

    const enriched = published.map(campaign => {
      // Look up the brand name from the campaign owner's session
      const ownerSession = sessionStore.findBy(s => s.businessId === campaign.businessId);
      const brandName = ownerSession && ownerSession.session.brandData
        ? ownerSession.session.brandData.name
        : 'Unknown Brand';

      // Count approved applications for slot calculation
      const apps = campaignStore.listApplicationsByCampaign(campaign.campaignId);
      const approvedCount = apps.filter(a => a.status === 'Approved').length;

      return {
        ...campaign,
        brandName,
        approvedCount,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/campaigns/:campaignId/applications (Influencer) ─
router.post('/api/campaigns/:campaignId/applications', requireAuth, async (req, res) => {
  try {
    const campaign = campaignStore.getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Campaign must be Published or Active
    if (campaign.status !== 'Published' && campaign.status !== 'Active') {
      return res.status(400).json({ error: 'Campaign is not accepting applications' });
    }

    const session = sessionStore.get(req.sessionId);
    const influencerId = session.userId;

    // Check for duplicate application
    const existing = campaignStore.findApplication(req.params.campaignId, influencerId);
    if (existing) {
      return res.status(409).json({ error: 'You have already applied to this campaign' });
    }

    // Check slot availability
    const allApps = campaignStore.listApplicationsByCampaign(req.params.campaignId);
    const approvedCount = allApps.filter(a => a.status === 'Approved').length;
    if (approvedCount >= Number(campaign.totalSlots)) {
      return res.status(400).json({ error: 'No available slots for this campaign' });
    }

    // Fetch influencer profile from Instagram to get username and follower count
    let username = 'unknown';
    let followerCount = 0;
    try {
      const profileRes = await fetch(
        `https://graph.instagram.com/v25.0/me?fields=username,followers_count&access_token=${encodeURIComponent(req.accessToken)}`
      );
      const profileData = await profileRes.json();
      if (profileData.username) username = profileData.username;
      if (profileData.followers_count) followerCount = profileData.followers_count;
    } catch {
      // If profile fetch fails, proceed with defaults
    }

    const application = campaignStore.createApplication(
      req.params.campaignId,
      influencerId,
      { username, followerCount }
    );

    res.status(201).json(application);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/campaigns/:campaignId/my-application (Influencer) ─
router.get('/api/campaigns/:campaignId/my-application', requireAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const influencerId = session.userId;

    const application = campaignStore.findApplication(req.params.campaignId, influencerId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(application);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/campaigns/:campaignId/submissions (Influencer) ─
router.post('/api/campaigns/:campaignId/submissions', requireAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const influencerId = session.userId;

    // Verify influencer has an approved application
    const application = campaignStore.findApplication(req.params.campaignId, influencerId);
    if (!application || application.status !== 'Approved') {
      return res.status(403).json({ error: 'You must have an approved application to submit content' });
    }

    const { contentUrl, contentCaption, notesToBrand } = req.body;

    const submission = campaignStore.createSubmission(
      req.params.campaignId,
      influencerId,
      { contentUrl, contentCaption, notesToBrand }
    );

    res.status(201).json(submission);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/my-campaigns (Influencer) ───────────────────────
// Returns all campaigns the influencer has applied to, with application status.
router.get('/api/my-campaigns', requireAuth, (req, res) => {
  try {
    const session = sessionStore.get(req.sessionId);
    const influencerId = session.userId;

    const myApps = campaignStore.listApplicationsByInfluencer(influencerId);

    const result = myApps.map(app => {
      const campaign = campaignStore.getCampaign(app.campaignId);
      if (!campaign) return null;

      // Look up brand name
      const ownerSession = sessionStore.findBy(s => s.businessId === campaign.businessId);
      const brandName = ownerSession && ownerSession.session.brandData
        ? ownerSession.session.brandData.name
        : 'Unknown Brand';

      const allApps = campaignStore.listApplicationsByCampaign(campaign.campaignId);
      const approvedCount = allApps.filter(a => a.status === 'Approved').length;

      return {
        ...campaign,
        brandName,
        approvedCount,
        applicationStatus: app.status,
        applicationId: app.applicationId,
        appliedAt: app.createdAt,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
