-- 006_admin_crud.sql
-- Enables admin editing and deleting of registrations

CREATE OR REPLACE FUNCTION admin_delete_registration(
    p_registration_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_found INT;
BEGIN
    DELETE FROM certificates WHERE registration_id = p_registration_id;
    DELETE FROM registrations WHERE id = p_registration_id;
    GET DIAGNOSTICS v_found = ROW_COUNT;

    IF v_found > 0 THEN
        RETURN jsonb_build_object('success', true, 'deleted_id', p_registration_id);
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Record not found');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_registration(
    p_registration_id UUID,
    p_full_name TEXT,
    p_phone_norm TEXT,
    p_role_title TEXT,
    p_workplace TEXT,
    p_kind TEXT DEFAULT 'attendee'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_phone TEXT;
    v_reg RECORD;
    v_volunteer_id UUID := NULL;
BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Record not found');
    END IF;

    v_clean_phone := trim(p_phone_norm);
    IF v_clean_phone !~ '^\+9647[0-9]{9}$' THEN
        v_clean_phone := regexp_replace(v_clean_phone, '[^0-9+]', '', 'g');
        IF v_clean_phone LIKE '07%' THEN
            v_clean_phone := '+964' || substr(v_clean_phone, 2);
        ELSIF v_clean_phone LIKE '7%' AND length(v_clean_phone) = 10 THEN
            v_clean_phone := '+964' || v_clean_phone;
        END IF;
    END IF;

    IF p_kind = 'volunteer' THEN
        INSERT INTO volunteers (event_id, full_name, phone_norm, email_norm, role_title)
        VALUES (v_reg.event_id, trim(p_full_name), v_clean_phone, v_reg.email_norm, trim(p_role_title))
        ON CONFLICT (event_id, phone_norm) DO UPDATE
            SET full_name = EXCLUDED.full_name,
                role_title = EXCLUDED.role_title
        RETURNING id INTO v_volunteer_id;
    END IF;

    UPDATE registrations
    SET full_name = trim(p_full_name),
        phone_norm = v_clean_phone,
        role_title = trim(p_role_title),
        workplace = trim(p_workplace),
        kind = CASE WHEN p_kind = 'volunteer' THEN 'volunteer' ELSE 'attendee' END,
        volunteer_id = CASE WHEN p_kind = 'volunteer' THEN v_volunteer_id ELSE NULL END
    WHERE id = p_registration_id;

    RETURN jsonb_build_object(
        'success', true,
        'updated_id', p_registration_id,
        'serial', 'ALF-2026-' || upper(substring(replace(p_registration_id::text, '-', ''), 1, 6))
    );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_registration(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_registration(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

