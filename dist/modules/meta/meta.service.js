"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MetaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaService = void 0;
const common_1 = require("@nestjs/common");
const env_1 = require("../../config/env");
const app_errors_1 = require("../../common/errors/app.errors");
const API_BASE = `https://graph.instagram.com/${env_1.env.instagramApiVersion}`;
let MetaService = MetaService_1 = class MetaService {
    constructor() {
        this.logger = new common_1.Logger(MetaService_1.name);
    }
    async fetchJSON(url) {
        const res = await fetch(url);
        const data = await res.json();
        return data;
    }
    async postForm(url, params) {
        const body = new URLSearchParams(params).toString();
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        return res.json();
    }
    async exchangeCodeForToken(code) {
        return this.postForm('https://api.instagram.com/oauth/access_token', {
            client_id: env_1.env.instagramAppId,
            client_secret: env_1.env.instagramAppSecret,
            grant_type: 'authorization_code',
            redirect_uri: env_1.env.redirectUri,
            code,
        });
    }
    async getUserId(token) {
        const encode = encodeURIComponent;
        const me = await this.fetchJSON(`${API_BASE}/me?fields=user_id&access_token=${encode(token)}`);
        return me.user_id || me.id;
    }
    async getUserProfile(token) {
        const encode = encodeURIComponent;
        const fields = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography';
        const data = await this.fetchJSON(`${API_BASE}/me?fields=${fields}&access_token=${encode(token)}`);
        if (data.error) {
            throw new app_errors_1.ProviderError(data.error.message || 'Instagram API error');
        }
        return data;
    }
    async getUserMedia(token) {
        const encode = encodeURIComponent;
        const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
        const data = await this.fetchJSON(`${API_BASE}/me/media?fields=${fields}&access_token=${encode(token)}`);
        if (data.error) {
            throw new app_errors_1.ProviderError(data.error.message || 'Instagram API error');
        }
        return data;
    }
    async getMediaInsights(token, mediaId) {
        const encode = encodeURIComponent;
        const metrics = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
        const data = await this.fetchJSON(`${API_BASE}/${mediaId}/insights?metric=${metrics}&locale=en_US&access_token=${encode(token)}`);
        if (data.error) {
            throw new app_errors_1.ProviderError(data.error.message || 'Instagram API error');
        }
        return data;
    }
    async getAccountInsights(token, query) {
        const encode = encodeURIComponent;
        const userId = await this.getUserId(token);
        const since = Math.floor(Date.now() / 1000) - 30 * 86400;
        const until = Math.floor(Date.now() / 1000);
        const data = await this.fetchJSON(`${API_BASE}/${userId}/insights?${query}&since=${since}&until=${until}&locale=en_US&access_token=${encode(token)}`);
        if (data.error) {
            throw new app_errors_1.ProviderError(data.error.message || 'Instagram API error');
        }
        return data;
    }
    async getDemographicInsights(token, metric, breakdown) {
        const encode = encodeURIComponent;
        const userId = await this.getUserId(token);
        const data = await this.fetchJSON(`${API_BASE}/${userId}/insights?metric=${metric}&period=lifetime&timeframe=this_month&breakdown=${breakdown}&metric_type=total_value&locale=en_US&access_token=${encode(token)}`);
        if (data.error) {
            throw new app_errors_1.ProviderError(data.error.message || 'Instagram API error');
        }
        return data;
    }
    async getBasicProfile(token) {
        const encode = encodeURIComponent;
        try {
            const data = await this.fetchJSON(`${API_BASE}/me?fields=username,followers_count&access_token=${encode(token)}`);
            return {
                username: data.username || 'unknown',
                followerCount: data.followers_count || 0,
            };
        }
        catch {
            return { username: 'unknown', followerCount: 0 };
        }
    }
};
exports.MetaService = MetaService;
exports.MetaService = MetaService = MetaService_1 = __decorate([
    (0, common_1.Injectable)()
], MetaService);
//# sourceMappingURL=meta.service.js.map