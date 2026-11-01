/**
 * أداة تسجيل الفعاليات — Event Attendance Tool v3
 * Alfarabi University · Streamlined Attendance (Phone-Only Deduplication)
 * ──────────────────────────────────────────────────────────────────────
 */

const SUPABASE_URL  = window.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = window.SUPABASE_ANON || 'YOUR_ANON_KEY';
const EVENT_SLUG = new URLSearchParams(window.location.search).get('event') || 'ai-lecture-2026';

let currentLang = 'ar';
const TICKET_STORAGE_KEY = `alfarabi_ticket_${EVENT_SLUG}`;
const ALL_TICKETS_KEY = `alfarabi_all_my_tickets_${EVENT_SLUG}`;

/* ============================================================
   شبكة مرنة مع إعادة المحاولة — Resilient Fetch
   ============================================================ */
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 800) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status >= 500 && i < retries - 1) {
                await new Promise(r => setTimeout(r, backoffMs * Math.pow(1.5, i)));
                continue;
            }
            return res;
        } catch (netErr) {
            if (i === retries - 1) throw netErr;
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
   تطبيع رقم الهاتف — Phone Normalization
   ============================================================ */
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

/* ============================================================
   التحقق من صحة المدخلات — Form Validation (No Email)
   ============================================================ */
const validators = {
    fullname(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'الاسم الكامل مطلوب' : 'Full name is required';
        if (val.length < 3) return currentLang === 'ar' ? 'الاسم يجب أن يكون 3 أحرف على الأقل' : 'Name must be at least 3 characters';
        return null;
    },

    phone(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'رقم الهاتف مطلوب' : 'Phone number is required';
        const norm = normalizePhone(val);
        const iraqiPhoneRegex = /^\+9647\d{9}$/;
        const generalPhoneRegex = /^\+\d{8,15}$/;
        if (!iraqiPhoneRegex.test(norm) && !generalPhoneRegex.test(norm)) {
            return currentLang === 'ar' ? 'رقم هاتف غير صحيح (مثال: 07XXXXXXXX)' : 'Invalid phone (e.g. 07XXXXXXXX)';
        }
        return null;
    },

    role(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'المسمى الوظيفي مطلوب' : 'Job title is required';
        return null;
    },

    workplace(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'مكان العمل / الكلية مطلوب' : 'Workplace is required';
        return null;
    },

    consent(checked) {
        if (!checked) return currentLang === 'ar' ? 'يرجى تأكيد الحضور للمتابعة' : 'Confirmation required';
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
        errorEl.textContent = errorMsg;
        return false;
    } else {
        group.classList.remove('has-error');
        errorEl.textContent = '';
        return true;
    }
}

function validateAll() {
    const fields = ['fullname', 'phone', 'role', 'workplace', 'consent'];
    let allValid = true;
    for (const f of fields) {
        if (!validateField(f)) allValid = false;
    }
    return allValid;
}

/* ============================================================
   إدارة التذاكر المحلية — Local Ticket Caching
   ============================================================ */
function saveTicket(ticket) {
    try {
        localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(ticket));
        const all = JSON.parse(localStorage.getItem(ALL_TICKETS_KEY) || '[]');
        if (!all.some(t => t.serial === ticket.serial)) {
            all.push(ticket);
            localStorage.setItem(ALL_TICKETS_KEY, JSON.stringify(all));
        }

        // Add to admin mock store for instant reactivity
        const adminList = JSON.parse(localStorage.getItem('alfarabi_admin_attendees_' + EVENT_SLUG) || '[]');
        if (!adminList.some(a => a.phone === ticket.phone || a.serial === ticket.serial)) {
            adminList.unshift({
                full_name: ticket.full_name,
                phone: ticket.phone,
                role_title: ticket.role,
                workplace: ticket.workplace,
                kind: ticket.kind,
                serial: ticket.serial,
                created_at: new Date().toISOString()
            });
            localStorage.setItem('alfarabi_admin_attendees_' + EVENT_SLUG, JSON.stringify(adminList));
        }
    } catch (e) {}
}

function getSavedTicket() {
    try {
        const item = localStorage.getItem(TICKET_STORAGE_KEY);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        return null;
    }
}

/* ============================================================
   عرض تأكيد الحضور — Render Attendance Confirmation
   ============================================================ */
function renderConfirmation(data) {
    document.getElementById('register-form').style.display = 'none';
    const screen = document.getElementById('screen-confirmed');
    screen.hidden = false;
    screen.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('conf-name').textContent = data.full_name || '—';
    document.getElementById('conf-role').textContent = data.role || '—';
    document.getElementById('conf-workplace').textContent = data.workplace || '—';
    document.getElementById('conf-serial').textContent = data.serial || 'ALF-2026-000000';

    const badgeEl = document.getElementById('confirmed-badge');
    if (data.kind === 'volunteer') {
        badgeEl.textContent = '⭐ متطوع تنظيم معتمد';
        badgeEl.className = 'confirmed-badge confirmed-badge--volunteer';
    } else if (data.already_registered) {
        badgeEl.textContent = 'تم تسجيل حضورك مسبقاً';
        badgeEl.className = 'confirmed-badge confirmed-badge--already';
    } else {
        badgeEl.textContent = 'تم تأكيد الحضور رسمياً';
        badgeEl.className = 'confirmed-badge confirmed-badge--attendee';
    }
}

function showForm() {
    document.getElementById('register-form').style.display = '';
    document.getElementById('screen-confirmed').hidden = true;
    document.getElementById('screen-error').hidden = true;

    const btn = document.getElementById('submit-btn');
    btn.classList.remove('is-loading');
    btn.disabled = false;
}

/* ============================================================
   إرسال تأكيد الحضور — Submit Attendance
   ============================================================ */
async function register(formData) {
    const phone_norm = normalizePhone(formData.phone);

    // 0. Local API server fallback
    if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
        const res = await fetchWithRetry(`/api/events/${encodeURIComponent(EVENT_SLUG)}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: formData.fullname.trim(),
                phone: formData.phone,
                email: '',
                role_title: formData.role.trim(),
                workplace: formData.workplace.trim(),
                lang: currentLang
            })
        });
        const result = await res.json();
        if (!res.ok && !result.already_registered) {
            throw new Error(result.message || 'فشل التسجيل');
        }
        return {
            registration_id: result.registration_id,
            kind: result.kind || 'attendee',
            already_registered: !!result.already_registered,
            serial: result.serial,
            full_name: formData.fullname,
            phone: formData.phone,
            role: formData.role,
            workplace: formData.workplace
        };
    }

    // 1. Direct Supabase Atomic RPC
    const rpcPayload = {
        p_event_slug: EVENT_SLUG,
        p_full_name: formData.fullname.trim(),
        p_phone_norm: phone_norm,
        p_email_norm: '',
        p_role_title: formData.role.trim(),
        p_workplace: formData.workplace.trim(),
        p_lang: currentLang
    };

    const result = await supabase.rpc('register_attendee', rpcPayload);
    if (!result || !result.success) {
        throw new Error(result?.message || 'تعذر تسجيل الحضور');
    }

    return {
        registration_id: result.registration_id,
        kind: result.kind || 'attendee',
        already_registered: !!result.already_registered,
        serial: result.serial,
        full_name: formData.fullname,
        phone: formData.phone,
        role: formData.role,
        workplace: formData.workplace
    };
}

async function handleSubmit(e) {
    e.preventDefault();

    const btn = document.getElementById('submit-btn');
    if (btn.disabled) return;

    if (!validateAll()) {
        const firstError = document.querySelector('.form-group.has-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    btn.classList.add('is-loading');
    btn.disabled = true;

    const formData = {
        fullname:  document.getElementById('fullname').value,
        phone:     document.getElementById('phone').value,
        role:      document.getElementById('role').value,
        workplace: document.getElementById('workplace').value
    };

    try {
        const result = await register(formData);
        saveTicket(result);
        renderConfirmation(result);
    } catch (err) {
        console.error('Registration failed:', err);
        document.getElementById('error-message').textContent = err.message || 'حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('screen-error').hidden = false;
    } finally {
        btn.classList.remove('is-loading');
        btn.disabled = false;
    }
}

/* ============================================================
   بدء التشغيل — Init
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('register-form')?.addEventListener('submit', handleSubmit);
    document.getElementById('retry-btn')?.addEventListener('click', showForm);
    document.getElementById('btn-register-another')?.addEventListener('click', showForm);

    ['fullname', 'phone', 'role', 'workplace'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('blur', () => validateField(id));
        input.addEventListener('input', () => {
            const group = document.getElementById(`group-${id}`);
            if (group && group.classList.contains('has-error')) validateField(id);
        });
    });

    // Check if user already registered on this device
    const saved = getSavedTicket();
    if (saved && saved.full_name) {
        renderConfirmation(saved);
    }
});
