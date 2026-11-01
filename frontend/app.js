/**
 * أداة تسجيل الفعاليات — Event Register Tool
 * Plain JS · Supabase direct · Arabic-first with EN toggle
 * ──────────────────────────────────────────────────────
 */

/* ============================================================
   التهيئة — Configuration
   ============================================================ */

// Supabase configuration — replace with your actual project values
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';

// Event slug — extracted from URL or defaults
const EVENT_SLUG = new URLSearchParams(window.location.search).get('event') || 'default-event';

// Language state
let currentLang = 'ar';

// Certificate polling
let certPollTimer = null;
let certPollCount = 0;
const CERT_POLL_INTERVAL = 2000; // 2 seconds
const CERT_POLL_MAX = 30;        // 30 × 2s = 60s

/* ============================================================
   Supabase Client (minimal, no SDK needed)
   ============================================================ */
const supabase = {
    headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    },

    async get(table, query = '') {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
            headers: this.headers
        });
        if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
        return res.json();
    },

    async post(table, data) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: { ...this.headers, 'Prefer': 'return=representation,resolution=merge-duplicates' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, ...err };
        }
        return res.json();
    },

    async rpc(fnName, params = {}) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(params)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw { status: res.status, ...err };
        }
        return res.json();
    }
};

/* ============================================================
   التطبيع — Normalization Utilities
   ============================================================ */

/** Convert Arabic/Persian digits ٠-٩ to 0-9 */
function normalizeDigits(str) {
    return str.replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x0660)
              .replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 0x06F0);
}

/** Normalize Iraqi phone to E.164: 07XX... → +9647XX... */
function normalizePhone(raw) {
    let phone = normalizeDigits(raw).replace(/[\s\-\(\)]/g, '');
    // Iraqi mobile: starts with 07
    if (/^07\d{8,9}$/.test(phone)) {
        phone = '+964' + phone.slice(1);
    }
    // Already has country code
    if (/^\+?\d{10,15}$/.test(phone)) {
        if (!phone.startsWith('+')) phone = '+' + phone;
        return phone;
    }
    return phone; // return as-is, validation will catch issues
}

/** Normalize email: trim + lowercase */
function normalizeEmail(raw) {
    return raw.trim().toLowerCase();
}

/* ============================================================
   التحقق — Validation
   ============================================================ */

const validators = {
    fullname: (val) => {
        if (!val.trim()) return currentLang === 'ar' ? 'يرجى إدخال الاسم الكامل' : 'Please enter your full name';
        if (val.trim().length < 3) return currentLang === 'ar' ? 'الاسم قصير جداً' : 'Name is too short';
        return '';
    },
    phone: (val) => {
        if (!val.trim()) return currentLang === 'ar' ? 'يرجى إدخال رقم الهاتف' : 'Please enter your phone number';
        const digits = normalizeDigits(val).replace(/[\s\-\(\)\+]/g, '');
        if (digits.length < 10) return currentLang === 'ar' ? 'رقم الهاتف غير صحيح' : 'Invalid phone number';
        return '';
    },
    email: (val) => {
        if (!val.trim()) return currentLang === 'ar' ? 'يرجى إدخال البريد الإلكتروني' : 'Please enter your email';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return currentLang === 'ar' ? 'البريد الإلكتروني غير صحيح' : 'Invalid email address';
        return '';
    },
    role: (val) => {
        if (!val.trim()) return currentLang === 'ar' ? 'يرجى إدخال المسمى الوظيفي' : 'Please enter your job title';
        if (val.trim().length < 2) return currentLang === 'ar' ? 'المسمى الوظيفي قصير جداً' : 'Job title is too short';
        return '';
    },
    workplace: (val) => {
        if (!val.trim()) return currentLang === 'ar' ? 'يرجى إدخال مكان العمل أو الجامعة' : 'Please enter your workplace or university';
        if (val.trim().length < 2) return currentLang === 'ar' ? 'مكان العمل قصير جداً' : 'Workplace is too short';
        return '';
    },
    consent: (checked) => {
        if (!checked) return currentLang === 'ar' ? 'يرجى الموافقة على تسجيل البيانات' : 'Please consent to data recording';
        return '';
    }
};

function validateField(fieldId) {
    const group = document.getElementById(`group-${fieldId}`);
    const errorEl = document.getElementById(`error-${fieldId}`);
    let value, errorMsg;

    if (fieldId === 'consent') {
        value = document.getElementById('consent').checked;
        errorMsg = validators.consent(value);
    } else {
        value = document.getElementById(fieldId).value;
        errorMsg = validators[fieldId](value);
    }

    if (errorMsg) {
        group.classList.add('has-error');
        group.classList.remove('is-valid');
        errorEl.textContent = errorMsg;
        return false;
    } else {
        group.classList.remove('has-error');
        if (fieldId !== 'consent' && value.trim()) {
            group.classList.add('is-valid');
        }
        errorEl.textContent = '';
        return true;
    }
}

function validateAll() {
    const fields = ['fullname', 'phone', 'email', 'role', 'workplace', 'consent'];
    let allValid = true;
    for (const f of fields) {
        if (!validateField(f)) allValid = false;
    }
    return allValid;
}

/* ============================================================
   تبديل اللغة — Language Toggle
   ============================================================ */

function setLanguage(lang) {
    currentLang = lang;
    const html = document.documentElement;

    if (lang === 'en') {
        html.setAttribute('lang', 'en');
        html.setAttribute('dir', 'ltr');
        document.getElementById('lang-toggle').querySelector('.lang-toggle-text').textContent = 'ع';
        document.getElementById('lang-toggle').setAttribute('aria-label', 'التبديل إلى العربية');
    } else {
        html.setAttribute('lang', 'ar');
        html.setAttribute('dir', 'rtl');
        document.getElementById('lang-toggle').querySelector('.lang-toggle-text').textContent = 'EN';
        document.getElementById('lang-toggle').setAttribute('aria-label', 'Switch to English');
    }

    // Update all data-ar / data-en elements
    document.querySelectorAll('[data-ar][data-en]').forEach(el => {
        el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.en;
    });

    // Update placeholders
    document.querySelectorAll('[data-ar-placeholder][data-en-placeholder]').forEach(el => {
        el.placeholder = lang === 'ar' ? el.dataset.arPlaceholder : el.dataset.enPlaceholder;
    });

    // Re-validate visible errors
    document.querySelectorAll('.form-group.has-error').forEach(group => {
        const fieldId = group.id.replace('group-', '');
        validateField(fieldId);
    });
}

/* ============================================================
   عرض الشاشات — Screen Management
   ============================================================ */

function showScreen(screenId) {
    // Hide form
    const form = document.getElementById('register-form');
    form.style.display = 'none';

    // Hide all result screens
    document.querySelectorAll('.result-screen').forEach(s => s.hidden = true);

    // Show target screen
    const target = document.getElementById(screenId);
    if (target) {
        target.hidden = false;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function showForm() {
    // Show form
    const form = document.getElementById('register-form');
    form.style.display = '';

    // Hide all result screens
    document.querySelectorAll('.result-screen').forEach(s => s.hidden = true);

    // Reset loading state
    const btn = document.getElementById('submit-btn');
    btn.classList.remove('is-loading');
    btn.disabled = false;
}

/* ============================================================
   جلب بيانات الفعالية — Load Event Info
   ============================================================ */

async function loadEventInfo() {
    const display = document.getElementById('event-name-display');
    try {
        const events = await supabase.get('events', `slug=eq.${EVENT_SLUG}&select=name,event_date,is_open,opens_at,closes_at`);

        if (!events || events.length === 0) {
            display.textContent = currentLang === 'ar' ? 'الفعالية غير موجودة' : 'Event not found';
            showScreen('screen-closed');
            return false;
        }

        const event = events[0];
        display.textContent = event.name || EVENT_SLUG;

        // Check if event is open
        const now = new Date();
        const opens = event.opens_at ? new Date(event.opens_at) : null;
        const closes = event.closes_at ? new Date(event.closes_at) : null;
        const isOpen = event.is_open && (!opens || now >= opens) && (!closes || now <= closes);

        if (!isOpen) {
            showScreen('screen-closed');
            return false;
        }

        return true;
    } catch (err) {
        console.error('Failed to load event info:', err);
        // Allow registration even if event check fails (graceful degradation)
        display.textContent = EVENT_SLUG;
        return true;
    }
}

/* ============================================================
   التسجيل — Registration
   ============================================================ */

async function register(formData) {
    const phone_norm = normalizePhone(formData.phone);
    const email_norm = normalizeEmail(formData.email);

    const payload = {
        event_slug: EVENT_SLUG,
        full_name: formData.fullname.trim(),
        phone_norm: phone_norm,
        email_norm: email_norm,
        role_title: formData.role.trim(),
        workplace: formData.workplace.trim(),
        lang: currentLang
    };

    // Try the RPC endpoint first (if backend exposes register function)
    try {
        const result = await supabase.rpc('register_attendance', payload);
        return result;
    } catch (rpcErr) {
        console.warn('RPC register_attendance not available, falling back to direct insert:', rpcErr);
    }

    // Fallback: Direct insert to registrations table
    // First, get event ID
    const events = await supabase.get('events', `slug=eq.${EVENT_SLUG}&select=id`);
    if (!events || events.length === 0) {
        throw { error: 'event_not_found', message: currentLang === 'ar' ? 'الفعالية غير موجودة' : 'Event not found' };
    }
    const eventId = events[0].id;

    // Check for existing registration
    const existing = await supabase.get('registrations',
        `event_id=eq.${eventId}&or=(phone_norm.eq.${encodeURIComponent(phone_norm)},email_norm.eq.${encodeURIComponent(email_norm)})&select=id,kind,volunteer_id`
    );

    if (existing && existing.length > 0) {
        return {
            registration_id: existing[0].id,
            kind: existing[0].kind || 'attendee',
            already_registered: true
        };
    }

    // Check if this person is a volunteer
    const volunteers = await supabase.get('volunteers',
        `event_id=eq.${eventId}&or=(phone_norm.eq.${encodeURIComponent(phone_norm)},email_norm.eq.${encodeURIComponent(email_norm)})&select=id,full_name`
    );

    const isVolunteer = volunteers && volunteers.length > 0;
    const volunteerId = isVolunteer ? volunteers[0].id : null;

    // Insert registration
    const regData = {
        event_id: eventId,
        full_name: payload.full_name,
        phone_norm: phone_norm,
        email_norm: email_norm,
        role_title: payload.role_title,
        workplace: payload.workplace,
        lang: currentLang,
        kind: isVolunteer ? 'volunteer' : 'attendee',
        volunteer_id: volunteerId
    };

    const insertResult = await supabase.post('registrations', regData);
    const registration = Array.isArray(insertResult) ? insertResult[0] : insertResult;

    // If volunteer, create certificate entry
    if (isVolunteer && registration.id) {
        try {
            await supabase.post('certificates', {
                registration_id: registration.id,
                volunteer_id: volunteerId,
                status: 'pending'
            });
        } catch (certErr) {
            // Rule 0: attendance is saved first; certificate is a follow-up
            console.warn('Certificate row creation failed (non-critical):', certErr);
        }
    }

    return {
        registration_id: registration.id,
        kind: isVolunteer ? 'volunteer' : 'attendee',
        already_registered: false
    };
}

/* ============================================================
   استعلام الشهادة — Certificate Polling
   ============================================================ */

function startCertPolling(registrationId) {
    certPollCount = 0;
    const fillEl = document.getElementById('cert-progress-fill');
    const statusEl = document.getElementById('cert-status');
    const downloadEl = document.getElementById('cert-download');
    const emailNote = document.getElementById('cert-email-note');

    certPollTimer = setInterval(async () => {
        certPollCount++;

        // Update progress bar (visual feedback)
        const progress = Math.min((certPollCount / CERT_POLL_MAX) * 100, 95);
        fillEl.style.width = progress + '%';

        try {
            const certs = await supabase.get('certificates',
                `registration_id=eq.${registrationId}&select=status,file_path`
            );

            if (certs && certs.length > 0) {
                const cert = certs[0];

                if (cert.status === 'ready' && cert.file_path) {
                    // Certificate is ready!
                    clearInterval(certPollTimer);
                    fillEl.style.width = '100%';
                    statusEl.textContent = currentLang === 'ar' ? 'الشهادة جاهزة!' : 'Certificate ready!';
                    statusEl.dataset.ar = 'الشهادة جاهزة!';
                    statusEl.dataset.en = 'Certificate ready!';

                    // Build download URL (Supabase Storage signed URL)
                    const downloadUrl = `${SUPABASE_URL}/storage/v1/object/public/certificates/${cert.file_path}`;
                    downloadEl.href = downloadUrl;
                    downloadEl.hidden = false;
                    emailNote.hidden = false;
                    return;
                }

                if (cert.status === 'processing') {
                    statusEl.textContent = currentLang === 'ar' ? 'جارٍ إنشاء الشهادة...' : 'Generating certificate...';
                    statusEl.dataset.ar = 'جارٍ إنشاء الشهادة...';
                    statusEl.dataset.en = 'Generating certificate...';
                }

                if (cert.status === 'failed') {
                    clearInterval(certPollTimer);
                    statusEl.textContent = currentLang === 'ar' ? 'حدث خطأ في إنشاء الشهادة. سيتم إرسالها على بريدك الإلكتروني لاحقاً.' : 'Certificate generation failed. It will be emailed to you later.';
                    statusEl.dataset.ar = 'حدث خطأ في إنشاء الشهادة. سيتم إرسالها على بريدك الإلكتروني لاحقاً.';
                    statusEl.dataset.en = 'Certificate generation failed. It will be emailed to you later.';
                    emailNote.hidden = false;
                    return;
                }
            }
        } catch (err) {
            console.warn('Cert poll error:', err);
        }

        // Timeout: stop polling after 60s
        if (certPollCount >= CERT_POLL_MAX) {
            clearInterval(certPollTimer);
            fillEl.style.width = '100%';
            statusEl.textContent = currentLang === 'ar' ? 'سيتم إرسال الشهادة على بريدك الإلكتروني' : 'The certificate will be sent to your email';
            statusEl.dataset.ar = 'سيتم إرسال الشهادة على بريدك الإلكتروني';
            statusEl.dataset.en = 'The certificate will be sent to your email';
            emailNote.hidden = false;
        }
    }, CERT_POLL_INTERVAL);
}

/* ============================================================
   معالجة الإرسال — Form Submit Handler
   ============================================================ */

async function handleSubmit(e) {
    e.preventDefault();

    if (!validateAll()) {
        // Scroll to first error
        const firstError = document.querySelector('.form-group.has-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const btn = document.getElementById('submit-btn');
    btn.classList.add('is-loading');
    btn.disabled = true;

    const formData = {
        fullname:  document.getElementById('fullname').value,
        phone:     document.getElementById('phone').value,
        email:     document.getElementById('email').value,
        role:      document.getElementById('role').value,
        workplace: document.getElementById('workplace').value
    };

    try {
        const result = await register(formData);

        if (result.already_registered) {
            showScreen('screen-already');
            return;
        }

        if (result.kind === 'volunteer') {
            showScreen('screen-volunteer');
            startCertPolling(result.registration_id);
            return;
        }

        // Attendee success
        const detailsEl = document.getElementById('attendee-details');
        detailsEl.innerHTML = `
            <p><strong>${currentLang === 'ar' ? 'الاسم' : 'Name'}:</strong> ${escapeHtml(formData.fullname)}</p>
            <p><strong>${currentLang === 'ar' ? 'الهاتف' : 'Phone'}:</strong> <span dir="ltr">${escapeHtml(formData.phone)}</span></p>
            <p><strong>${currentLang === 'ar' ? 'البريد' : 'Email'}:</strong> <span dir="ltr">${escapeHtml(formData.email)}</span></p>
            <p><strong>${currentLang === 'ar' ? 'الوظيفة' : 'Job Title'}:</strong> ${escapeHtml(formData.role)}</p>
            <p><strong>${currentLang === 'ar' ? 'مكان العمل' : 'Workplace'}:</strong> ${escapeHtml(formData.workplace)}</p>
        `;
        showScreen('screen-attendee');

    } catch (err) {
        console.error('Registration error:', err);

        const errorMsg = document.getElementById('error-message');
        if (err.error === 'event_closed') {
            showScreen('screen-closed');
        } else if (err.error === 'rate_limited') {
            errorMsg.textContent = currentLang === 'ar' ? 'الكثير من المحاولات. يرجى الانتظار لحظة.' : 'Too many attempts. Please wait a moment.';
            errorMsg.dataset.ar = 'الكثير من المحاولات. يرجى الانتظار لحظة.';
            errorMsg.dataset.en = 'Too many attempts. Please wait a moment.';
            showScreen('screen-error');
        } else {
            const msg = err.message || (currentLang === 'ar' ? 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' : 'An unexpected error occurred. Please try again.');
            errorMsg.textContent = msg;
            showScreen('screen-error');
        }
    } finally {
        btn.classList.remove('is-loading');
        btn.disabled = false;
    }
}

/* ============================================================
   أدوات مساعدة — Utilities
   ============================================================ */

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/* ============================================================
   التهيئة — Initialization
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Detect initial language from browser
    const browserLang = navigator.language || navigator.userLanguage || 'ar';
    if (browserLang.startsWith('en')) {
        setLanguage('en');
    } else {
        setLanguage('ar');
    }

    // Language toggle
    document.getElementById('lang-toggle').addEventListener('click', () => {
        setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });

    // Form submit
    document.getElementById('register-form').addEventListener('submit', handleSubmit);

    // Real-time validation on blur
    ['fullname', 'phone', 'email', 'role', 'workplace'].forEach(fieldId => {
        const input = document.getElementById(fieldId);
        input.addEventListener('blur', () => validateField(fieldId));
        input.addEventListener('input', () => {
            const group = document.getElementById(`group-${fieldId}`);
            if (group.classList.contains('has-error')) {
                validateField(fieldId);
            }
        });
    });

    // Consent checkbox validation
    document.getElementById('consent').addEventListener('change', () => validateField('consent'));

    // Retry button — go back to form with preserved data
    document.getElementById('retry-btn').addEventListener('click', showForm);

    // Load event info
    loadEventInfo();
});
