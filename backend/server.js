// backend/server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const app = express();

// 1. Supabase Client Setup
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

// 2. Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100kb' }));

// 3. Shared IP Rate Limiting (Campus Wi-Fi friendly: 120 req/min per IP)
const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error_code: 'RATE_LIMITED',
        message: 'تم تجاوز حد الطلبات المسموح به مؤقتاً. يرجى الانتظار دقيقة واحدة.'
    }
});
app.use('/api/', limiter);

// 4. Normalization Helpers
function normalizePhone(raw) {
    if (!raw) return '';
    let digits = String(raw).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    digits = digits.replace(/[^\d+]/g, '');

    if (digits.startsWith('00964')) {
        digits = '+964' + digits.slice(5);
    } else if (digits.startsWith('964')) {
        digits = '+964' + digits.slice(3);
    } else if (digits.startsWith('07')) {
        digits = '+964' + digits.slice(1);
    } else if (digits.startsWith('7') && digits.length === 10) {
        digits = '+964' + digits;
    }
    return digits;
}

function normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
}

// ============================================================
// Routes
// ============================================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// GET /api/events/:slug — Event details & live count
app.get('/api/events/:slug', async (req, res) => {
    const slug = req.params.slug || config.DEFAULT_EVENT_SLUG;
    try {
        const { data, error } = await supabase.rpc('get_event_display', { p_event_slug: slug });
        if (error) throw error;
        if (!data || data.error === 'NOT_FOUND') {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }
        res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');
        res.json({ success: true, event: data });
    } catch (err) {
        console.error('Error fetching event display:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch event info' });
    }
});

// POST /api/events/:slug/register — High-throughput atomic registration
app.post('/api/events/:slug/register', async (req, res) => {
    const slug = req.params.slug || config.DEFAULT_EVENT_SLUG;
    const { full_name, phone, email, role_title, workplace, lang } = req.body;

    if (!full_name || !phone || !email) {
        return res.status(400).json({
            success: false,
            message: 'الاسم الكامل، رقم الهاتف، والبريد الإلكتروني مطلوبة'
        });
    }

    const phone_norm = normalizePhone(phone);
    const email_norm = normalizeEmail(email);

    try {
        const { data, error } = await supabase.rpc('register_attendee', {
            p_event_slug: slug,
            p_full_name: String(full_name).trim(),
            p_phone_norm: phone_norm,
            p_email_norm: email_norm,
            p_role_title: String(role_title || '').trim(),
            p_workplace: String(workplace || '').trim(),
            p_lang: lang === 'en' ? 'en' : 'ar'
        });

        if (error) {
            console.error('Database RPC error:', error);
            return res.status(500).json({
                success: false,
                message: 'حدث خطأ في قاعدة البيانات أثناء معالجة التسجيل'
            });
        }

        if (!data.success) {
            const statusCode = data.error_code === 'EVENT_CLOSED' ? 403 : 400;
            return res.status(statusCode).json(data);
        }

        return res.status(200).json(data);

    } catch (err) {
        console.error('Server registration crash:', err);
        return res.status(500).json({
            success: false,
            message: 'خطأ غير متوقع في الخادم'
        });
    }
});

// GET /api/registrations/:id/certificate — Certificate status
app.get('/api/registrations/:id/certificate', async (req, res) => {
    const regId = req.params.id;
    try {
        const { data, error } = await supabase.rpc('get_certificate_status', {
            p_registration_id: regId
        });

        if (error) throw error;
        if (!data || data.status === 'not_found') {
            return res.status(404).json({ success: false, message: 'Certificate not found' });
        }

        res.json({ success: true, certificate: data });
    } catch (err) {
        console.error('Error fetching certificate:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch certificate status' });
    }
});

// Start Server
if (require.main === module) {
    app.listen(config.PORT, () => {
        console.log(`[Event Register Backend] Running on port ${config.PORT}`);
    });
}

module.exports = app;
