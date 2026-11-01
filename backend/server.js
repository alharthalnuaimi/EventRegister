// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const app = express();

const isMockMode = !config.SUPABASE_URL || config.SUPABASE_URL.includes('YOUR_PROJECT');

// 1. Supabase Client Setup (Active when real credentials exist)
let supabase = null;
if (!isMockMode) {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
    });
    console.log('[Backend] Connected to live Supabase database');
} else {
    console.log('[Backend] Running in Self-Contained Local Mode (Mock database active for testing)');
}

// 2. In-Memory Mock Store (Active during local offline testing)
const mockStore = {
    events: {
        'ai-lecture-2026': {
            name: 'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
            event_date: '2026-11-02',
            is_open: true,
            total_registrations: 0
        }
    },
    registrations: new Map(), // phone_norm or email_norm -> record
    certificates: new Map()   // reg_id -> cert
};

// 3. Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100kb' }));

// 4. Serve Frontend Static Assets Directly
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// 5. Shared IP Rate Limiting (Campus Wi-Fi friendly: 120 req/min per IP)
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

// 6. Normalization Helpers
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
        mode: isMockMode ? 'local_mock' : 'live_supabase',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// GET /api/events/:slug — Event details & live count
app.get('/api/events/:slug', async (req, res) => {
    const slug = req.params.slug || config.DEFAULT_EVENT_SLUG;

    if (isMockMode) {
        const ev = mockStore.events[slug] || mockStore.events['ai-lecture-2026'];
        res.setHeader('Cache-Control', 'no-cache');
        return res.json({ success: true, event: ev });
    }

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

    // Mock Mode Execution
    if (isMockMode) {
        const key = `${slug}_${phone_norm}`;
        const emailKey = `${slug}_${email_norm}`;

        if (mockStore.registrations.has(key) || mockStore.registrations.has(emailKey)) {
            const existing = mockStore.registrations.get(key) || mockStore.registrations.get(emailKey);
            return res.status(200).json({
                success: true,
                already_registered: true,
                registration_id: existing.id,
                kind: existing.kind,
                serial: existing.serial,
                event_name: 'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
                message: 'أنت مسجل بالفعل في هذه الفعالية'
            });
        }

        const regId = 'reg_' + Math.random().toString(36).substring(2, 10);
        const serial = 'ALF-2026-' + regId.toUpperCase().slice(-6);
        const record = {
            id: regId,
            full_name: String(full_name).trim(),
            phone_norm,
            email_norm,
            role_title: String(role_title || '').trim(),
            workplace: String(workplace || '').trim(),
            lang: lang || 'ar',
            kind: 'attendee',
            serial
        };

        mockStore.registrations.set(key, record);
        mockStore.registrations.set(emailKey, record);

        if (mockStore.events[slug]) {
            mockStore.events[slug].total_registrations++;
        } else {
            mockStore.events['ai-lecture-2026'].total_registrations++;
        }

        mockStore.certificates.set(regId, {
            status: 'ready',
            serial,
            file_path: `${serial}.pdf`
        });

        return res.status(200).json({
            success: true,
            already_registered: false,
            registration_id: regId,
            kind: 'attendee',
            serial,
            event_name: 'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
            message: 'تم التسجيل بنجاح!'
        });
    }

    // Live Supabase RPC Execution
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

    if (isMockMode) {
        const cert = mockStore.certificates.get(regId);
        if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
        return res.json({ success: true, certificate: cert });
    }

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
        console.log(`\n======================================================`);
        console.log(`🚀 [Al-Farabi Event Register Server] LIVE`);
        console.log(`   Local URL:    http://localhost:${config.PORT}`);
        console.log(`   Projector QR: http://localhost:${config.PORT}/display.html`);
        console.log(`   Health Check: http://localhost:${config.PORT}/health`);
        console.log(`======================================================\n`);
    });
}

module.exports = app;
