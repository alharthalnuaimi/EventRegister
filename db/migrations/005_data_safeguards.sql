-- 005_data_safeguards.sql
-- Safeguards adapted from the database team's schema: phone format, delete protection, volunteer link
-- Requires 004. Runs as one transaction: if existing rows break a rule, nothing is applied.

BEGIN;

-- ============================================================
-- 1. Phone format: Iraqi mobile numbers only (same pattern as frontend/app.js)
-- ============================================================
ALTER TABLE registrations
    ADD CONSTRAINT registrations_phone_format CHECK (phone_norm ~ '^\+9647[0-9]{9}$');
ALTER TABLE volunteers
    ADD CONSTRAINT volunteers_phone_format CHECK (phone_norm ~ '^\+9647[0-9]{9}$');

-- ============================================================
-- 2. Delete protection
-- ============================================================
ALTER TABLE registrations DROP CONSTRAINT registrations_event_id_fkey;
ALTER TABLE registrations
    ADD CONSTRAINT registrations_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT;

ALTER TABLE registrations DROP CONSTRAINT registrations_volunteer_id_fkey;
ALTER TABLE registrations
    ADD CONSTRAINT registrations_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES volunteers(id) ON DELETE RESTRICT;

-- ============================================================
-- 3. A volunteer registration always points at its volunteer
-- ============================================================
ALTER TABLE registrations
    ADD CONSTRAINT registrations_volunteer_has_id CHECK (kind <> 'volunteer' OR volunteer_id IS NOT NULL);

-- ============================================================
-- 4. Registration: a bad phone gets a clear answer, not a raw constraint error
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
    v_existing RECORD;
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
    v_clean_email := lower(trim(COALESCE(p_email_norm, '')));

    IF v_clean_phone = '' OR trim(p_full_name) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_INPUT',
            'message', 'الاسم الكامل ورقم الهاتف مطلوبان / Full name and phone are required'
        );
    END IF;

    IF v_clean_phone !~ '^\+9647[0-9]{9}$' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_PHONE',
            'message', 'صيغة رقم الهاتف غير صحيحة (07XXXXXXXXX) / Invalid phone number format'
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

    -- 2. Check if already registered (Strictly Unique Phone per event)
    -- SELECT INTO sets its targets to NULL on no row, so it must not target the parameters
    SELECT id, kind, full_name
    INTO v_existing
    FROM registrations
    WHERE event_id = v_event.id
      AND phone_norm = v_clean_phone
    LIMIT 1;

    IF FOUND THEN
        v_serial := 'ALF-2026-' || upper(substring(replace(v_existing.id::text, '-', ''), 1, 6));
        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_existing.id,
            'kind', v_existing.kind,
            'serial', v_serial,
            'full_name', v_existing.full_name,
            'event_name', v_event.name,
            'message', 'أنت مسجل بالفعل في هذه الفعالية / You are already registered for this event'
        );
    END IF;

    -- 3. Check for volunteer match (Matched by normalized phone)
    SELECT id, role_title
    INTO v_volunteer_id, v_matched_role
    FROM volunteers
    WHERE event_id = v_event.id
      AND phone_norm = v_clean_phone
    LIMIT 1;

    IF FOUND THEN
        v_reg_kind := 'volunteer';
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
        'full_name', trim(p_full_name),
        'event_name', v_event.name,
        'message', 'تم تسجيل حضورك بنجاح! / Attendance recorded successfully!'
    );

EXCEPTION
    WHEN unique_violation THEN
        -- Handles microsecond concurrent double-submit gracefully
        SELECT id, kind, full_name INTO v_existing
        FROM registrations
        WHERE event_id = v_event.id
          AND (phone_norm = v_clean_phone OR (v_clean_email <> '' AND email_norm = v_clean_email))
        ORDER BY phone_norm = v_clean_phone DESC
        LIMIT 1;

        v_serial := 'ALF-2026-' || upper(substring(replace(v_existing.id::text, '-', ''), 1, 6));

        RETURN jsonb_build_object(
            'success', true,
            'already_registered', true,
            'registration_id', v_existing.id,
            'kind', v_existing.kind,
            'serial', v_serial,
            'full_name', v_existing.full_name,
            'message', 'تم التسجيل مسبقاً / Already registered'
        );
END;
$$;

-- ============================================================
-- 5. Volunteer import: one bad phone is skipped, not fatal to the whole list
-- ============================================================
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
    v_skipped INT := 0;
    v_volunteer_id UUID;
    v_name TEXT;
    v_role TEXT;
    v_phone TEXT;
    v_email TEXT;
BEGIN
    SELECT id INTO v_event_id FROM events WHERE slug = p_event_slug;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Event not found');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_volunteers)
    LOOP
        -- Same rules as normalizePhone in frontend/app.js, or a volunteer never matches
        v_phone := translate(COALESCE(v_item->>'phone', ''), '٠١٢٣٤٥٦٧٨٩', '0123456789');
        v_phone := regexp_replace(v_phone, '[^0-9+]', '', 'g');
        IF v_phone LIKE '00964%' THEN
            v_phone := '+964' || substr(v_phone, 6);
        ELSIF v_phone LIKE '964%' THEN
            v_phone := '+964' || substr(v_phone, 4);
        ELSIF v_phone LIKE '07%' THEN
            v_phone := '+964' || substr(v_phone, 2);
        ELSIF v_phone LIKE '7%' AND length(v_phone) = 10 THEN
            v_phone := '+964' || v_phone;
        END IF;

        v_name := trim(COALESCE(v_item->>'full_name', ''));
        v_email := lower(trim(COALESCE(v_item->>'email', '')));
        v_role := COALESCE(NULLIF(trim(v_item->>'role_title'), ''), 'متطوع تنظيم');

        IF v_phone !~ '^\+9647[0-9]{9}$' OR v_name = '' THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO volunteers (
            event_id,
            full_name,
            phone_norm,
            email_norm,
            role_title
        ) VALUES (
            v_event_id,
            v_name,
            v_phone,
            v_email,
            v_role
        )
        ON CONFLICT (event_id, phone_norm) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email_norm = EXCLUDED.email_norm,
            role_title = EXCLUDED.role_title
        RETURNING id INTO v_volunteer_id;

        -- Retroactively mark any existing matching registration as volunteer
        UPDATE registrations
        SET kind = 'volunteer',
            volunteer_id = v_volunteer_id,
            role_title = v_role
        WHERE event_id = v_event_id
          AND (phone_norm = v_phone OR (v_email <> '' AND email_norm = v_email));

        v_inserted := v_inserted + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'imported_count', v_inserted,
        'skipped_count', v_skipped
    );
END;
$$;

COMMIT;
