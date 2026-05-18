// ── ESLint Flat Config ─────────────────────────────────────────────────────────
// server/eslint.config.cjs
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                    META PLATFORM TERMS LINT GUARD                           ║
// ║                                                                             ║
// ║  Requirements: 19.1, 19.2, 19.3                                             ║
// ║                                                                             ║
// ║  The `no-instagram-graph-api-in-promotion` rule below enforces that no      ║
// ║  file matching `**/subscriptions/promotion*` may import or require any      ║
// ║  Instagram Graph API client module.                                         ║
// ║                                                                             ║
// ║  Rationale: The "Boost" add-on places creator profiles only on             ║
// ║  NanoCeleb-internal surfaces (feed, brand search). It MUST NOT call the    ║
// ║  Instagram Graph API to influence ranking or placement. Violating this      ║
// ║  rule would breach Meta Platform Terms §3 and must emit the runtime alert  ║
// ║  META_TOS_VIOLATION_ATTEMPT (see promotion.service.ts).                    ║
// ║                                                                             ║
// ║  Banned import patterns (case-insensitive):                                 ║
// ║    • Any path containing "instagram" and ("graph" or "api")                 ║
// ║    • @fbgraph, fb-graph-api, instagram-graph-api, instagram-private-api    ║
// ║    • Any local import from ../../meta/ or ../../instagram/                  ║
// ║                                                                             ║
// ║  If a Graph API call is genuinely needed in a promotion path, it MUST be   ║
// ║  reviewed and approved by the platform-compliance team before the lint      ║
// ║  rule is adjusted. Do NOT disable this rule with eslint-disable comments   ║
// ║  without a compliance sign-off recorded in the PR description.             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

'use strict';

// ── Custom rule: no-instagram-graph-api-in-promotion ──────────────────────────
// Bans Instagram Graph API imports in files under subscriptions/promotion* paths.
// Emits a lint error that references the META_TOS_VIOLATION_ATTEMPT alert so
// developers understand the compliance consequence of the violation.
const noInstagramGraphApiInPromotion = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Instagram Graph API imports in promotion paths (Meta TOS compliance, Req 19.1–19.3)',
      recommended: true,
      url: 'https://developers.facebook.com/terms/',
    },
    messages: {
      META_TOS_VIOLATION_ATTEMPT:
        "META_TOS_VIOLATION_ATTEMPT: Instagram Graph API import '{{source}}' is banned in " +
        'promotion paths (subscriptions/promotion*). The Boost add-on must only promote on ' +
        'NanoCeleb-internal surfaces. Importing this module would violate Meta Platform Terms §3 ' +
        '(Req 19.1, 19.2). Remove this import and use only the NanoCeleb-internal feed/search APIs. ' +
        'See server/src/modules/subscriptions/promotion.service.ts for the approved pattern.',
    },
    schema: [],
  },

  create(context) {
    /** Returns true if the import source looks like an Instagram Graph API module. */
    function isGraphApiImport(source) {
      const s = source.toLowerCase();

      // Well-known npm packages for the Instagram / Facebook Graph API
      const bannedPackages = [
        'instagram-graph-api',
        'instagram-private-api',
        'instagram-web-api',
        '@fbgraph',
        'fb-graph-api',
        'facebook-nodejs-business-sdk',
        'fb',
        'node-fb',
      ];
      if (bannedPackages.some((pkg) => s === pkg || s.startsWith(pkg + '/'))) {
        return true;
      }

      // Heuristic: any path containing both "instagram"/"facebook"/"meta" and "graph"/"api"
      const hasSocialKeyword = s.includes('instagram') || s.includes('facebook') || s.includes('fbgraph');
      const hasApiKeyword = s.includes('graph') || s.includes('/api');
      if (hasSocialKeyword && hasApiKeyword) {
        return true;
      }

      // Local relative imports from meta/ or instagram/ sibling modules
      if (/\.\.\/+(meta|instagram)\//i.test(source)) {
        return true;
      }

      return false;
    }

    return {
      ImportDeclaration(node) {
        if (isGraphApiImport(node.source.value)) {
          context.report({
            node,
            messageId: 'META_TOS_VIOLATION_ATTEMPT',
            data: { source: node.source.value },
          });
        }
      },
      // Also catch CommonJS require() calls
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          typeof node.arguments[0].value === 'string' &&
          isGraphApiImport(node.arguments[0].value)
        ) {
          context.report({
            node,
            messageId: 'META_TOS_VIOLATION_ATTEMPT',
            data: { source: node.arguments[0].value },
          });
        }
      },
    };
  },
};

// ── Plugin wrapper ─────────────────────────────────────────────────────────────
const metaTosPlugin = {
  meta: { name: 'meta-tos', version: '1.0.0' },
  rules: {
    'no-instagram-graph-api-in-promotion': noInstagramGraphApiInPromotion,
  },
};

// ── Flat config export ─────────────────────────────────────────────────────────
/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // ── Global ignores ───────────────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**'],
  },

  // ── Meta TOS guard: promotion paths ─────────────────────────────────────────
  // Applied to every file whose path matches subscriptions/promotion*.
  // This is the static-analysis layer of the defence-in-depth strategy
  // described in Requirement 19.3. The runtime layer lives in
  // promotion.service.ts (emitMetaTosViolationAlert).
  {
    files: ['src/modules/subscriptions/promotion*.ts', 'src/modules/subscriptions/promotion*.js'],
    plugins: {
      'meta-tos': metaTosPlugin,
    },
    rules: {
      'meta-tos/no-instagram-graph-api-in-promotion': 'error',
    },
  },
];
