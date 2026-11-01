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
            total_registrations: 0,
            total_volunteers: 0
        }
    },
    volunteers: new Map([
        ['+9647701234567', { full_name: 'أحمد علي', role_title: 'منسق قاعة بابل' }]
    ]),
    registrations: new Map() // key -> record
};

// 3. Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '200kb' }));

// 4. Serve Frontend Static Assets Directly
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Clean URL routes
app.get('/admin', (req, res) => res.sendFile(path.join(frontendPath, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(frontendPath, 'display.html')));

// 5. Shared IP Rate Limiting (Campus Wi-Fi friendly: 1500 req/min for auditorium NAT)
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1500, // Elevated to prevent campus Wi-Fi blocking
    standardHeaders: true,
    legacyHeaders: false
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

    if (!full_name || !phone) {
        return res.status(400).json({
            success: false,
            message: 'الاسم الكامل ورقم الهاتف مطلوبان'
        });
    }

    const phone_norm = normalizePhone(phone);
    const email_norm = email ? normalizeEmail(email) : '';

    // Mock Mode Execution
    if (isMockMode) {
        const key = `${slug}_${phone_norm}`;

        // Deduplication check strictly on phone
        if (mockStore.registrations.has(key)) {
            const existing = mockStore.registrations.get(key);
            return res.status(200).json({
                success: true,
                already_registered: true,
                registration_id: existing.id,
                kind: existing.kind,
                serial: existing.serial,
                full_name: existing.full_name,
                event_name: 'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
                message: 'أنت مسجل بالفعل في هذه الفعالية'
            });
        }

        const isVol = mockStore.volunteers.has(phone_norm);
        const regId = 'reg_' + Math.random().toString(36).substring(2, 8);
        const serial = 'ALF-2026-' + regId.toUpperCase().slice(-6);

        const record = {
            id: regId,
            full_name: String(full_name).trim(),
            phone: phone_norm,
            email: email_norm,
            role_title: String(role_title || '').trim(),
            workplace: String(workplace || '').trim(),
            lang: lang || 'ar',
            kind: isVol ? 'volunteer' : 'attendee',
            serial,
            created_at: new Date().toISOString()
        };

        mockStore.registrations.set(key, record);

        if (mockStore.events[slug]) {
            mockStore.events[slug].total_registrations++;
            if (isVol) mockStore.events[slug].total_volunteers++;
        }

        return res.status(200).json({
            success: true,
            already_registered: false,
            registration_id: regId,
            kind: isVol ? 'volunteer' : 'attendee',
            serial,
            full_name: record.full_name,
            event_name: 'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
            message: 'تم تسجيل الحضور بنجاح!'
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

        return res.status(200).json(data);
    } catch (err) {
        console.error('Server registration crash:', err);
        return res.status(500).json({
            success: false,
            message: 'خطأ غير متوقع في الخادم'
        });
    }
});

// Restart or Start Server
if (require.main === module) {
    app.listen(config.PORT, () => {
        console.log(`\n======================================================`);
        console.log(`[Al-Farabi Event Register Server] LIVE`);
        console.log(`   Registration: http://localhost:${config.PORT}`);
        console.log(`   Admin Dash:   http://localhost:${config.PORT}/admin`);
        console.log(`   Projector QR: http://localhost:${config.PORT}/display`);
        console.log(`   Health Check: http://localhost:${config.PORT}/health`);
        console.log(`======================================================\n`);
    });
}

module.exports = app;
