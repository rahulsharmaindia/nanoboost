# Instagram Insights — Server

Express.js backend that handles Instagram OAuth and proxies the Instagram Graph API.

## Setup

```bash
npm install
```

## Environment Variables

| Variable | Description |
|---|---|
| `INSTAGRAM_APP_ID` | Your Instagram/Meta app ID |
| `INSTAGRAM_APP_SECRET` | Your Instagram/Meta app secret |
| `REDIRECT_URI` | OAuth callback URL (e.g. `https://your-server.com/auth/callback`) |
| `PORT` | Server port (default: 3000) |

## Run

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

## Project Structure

```
server/
├── server.js              # Entry point
└── src/
    ├── app.js             # Express setup + route mounting
    ├── config.js          # Environment variables
    ├── middleware/auth.js  # Auth guard middleware
    ├── routes/
    │   ├── auth.js        # OAuth flow
    │   ├── profile.js     # Profile + media
    │   └── insights.js    # Analytics + demographics
    ├── services/
    │   ├── session.js     # In-memory session store
    │   └── instagram.js   # Instagram API calls
    └── utils/html.js      # HTML templates
```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |
| GET | `/api/auth/start` | No | Start OAuth, returns session ID + auth URL |
| GET | `/auth/callback` | No | Instagram OAuth redirect target |
| GET | `/api/auth/status?session_id=` | No | Poll auth completion |
| GET | `/api/auth/logout` | No | Clear session |
| GET | `/api/profile` | Yes | User profile |
| GET | `/api/media` | Yes | User media list |
| GET | `/api/media/insights?media_id=` | Yes | Per-post insights |
| GET | `/api/insights/overview` | Yes | 30-day account overview |
| GET | `/api/insights/reach-media` | Yes | Reach by media type |
| GET | `/api/insights/reach-follower` | Yes | Reach by follower status |
| GET | `/api/insights/views-media` | Yes | Views by media type |
| GET | `/api/insights/follows` | Yes | Follows/unfollows |
| GET | `/api/insights/profile-taps` | Yes | Profile link taps |
| GET | `/api/insights/demographics/:breakdown` | Yes | Follower demographics |
| GET | `/api/insights/engaged/:breakdown` | Yes | Engaged audience demographics |

Auth is via `session_id` query param or `Authorization: Bearer <session_id>` header.
