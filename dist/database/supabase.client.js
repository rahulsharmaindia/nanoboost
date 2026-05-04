"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseAdminClient = getSupabaseAdminClient;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
let _supabase = null;
function getSupabaseAdminClient() {
    if (!env_1.env.supabaseUrl || !env_1.env.supabaseServiceRoleKey) {
        return null;
    }
    if (!_supabase) {
        _supabase = (0, supabase_js_1.createClient)(env_1.env.supabaseUrl, env_1.env.supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
    }
    return _supabase;
}
//# sourceMappingURL=supabase.client.js.map