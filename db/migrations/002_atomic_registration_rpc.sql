-- 002_atomic_registration_rpc.sql
-- أداة تسجيل الفعاليات — High-Concurrency Registration RPC & Admin Dashboard Functions

-- ============================================================
-- 1. Atomic Registration Function (Zero-Race Condition, Instant)
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
    SELECT id, kind, role_title, workplace, full_name
    INTO v_reg_id, v_reg_kind, v_matched_role, p_workplace, p_full_name
    FROM registrations
    WHERE event_id = v_event.id
      AND (phone_norm = v_clean_phone OR email_norm = v_clean_email)
    LIMIT 1;

    IF FOUND THEN
        v_serial := 'ALF-2026-' || upper(substring(replace(v_reg_id::text, '-', ''), 1, 6));
        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_reg_id,
            'kind', v_reg_kind,
            'serial', v_serial,
            'full_name', p_full_name,
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

    v_serial := 'ALF-2026-' || upper(substring(replace(v_reg_id::text, '-', ''), 1, 6));

    RETURN jsonb_build_object(
        'success', true,
        'already_registered', false,
        'registration_id', v_reg_id,
        'kind', v_reg_kind,
        'serial', v_serial,
        'full_name', p_full_name,
        'event_name', v_event.name,
        'message', 'تم تسجيل حضورك بنجاح! / Attendance recorded successfully!'
    );

EXCEPTION
    WHEN unique_violation THEN
        -- Handles microsecond concurrent double-submit gracefully
        SELECT id, kind INTO v_reg_id, v_reg_kind
        FROM registrations
        WHERE event_id = v_event.id
          AND (phone_norm = v_clean_phone OR email_norm = v_clean_email)
        LIMIT 1;

        v_serial := 'ALF-2026-' || upper(substring(replace(v_reg_id::text, '-', ''), 1, 6));

        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_reg_id,
            'kind', v_reg_kind,
            'serial', v_serial,
            'message', 'تم التسجيل مسبقاً / Already registered'
        );
END;
$$;

-- Alias for frontend
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
    RETURN register_attendee(event_slug, full_name, phone_norm, email_norm, role_title, workplace, lang);
END;
$$;

-- ============================================================
-- 2. Stage Display Helper
-- ============================================================
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
        'total_registrations', count(r.id),
        'total_volunteers', count(r.id) FILTER (WHERE r.kind = 'volunteer')
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

-- ============================================================
-- 3. Admin Dashboard & Volunteer Import Functions
-- ============================================================

-- Fetch full admin data
CREATE OR REPLACE FUNCTION get_admin_dashboard(p_event_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
    v_event_name TEXT;
    v_attendees JSONB;
    v_volunteers JSONB;
BEGIN
    SELECT id, name INTO v_event_id, v_event_name
    FROM events WHERE slug = p_event_slug;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
    END IF;

    -- Fetch registrations list
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'full_name', r.full_name,
            'phone', r.phone_norm,
            'email', r.email_norm,
            'role_title', r.role_title,
            'workplace', r.workplace,
            'kind', r.kind,
            'created_at', r.created_at,
            'serial', 'ALF-2026-' || upper(substring(replace(r.id::text, '-', ''), 1, 6))
        ) ORDER BY r.created_at DESC
    )
    INTO v_attendees
    FROM registrations r
    WHERE r.event_id = v_event_id;

    -- Fetch volunteers list
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', v.id,
            'full_name', v.full_name,
            'phone', v.phone_norm,
            'email', v.email_norm,
            'role_title', v.role_title
        ) ORDER BY v.created_at DESC
    )
    INTO v_volunteers
    FROM volunteers v
    WHERE v.event_id = v_event_id;

    RETURN jsonb_build_object(
        'event_name', v_event_name,
        'total_count', COALESCE(jsonb_array_length(v_attendees), 0),
        'attendees', COALESCE(v_attendees, '[]'::jsonb),
        'volunteers', COALESCE(v_volunteers, '[]'::jsonb)
    );
END;
$$;

-- Bulk import volunteers
CREATE OR REPLACE FUNCTION import_volunteers_list(
    p_event_slug TEXT,
    p_volunteers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
    v_item JSONB;
    v_inserted INT := 0;
    v_phone TEXT;
    v_email TEXT;
BEGIN
    SELECT id INTO v_event_id FROM events WHERE slug = p_event_slug;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Event not found');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_volunteers)
    LOOP
        v_phone := trim(v_item->>'phone');
        v_email := lower(trim(v_item->>'email'));

        INSERT INTO volunteers (
            event_id,
            full_name,
            phone_norm,
            email_norm,
            role_title
        ) VALUES (
            v_event_id,
            trim(v_item->>'full_name'),
            v_phone,
            v_email,
            COALESCE(trim(v_item->>'role_title'), 'متطوع تنظيم')
        );

        -- Retroactively mark any existing matching registration as volunteer
        UPDATE registrations
        SET kind = 'volunteer'
        WHERE event_id = v_event_id
          AND (phone_norm = v_phone OR email_norm = v_email);

        v_inserted := v_inserted + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'imported_count', v_inserted
    );
END;
$$;

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public events read" ON events FOR SELECT TO anon, authenticated USING (is_open = true);
CREATE POLICY "Registrations protected from direct select" ON registrations FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Volunteers protected" ON volunteers FOR ALL TO anon, authenticated USING (false);
