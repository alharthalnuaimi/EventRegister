# العقد المشترك — أداة تسجيل الفعاليات v1

## التدفق
1. الهاتف يمسح QR ← نموذج التسجيل ← POST /register ← الباك اند يحفظ في قاعدة البيانات
2. متطوع؟ ← الباك اند يضيف صف شهادة (معلق)
3. البوت يأخذ المعلق ← PDF ← تخزين خاص ← جاهز ← يرسله بالإيميل
4. الواجهة تستعلم عن حالة الشهادة ← تعرض زر التحميل

## القاعدة صفر
التسجيل يُحفظ أولاً؛ الشهادة متابعة. إذا فشل البوت أو التخزين أو الإيميل، الشخص يبقى مسجلاً.

## الجداول (Supabase Postgres)
- `events`: id, slug, name, event_date, opens_at, closes_at, is_open
- `volunteers`: id, event_id, full_name, phone_norm, email_norm, role_title
- `registrations`: id (uuid), event_id, full_name, phone_norm, email_norm, role_title, workplace, lang (ar|en), kind (attendee|volunteer), volunteer_id, created_at
- `certificates`: id (uuid), registration_id, volunteer_id, serial, status (pending|processing|ready|failed), file_path, attempts, last_error, emailed_at, created_at

## القواعد
- المطابقة بالهاتف أو الإيميل، أبداً بالاسم
- phone_norm: E.164 (عراقي 07XX… يصبح +9647…)
- email_norm: مقصوص، حروف صغيرة
- فريد (event_id, phone_norm) و (event_id, email_norm)
- الفعالية مفتوحة عندما is_open = true والوقت بين opens_at و closes_at

## API
- `GET /api/events/{slug}` → {name, event_date, is_open}
- `POST /api/events/{slug}/register` → {registration_id, kind, already_registered}
- `GET /api/registrations/{id}/certificate` → {status, download_url}
