-- 001_initial_schema.sql
-- أداة تسجيل الفعاليات — Event Register Tool
-- High-concurrency schema optimized for 500+ burst submissions

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Events table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    event_date DATE NOT NULL,
    opens_at TIMESTAMPTZ NOT NULL,
    closes_at TIMESTAMPTZ NOT NULL,
    is_open BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Volunteers table (pre-seeded list of event volunteers for matching)
CREATE TABLE IF NOT EXISTS volunteers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_norm TEXT NOT NULL,
    email_norm TEXT NOT NULL,
    role_title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Registrations table
CREATE TABLE IF NOT EXISTS registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_norm TEXT NOT NULL,
    email_norm TEXT NOT NULL,
    role_title TEXT NOT NULL,
    workplace TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar', 'en')),
    kind TEXT NOT NULL DEFAULT 'attendee' CHECK (kind IN ('attendee', 'volunteer')),
    volunteer_id UUID REFERENCES volunteers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_registrations_event_phone UNIQUE (event_id, phone_norm),
    CONSTRAINT uq_registrations_event_email UNIQUE (event_id, email_norm)
);

-- 5. Certificates table (Rule 0: Asynchronous follow-up)
CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
    volunteer_id UUID REFERENCES volunteers(id) ON DELETE SET NULL,
    serial TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    file_path TEXT,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    emailed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. Performance Indexes for High-Concurrency Deduplication
CREATE INDEX IF NOT EXISTS idx_events_slug ON events (slug);
CREATE INDEX IF NOT EXISTS idx_registrations_event_phone ON registrations (event_id, phone_norm);
CREATE INDEX IF NOT EXISTS idx_registrations_event_email ON registrations (event_id, email_norm);
CREATE INDEX IF NOT EXISTS idx_volunteers_event_phone ON volunteers (event_id, phone_norm);
CREATE INDEX IF NOT EXISTS idx_volunteers_event_email ON volunteers (event_id, email_norm);
CREATE INDEX IF NOT EXISTS idx_certificates_queue ON certificates (status, created_at) WHERE status = 'pending';

