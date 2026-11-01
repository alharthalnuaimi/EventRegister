/**
 * أداة تسجيل الفعاليات — Event Register Tool
 * High-Concurrency Frontend · Supabase & RPC Optimized · 500+ Users Ready
 * ──────────────────────────────────────────────────────────────────────────
 */

/* ============================================================
   التهيئة — Configuration
   ============================================================ */

// Supabase configuration
const SUPABASE_URL  = window.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = window.SUPABASE_ANON || 'YOUR_ANON_KEY';

// Event slug — defaults to tomorrow's AI lecture at Al-Farabi University
const EVENT_SLUG = new URLSearchParams(window.location.search).get('event') || 'ai-lecture-2026';

// Language state
let currentLang = 'ar';

// Certificate polling state
let certPollTimeout = null;
let certPollAttempt = 0;
const CERT_POLL_MAX_ATTEMPTS = 15;

/* ============================================================
   شبكة مرنة مع إعادة المحاولة — Resilient Fetch with Retry
   ============================================================ */
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status >= 500 && i < retries - 1) {
                // Server error, wait and retry
                await new Promise(r => setTimeout(r, backoffMs * Math.pow(1.5, i)));
                continue;
            }
            return res;
        } catch (netErr) {
            if (i === retries - 1) throw netErr;
            // Network failure / packet loss (common in crowded auditoriums)
            await new Promise(r => setTimeout(r, backoffMs * Math.pow(1.5, i)));
        }
    }
}

/* ============================================================
   عميل Supabase المباشر — Supabase Client
   ============================================================ */
const supabase = {
    get headers() {
        return {
            'apikey': SUPABASE_ANON,
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        };
    },

    async get(table, query = '') {
        const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
            headers: this.headers
        });
        if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
        return res.json();
    },

    async post(table, data) {
        const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/${table}`, {
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
        const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
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
   تطبيع البيانات — Normalization
   ============================================================ */

function normalizePhone(raw) {
    if (!raw) return '';
    let digits = raw.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
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
    return (raw || '').trim().toLowerCase();
}

/* ============================================================
   التحقق من صحة المدخلات — Form Validation
   ============================================================ */

const validators = {
    fullname(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'الاسم الكامل مطلوب' : 'Full name is required';
        if (val.length < 3) return currentLang === 'ar' ? 'الاسم يجب أن يكون 3 أحرف على الأقل' : 'Name must be at least 3 characters';
        if (val.length > 100) return currentLang === 'ar' ? 'الاسم طويل جداً (الحد الأقصى 100 حرف)' : 'Name too long (max 100)';
        return null;
    },

    phone(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'رقم الهاتف مطلوب' : 'Phone number is required';
        const norm = normalizePhone(val);
        const iraqiPhoneRegex = /^\+9647\d{9}$/;
        const generalPhoneRegex = /^\+\d{8,15}$/;
        if (!iraqiPhoneRegex.test(norm) && !generalPhoneRegex.test(norm)) {
            return currentLang === 'ar'
                ? 'رقم هاتف غير صحيح (مثال: 07XXXXXXXX)'
                : 'Invalid phone number (e.g. 07XXXXXXXX)';
        }
        return null;
    },

    email(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'البريد الإلكتروني مطلوب' : 'Email is required';
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
            return currentLang === 'ar'
                ? 'صيغة بريد إلكتروني غير صحيحة'
                : 'Invalid email address format';
        }
        return null;
    },

    role(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'المسمى الوظيفي مطلوب' : 'Job title is required';
        if (val.length < 2) return currentLang === 'ar' ? 'المسمى الوظيفي قصير جداً' : 'Job title too short';
        return null;
    },

    workplace(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'مكان العمل / الجامعة مطلوب' : 'Workplace is required';
        if (val.length < 2) return currentLang === 'ar' ? 'مكان العمل قصير جداً' : 'Workplace too short';
        return null;
    },

    consent(checked) {
        if (!checked) return currentLang === 'ar' ? 'يجب الموافقة للمتابعة' : 'Consent is required';
        return null;
    }
};

function validateField(fieldId) {
    const input = document.getElementById(fieldId);
    const errorEl = document.getElementById(`error-${fieldId}`);
    const group = document.getElementById(`group-${fieldId}`);
    if (!input || !errorEl || !group) return true;

    let errorMsg = null;
    let value = input.value;
    if (fieldId === 'consent') {
        errorMsg = validators.consent(input.checked);
    } else if (validators[fieldId]) {
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

    document.querySelectorAll('[data-ar][data-en]').forEach(el => {
        el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.en;
    });

    document.querySelectorAll('[data-ar-placeholder][data-en-placeholder]').forEach(el => {
        el.placeholder = lang === 'ar' ? el.dataset.arPlaceholder : el.dataset.enPlaceholder;
    });
}

/* ============================================================
   إدارة الشاشات والتذاكر — Screens & Local Caching
   ============================================================ */

const TICKET_STORAGE_KEY = `alfarabi_ticket_${EVENT_SLUG}`;

function saveLocalTicket(data) {
    try {
        localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

function getLocalTicket() {
    try {
        const item = localStorage.getItem(TICKET_STORAGE_KEY);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        return null;
    }
}

function clearLocalTicket() {
    try {
        localStorage.removeItem(TICKET_STORAGE_KEY);
    } catch (e) {}
}

function showScreen(screenId) {
    const form = document.getElementById('register-form');
    form.style.display = 'none';
    document.querySelectorAll('.result-screen').forEach(s => s.hidden = true);

    const target = document.getElementById(screenId);
    if (target) {
        target.hidden = false;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function showForm() {
    const form = document.getElementById('register-form');
    form.style.display = '';
    document.querySelectorAll('.result-screen').forEach(s => s.hidden = true);

    const btn = document.getElementById('submit-btn');
    btn.classList.remove('is-loading');
    btn.disabled = false;
}

function renderAttendeeSuccess(data) {
    const detailsEl = document.getElementById('attendee-details');
    detailsEl.innerHTML = `
        <div class="ticket-card">
            <div class="ticket-badge">${data.kind === 'volunteer' ? '⭐ متطوع / Volunteer' : '🎟️ بطاقة حضور / Attendee Pass'}</div>
            <p><strong>${currentLang === 'ar' ? 'الاسم' : 'Name'}:</strong> ${escapeHtml(data.full_name)}</p>
            <p><strong>${currentLang === 'ar' ? 'الهاتف' : 'Phone'}:</strong> <span dir="ltr">${escapeHtml(data.phone)}</span></p>
            <p><strong>${currentLang === 'ar' ? 'البريد' : 'Email'}:</strong> <span dir="ltr">${escapeHtml(data.email)}</span></p>
            <p><strong>${currentLang === 'ar' ? 'الوظيفة' : 'Role'}:</strong> ${escapeHtml(data.role)}</p>
            <p><strong>${currentLang === 'ar' ? 'مكان العمل' : 'Workplace'}:</strong> ${escapeHtml(data.workplace)}</p>
            ${data.serial ? `<p class="ticket-serial"><strong>${currentLang === 'ar' ? 'رقم القيد' : 'Serial'}:</strong> <code>${data.serial}</code></p>` : ''}
        </div>
        <div class="ticket-actions">
            <button type="button" class="switch-user-btn" id="register-another-btn">
                ${currentLang === 'ar' ? 'تسجيل شخص آخر' : 'Register another person'}
            </button>
        </div>
    `;

    document.getElementById('register-another-btn')?.addEventListener('click', () => {
        clearLocalTicket();
        showForm();
    });

    if (data.kind === 'volunteer') {
        showScreen('screen-volunteer');
        if (data.registration_id) {
            startCertPolling(data.registration_id);
        }
    } else {
        showScreen('screen-attendee');
    }
}

/* ============================================================
   جلب بيانات الفعالية — Load Event Info
   ============================================================ */

async function loadEventInfo() {
    const display = document.getElementById('event-name-display');
    try {
        const events = await supabase.get('events', `slug=eq.${EVENT_SLUG}&select=name,event_date,is_open,opens_at,closes_at`);

        if (!events || events.length === 0) {
            display.textContent = currentLang === 'ar' ? 'محاضرة: AI Is Not As We Know It' : 'AI Is Not As We Know It';
            return true;
        }

        const event = events[0];
        display.textContent = event.name || EVENT_SLUG;

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
        console.warn('Event info load fallback:', err);
        display.textContent = 'محاضرة: AI Is Not As We Know It — أ.د. ضياء الجميلي';
        return true;
    }
}

/* ============================================================
   إرسال التسجيل عالي التزامن — Atomic Registration (500+ Burst)
   ============================================================ */

async function register(formData) {
    const phone_norm = normalizePhone(formData.phone);
    const email_norm = normalizeEmail(formData.email);

    // 1. Try atomic PostgreSQL RPC first (Single round-trip, zero race condition)
    try {
        const rpcPayload = {
            p_event_slug: EVENT_SLUG,
            p_full_name: formData.fullname.trim(),
            p_phone_norm: phone_norm,
            p_email_norm: email_norm,
            p_role_title: formData.role.trim(),
            p_workplace: formData.workplace.trim(),
            p_lang: currentLang
        };

        const result = await supabase.rpc('register_attendee', rpcPayload);
        if (result && result.success) {
            return {
                registration_id: result.registration_id,
                kind: result.kind || 'attendee',
                already_registered: !!result.already_registered,
                serial: result.serial,
                full_name: formData.fullname,
                phone: formData.phone,
                email: formData.email,
                role: formData.role,
                workplace: formData.workplace
            };
        }
    } catch (rpcErr) {
        console.warn('RPC register_attendee fallback to direct table insert:', rpcErr);
    }

    // 2. Fallback: Direct table operations
    const events = await supabase.get('events', `slug=eq.${EVENT_SLUG}&select=id`);
    if (!events || events.length === 0) {
        throw { error: 'event_not_found', message: currentLang === 'ar' ? 'الفعالية غير موجودة' : 'Event not found' };
    }
    const eventId = events[0].id;

    // Check existing
    const existing = await supabase.get('registrations',
        `event_id=eq.${eventId}&or=(phone_norm.eq.${encodeURIComponent(phone_norm)},email_norm.eq.${encodeURIComponent(email_norm)})&select=id,kind`
    );

    if (existing && existing.length > 0) {
        return {
            registration_id: existing[0].id,
            kind: existing[0].kind || 'attendee',
            already_registered: true,
            full_name: formData.fullname,
            phone: formData.phone,
            email: formData.email,
            role: formData.role,
            workplace: formData.workplace
        };
    }

    // Insert
    const regData = {
        event_id: eventId,
        full_name: formData.fullname.trim(),
        phone_norm: phone_norm,
        email_norm: email_norm,
        role_title: formData.role.trim(),
        workplace: formData.workplace.trim(),
        lang: currentLang,
        kind: 'attendee'
    };

    const insertResult = await supabase.post('registrations', regData);
    const registration = Array.isArray(insertResult) ? insertResult[0] : insertResult;

    return {
        registration_id: registration.id,
        kind: registration.kind || 'attendee',
        already_registered: false,
        full_name: formData.fullname,
        phone: formData.phone,
        email: formData.email,
        role: formData.role,
        workplace: formData.workplace
    };
}

/* ============================================================
   استعلام الشهادة المتدرج — Jittered Polling (No Thundering Herd)
   ============================================================ */

function startCertPolling(registrationId) {
    if (certPollTimeout) clearTimeout(certPollTimeout);
    certPollAttempt = 0;

    const fillEl = document.getElementById('cert-progress-fill');
    const statusEl = document.getElementById('cert-status');
    const downloadEl = document.getElementById('cert-download');
    const emailNote = document.getElementById('cert-email-note');

    async function poll() {
        certPollAttempt++;
        const progress = Math.min((certPollAttempt / CERT_POLL_MAX_ATTEMPTS) * 100, 95);
        if (fillEl) fillEl.style.width = progress + '%';

        try {
            // Use lightweight RPC check
            let cert = null;
            try {
                const statusRes = await supabase.rpc('get_certificate_status', { p_registration_id: registrationId });
                if (statusRes && statusRes.status && statusRes.status !== 'not_found') {
                    cert = statusRes;
                }
            } catch (rpcCheckErr) {
                const certs = await supabase.get('certificates', `registration_id=eq.${registrationId}&select=status,file_path`);
                if (certs && certs.length > 0) cert = certs[0];
            }

            if (cert) {
                if (cert.status === 'ready' && cert.file_path) {
                    if (fillEl) fillEl.style.width = '100%';
                    statusEl.textContent = currentLang === 'ar' ? 'الشهادة جاهزة للتحميل!' : 'Certificate ready for download!';
                    const downloadUrl = cert.file_path.startsWith('http')
                        ? cert.file_path
                        : `${SUPABASE_URL}/storage/v1/object/public/certificates/${cert.file_path}`;
                    downloadEl.href = downloadUrl;
                    downloadEl.hidden = false;
                    emailNote.hidden = false;
                    return; // Done!
                }
                if (cert.status === 'failed') {
                    statusEl.textContent = currentLang === 'ar'
                        ? 'سيتم إرسال الشهادة على بريدك الإلكتروني لاحقاً'
                        : 'Your certificate will be emailed to you later';
                    emailNote.hidden = false;
                    return;
                }
            }
        } catch (pollErr) {
            console.warn('Poll error, will retry:', pollErr);
        }

        if (certPollAttempt >= CERT_POLL_MAX_ATTEMPTS) {
            if (fillEl) fillEl.style.width = '100%';
            statusEl.textContent = currentLang === 'ar'
                ? 'تم تسجيل طلب الشهادة وسيتم إرسالها إلى بريدك الإلكتروني'
                : 'Certificate request queued; it will be emailed to you';
            emailNote.hidden = false;
            return;
        }

        // Exponential backoff + random jitter between 0-2000ms
        const nextDelay = Math.min(3000 * Math.pow(1.3, certPollAttempt), 12000) + Math.random() * 2000;
        certPollTimeout = setTimeout(poll, nextDelay);
    }

    // First poll after 3s
    certPollTimeout = setTimeout(poll, 3000);
}

/* ============================================================
   معالجة نموذج التسجيل — Form Submit Handler
   ============================================================ */

async function handleSubmit(e) {
    e.preventDefault();

    const btn = document.getElementById('submit-btn');
    if (btn.disabled) return; // Prevent double-tap

    if (!validateAll()) {
        const firstError = document.querySelector('.form-group.has-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Lock button immediately
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

        // Cache confirmed ticket in localStorage
        saveLocalTicket(result);

        if (result.already_registered) {
            renderAttendeeSuccess(result);
            showScreen('screen-already');
            return;
        }

        renderAttendeeSuccess(result);

    } catch (err) {
        console.error('Registration error:', err);
        const errorMsg = document.getElementById('error-message');
        const msg = err.message || (currentLang === 'ar' ? 'حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.' : 'Connection error. Please try again.');
        errorMsg.textContent = msg;
        showScreen('screen-error');
    } finally {
        btn.classList.remove('is-loading');
        btn.disabled = false;
    }
}

/* ============================================================
   أدوات مساعدة — Utilities
   ============================================================ */

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/* ============================================================
   بدء التشغيل — Startup
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Detect language
    const browserLang = navigator.language || navigator.userLanguage || 'ar';
    setLanguage(browserLang.startsWith('en') ? 'en' : 'ar');

    document.getElementById('lang-toggle')?.addEventListener('click', () => {
        setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });

    document.getElementById('register-form')?.addEventListener('submit', handleSubmit);

    // Real-time validation
    ['fullname', 'phone', 'email', 'role', 'workplace'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('blur', () => validateField(id));
        input.addEventListener('input', () => {
            const group = document.getElementById(`group-${id}`);
            if (group && group.classList.contains('has-error')) validateField(id);
        });
    });

    document.getElementById('consent')?.addEventListener('change', () => validateField('consent'));
    document.getElementById('retry-btn')?.addEventListener('click', showForm);

    // Check if attendee is already registered locally
    const savedTicket = getLocalTicket();
    if (savedTicket && savedTicket.full_name) {
        renderAttendeeSuccess(savedTicket);
    } else {
        loadEventInfo();
    }
});
