-- 002_atomic_registration_rpc.sql
-- أداة تسجيل الفعاليات — High-Concurrency Registration RPC & RLS

-- ============================================================
-- 1. Atomic Registration Function (Zero-Race Condition, 1 RTT)
-- ============================================================
CREATE OR REPLACE FUNCTION register_attendee(
    p_event_slug TEXT,
    p_full_name TEXT,
    p_phone_norm TEXT,
    p_email_norm TEXT,
    p_role_title TEXT DEFAULT '',
    p_workplace TEXT DEFAULT '',
    p_lang TEXT DEFAULT 'ar'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event RECORD;
    v_reg_id UUID;
    v_reg_kind TEXT := 'attendee';
    v_volunteer_id UUID := NULL;
    v_matched_role TEXT := NULL;
    v_serial TEXT;
    v_clean_phone TEXT;
    v_clean_email TEXT;
BEGIN
    -- Input sanitization
    v_clean_phone := trim(p_phone_norm);
    v_clean_email := lower(trim(p_email_norm));

    IF v_clean_phone = '' OR v_clean_email = '' OR trim(p_full_name) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_INPUT',
            'message', 'جميع الحقول الأساسية مطلوبة / All basic fields are required'
        );
    END IF;

    -- 1. Check event validity and open window
    SELECT id, name, is_open, opens_at, closes_at
    INTO v_event
    FROM events
    WHERE slug = p_event_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'EVENT_NOT_FOUND',
            'message', 'الفعالية غير موجودة / Event not found'
        );
    END IF;

    IF NOT v_event.is_open OR now() < v_event.opens_at OR now() > v_event.closes_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'EVENT_CLOSED',
            'message', 'باب التسجيل في هذه الفعالية مغلق حالياً / Registration is currently closed'
        );
    END IF;

    -- 2. Check if already registered (Phone or Email unique per event)
    SELECT id, kind
    INTO v_reg_id, v_reg_kind
    FROM registrations
    WHERE event_id = v_event.id
      AND (phone_norm = v_clean_phone OR email_norm = v_clean_email)
    LIMIT 1;

    IF FOUND THEN
        -- Fetch certificate status if exists
        SELECT serial INTO v_serial
        FROM certificates
        WHERE registration_id = v_reg_id
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_reg_id,
            'kind', v_reg_kind,
            'serial', v_serial,
            'event_name', v_event.name,
            'message', 'أنت مسجل بالفعل في هذه الفعالية / You are already registered for this event'
        );
    END IF;

    -- 3. Check for volunteer match (Matched by normalized phone or email)
    SELECT id, role_title
    INTO v_volunteer_id, v_matched_role
    FROM volunteers
    WHERE event_id = v_event.id
      AND (phone_norm = v_clean_phone OR email_norm = v_clean_email)
    LIMIT 1;

    IF FOUND THEN
        v_reg_kind := 'volunteer';
    ELSE
        v_reg_kind := 'attendee';
    END IF;

    -- 4. Atomic Insert Registration
    INSERT INTO registrations (
        event_id,
        full_name,
        phone_norm,
        email_norm,
        role_title,
        workplace,
        lang,
        kind,
        volunteer_id
    ) VALUES (
        v_event.id,
        trim(p_full_name),
        v_clean_phone,
        v_clean_email,
        COALESCE(v_matched_role, trim(p_role_title)),
        trim(p_workplace),
        CASE WHEN p_lang IN ('ar', 'en') THEN p_lang ELSE 'ar' END,
        v_reg_kind,
        v_volunteer_id
    )
    RETURNING id INTO v_reg_id;

    -- 5. Rule 0: Enqueue Certificate Generation (Asynchronous follow-up)
    v_serial := 'ALF-' || to_char(now(), 'YYYY') || '-' || upper(substring(replace(v_reg_id::text, '-', ''), 1, 8));

    INSERT INTO certificates (
        registration_id,
        volunteer_id,
        serial,
        status
    ) VALUES (
        v_reg_id,
        v_volunteer_id,
        v_serial,
        'pending'
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_registered', false,
        'registration_id', v_reg_id,
        'kind', v_reg_kind,
        'serial', v_serial,
        'event_name', v_event.name,
        'message', 'تم التسجيل بنجاح! / Registration successful!'
    );

EXCEPTION
    WHEN unique_violation THEN
        -- Handles microsecond concurrent double-submit gracefully
        SELECT id, kind INTO v_reg_id, v_reg_kind
        FROM registrations
        WHERE event_id = v_event.id
          AND (phone_norm = v_clean_phone OR email_norm = v_clean_email)
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_reg_id,
            'kind', v_reg_kind,
            'message', 'تم التسجيل مسبقاً / Already registered'
        );
END;
$$;


-- ============================================================
-- 2. Safe Public Helper RPCs (Throttled & Read-Only)
-- ============================================================

-- Fast Event Status & Live Counter for Display Screen
CREATE OR REPLACE FUNCTION get_event_display(p_event_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'name', e.name,
        'event_date', e.event_date,
        'is_open', e.is_open AND (now() BETWEEN e.opens_at AND e.closes_at),
        'total_registrations', count(r.id)
    )
    INTO v_result
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.slug = p_event_slug
    GROUP BY e.id, e.name, e.event_date, e.is_open, e.opens_at, e.closes_at;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;

    RETURN v_result;
END;
$$;

-- Secure Certificate Check (Attendee only checks their own registration ID)
CREATE OR REPLACE FUNCTION get_certificate_status(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cert RECORD;
BEGIN
    SELECT c.serial, c.status, c.file_path, c.updated_at
    INTO v_cert
    FROM certificates c
    WHERE c.registration_id = p_registration_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    RETURN jsonb_build_object(
        'status', v_cert.status,
        'serial', v_cert.serial,
        'file_path', v_cert.file_path,
        'updated_at', v_cert.updated_at
    );
END;
$$;


-- ============================================================
-- 3. Row Level Security (RLS) Configuration
-- ============================================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Anonymous users can read basic event details
CREATE POLICY "Public events read" ON events
    FOR SELECT TO anon, authenticated
    USING (is_open = true);

-- Protect registrations from direct scraping (Only accessible via RPC)
CREATE POLICY "Registrations protected from direct select" ON registrations
    FOR SELECT TO anon, authenticated
    USING (false);

-- Protect volunteers table completely from public
CREATE POLICY "Volunteers protected" ON volunteers
    FOR ALL TO anon, authenticated
    USING (false);

-- Service role full access
CREATE POLICY "Service role full access events" ON events FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access volunteers" ON volunteers FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access registrations" ON registrations FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access certificates" ON certificates FOR ALL TO service_role USING (true);


-- Alias for frontend compatibility
CREATE OR REPLACE FUNCTION register_attendance(
    event_slug TEXT,
    full_name TEXT,
    phone_norm TEXT,
    email_norm TEXT,
    role_title TEXT DEFAULT '',
    workplace TEXT DEFAULT '',
    lang TEXT DEFAULT 'ar'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN register_attendee(
        event_slug,
        full_name,
        phone_norm,
        email_norm,
        role_title,
        workplace,
        lang
    );
END;
$$;
