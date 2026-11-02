/**
 * Al Farabi University — Event Attendance Engine
 * Clean, fast, phone-deduplicated attendance logging
 */

const SUPABASE_URL  = (typeof window !== 'undefined' && window.SUPABASE_URL) ? window.SUPABASE_URL : 'https://vcpbxcnweqbmkxhqunxu.supabase.co';
const SUPABASE_ANON = (typeof window !== 'undefined' && window.SUPABASE_ANON) ? window.SUPABASE_ANON : 'sb_publishable_m0z1EoUWsULqo05YJnSzyg_VqoyixMS';
const EVENT_SLUG = new URLSearchParams(window.location.search).get('event') || 'ai-lecture-2026';

let currentLang = 'ar';
const STORAGE_KEY = `alfarabi_pass_${EVENT_SLUG}`;

/* ============================================================
   Resilient Network Transport
   ============================================================ */
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 600) {
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
   Phone Normalization (E.164 Iraqi)
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
   Validation
   ============================================================ */
const validators = {
    fullname(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'يرجى إدخال الاسم الرباعي' : 'Full name is required';
        if (val.length < 3) return currentLang === 'ar' ? 'الاسم يجب ألا يقل عن 3 أحرف' : 'Name must be at least 3 characters';
        return null;
    },

    phone(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'يرجى إدخال رقم الهاتف' : 'Phone number is required';
        const norm = normalizePhone(val);
        const iraqiPhone = /^\+9647\d{9}$/;
        if (!iraqiPhone.test(norm)) {
            return currentLang === 'ar' ? 'صيغة رقم غير صحيحة (07XXXXXXXX)' : 'Invalid phone number format';
        }
        return null;
    },

    role(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'يرجى تدوين المسمى أو الصفة' : 'Role or title is required';
        return null;
    },

    workplace(val) {
        val = (val || '').trim();
        if (!val) return currentLang === 'ar' ? 'يرجى تدوين الكلية أو جهة العمل' : 'Institution is required';
        return null;
    },

    consent(checked) {
        if (!checked) return currentLang === 'ar' ? 'يرجى تأكيد الحضور للمتابعة' : 'Confirmation required';
        return null;
    }
};

function validateField(name) {
    const inp = document.getElementById(`inp-${name}`);
    const msg = document.getElementById(`msg-${name}`);
    const grp = document.getElementById(`grp-${name}`);
    if (!inp || !msg || !grp) return true;

    let err = null;
    if (name === 'consent') {
        err = validators.consent(inp.checked);
    } else if (validators[name]) {
        err = validators[name](inp.value);
    }

    if (err) {
        grp.classList.add('has-error');
        msg.textContent = err;
        return false;
    } else {
        grp.classList.remove('has-error');
        msg.textContent = '';
        return true;
    }
}

function validateAll() {
    const fields = ['fullname', 'phone', 'role', 'workplace', 'consent'];
    let valid = true;
    for (const f of fields) {
        if (!validateField(f)) valid = false;
    }
    return valid;
}

/* ============================================================
   Language Switching
   ============================================================ */
function setLanguage(lang) {
    currentLang = lang;
    const html = document.documentElement;

    if (lang === 'en') {
        html.setAttribute('lang', 'en');
        html.setAttribute('dir', 'ltr');
        document.getElementById('langSwitchText').textContent = 'ع';
    } else {
        html.setAttribute('lang', 'ar');
        html.setAttribute('dir', 'rtl');
        document.getElementById('langSwitchText').textContent = 'EN';
    }

    document.querySelectorAll('[data-ar][data-en]').forEach(el => {
        el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.en;
    });

    document.querySelectorAll('[data-ar-placeholder][data-en-placeholder]').forEach(el => {
        el.placeholder = lang === 'ar' ? el.dataset.arPlaceholder : el.dataset.enPlaceholder;
    });
}

/* ============================================================
   Confirmation View & Local Cache
   ============================================================ */
function showConfirmation(record) {
    document.getElementById('attendanceForm').style.display = 'none';
    const conf = document.getElementById('confirmScreen');
    conf.hidden = false;
    conf.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('res-name').textContent = record.full_name || '—';
    document.getElementById('res-role').textContent = record.role || '—';
    document.getElementById('res-workplace').textContent = record.workplace || '—';
    document.getElementById('res-serial').textContent = record.serial || 'ALF-2026-000000';

    const pill = document.getElementById('confirmStatusPill');
    const pillTxt = document.getElementById('confirmStatusText');

    if (record.kind === 'volunteer') {
        pill.className = 'confirm-pill confirm-pill--volunteer';
        pillTxt.textContent = currentLang === 'ar' ? 'عضو معتمد — تم توثيق الهوية برقم الهاتف' : 'Official Organizing Team';
    } else if (record.already_registered) {
        pill.className = 'confirm-pill confirm-pill--already';
        pillTxt.textContent = currentLang === 'ar' ? 'تم تسجيل حضورك مسبقاً' : 'Already Recorded';
    } else {
        pill.className = 'confirm-pill confirm-pill--attendee';
        pillTxt.textContent = currentLang === 'ar' ? 'تم توثيق الحضور رسمياً' : 'Attendance Formally Recorded';
    }
}

function showForm() {
    document.getElementById('attendanceForm').style.display = '';
    document.getElementById('confirmScreen').hidden = true;
    document.getElementById('errorScreen').hidden = true;

    const btn = document.getElementById('btnSubmit');
    btn.classList.remove('is-loading');
    btn.disabled = false;
}

/* ============================================================
   Registration API
   ============================================================ */
async function registerAttendance(formData) {
    const phone_norm = normalizePhone(formData.phone);

    // 1. Local backend / server mode (ONLY on localhost when Supabase is deliberately unconfigured)
    const isLocalServer = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) && (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT'));

    if (isLocalServer) {
        const res = await fetchWithRetry(`/api/events/${encodeURIComponent(EVENT_SLUG)}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: formData.fullname.trim(),
                phone: formData.phone,
                role_title: formData.role.trim(),
                workplace: formData.workplace.trim(),
                lang: currentLang
            })
        });
        const text = await res.text();
        let result = {};
        try {
            result = JSON.parse(text);
        } catch (e) {
            throw new Error(currentLang === 'ar' ? 'تعذر الاتصال بالخادم المحلي.' : 'Local server communication failed.');
        }
        if (!res.ok && !result.already_registered) {
            throw new Error(result.message || (currentLang === 'ar' ? 'تعذر إتمام التسجيل' : 'Registration failed'));
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

    // 2. Direct Supabase Atomic RPC
    const rpcPayload = {
        p_event_slug: EVENT_SLUG,
        p_full_name: formData.fullname.trim(),
        p_phone_norm: phone_norm,
        p_email_norm: '',
        p_role_title: formData.role.trim(),
        p_workplace: formData.workplace.trim(),
        p_lang: currentLang
    };

    const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/register_attendee`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(rpcPayload)
    });

    const text = await res.text();
    let result = {};
    try {
        result = JSON.parse(text);
    } catch (parseErr) {
        console.error('Non-JSON server response:', text);
        throw new Error(currentLang === 'ar' 
            ? 'تعذر توثيق الحضور حالياً بسبب ضغط الاتصال. يرجى إعادة المحاولة بعد لحظات.' 
            : 'Service temporarily busy. Please retry in a few moments.');
    }

    if (!res.ok || !result.success) {
        throw new Error(result?.message || (currentLang === 'ar' ? 'تعذر إتمام التسجيل' : 'Registration failed'));
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

/* ============================================================
   Event Listeners
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    // Detect system lang
    const navLang = navigator.language || navigator.userLanguage || 'ar';
    setLanguage(navLang.startsWith('en') ? 'en' : 'ar');

    document.getElementById('langToggle')?.addEventListener('click', () => {
        setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });

    document.getElementById('btnRepeat')?.addEventListener('click', showForm);
    document.getElementById('btnRetry')?.addEventListener('click', showForm);

    ['fullname', 'phone', 'role', 'workplace'].forEach(name => {
        const inp = document.getElementById(`inp-${name}`);
        if (!inp) return;
        inp.addEventListener('blur', () => validateField(name));
        inp.addEventListener('input', () => {
            const grp = document.getElementById(`grp-${name}`);
            if (grp && grp.classList.contains('has-error')) validateField(name);
        });
    });

    document.getElementById('attendanceForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSubmit');
        if (btn.disabled) return;

        if (!validateAll()) {
            const firstErr = document.querySelector('.field-group.has-error');
            if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        btn.classList.add('is-loading');
        btn.disabled = true;

        const formData = {
            fullname:  document.getElementById('inp-fullname').value,
            phone:     document.getElementById('inp-phone').value,
            role:      document.getElementById('inp-role').value,
            workplace: document.getElementById('inp-workplace').value
        };

        try {
            const record = await registerAttendance(formData);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
            showConfirmation(record);
        } catch (err) {
            console.error('Attendance error:', err);
            document.getElementById('errorText').textContent = err.message || 'تعذر الاتصال بالخادم. يرجى المحاولة ثانية.';
            document.getElementById('attendanceForm').style.display = 'none';
            document.getElementById('errorScreen').hidden = false;
        } finally {
            btn.classList.remove('is-loading');
            btn.disabled = false;
        }
    });

    // Check cached pass
    try {
        const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (cached && cached.full_name) {
            showConfirmation(cached);
        }
    } catch (e) {}
});
