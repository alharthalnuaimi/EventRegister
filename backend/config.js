// backend/config.js
require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'YOUR_KEY',
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 120, // 120 req/min per IP
    DEFAULT_EVENT_SLUG: process.env.DEFAULT_EVENT_SLUG || 'ai-lecture-2026'
};

