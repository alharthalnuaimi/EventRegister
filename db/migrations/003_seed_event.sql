-- 003_seed_event.sql
-- بذرة فعالية محاضرة الذكاء الاصطناعي — جامعة الفارابي

INSERT INTO events (
    slug,
    name,
    event_date,
    opens_at,
    closes_at,
    is_open
) VALUES (
    'ai-lecture-2026',
    'محاضرة علمية: AI Is Not As We Know It — أ.د. ضياء الجميلي',
    '2026-11-02',
    '2026-11-01 00:00:00+03',
    '2026-11-03 23:59:59+03',
    true
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    event_date = EXCLUDED.event_date,
    opens_at = EXCLUDED.opens_at,
    closes_at = EXCLUDED.closes_at,
    is_open = EXCLUDED.is_open;

-- Seed sample volunteer roles for test matching
-- (Replace with actual volunteer list if available)
INSERT INTO volunteers (
    event_id,
    full_name,
    phone_norm,
    email_norm,
    role_title
)
SELECT 
    id,
    'أحمد علي - منسق التنظيم',
    '+9647701234567',
    'ahmed.organizer@alfarabiuc.edu.iq',
    'منسق قاعة بابل'
FROM events 
WHERE slug = 'ai-lecture-2026'
ON CONFLICT DO NOTHING;

