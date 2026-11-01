// test/check_migrations.mjs
// Runs db/migrations on real Postgres (PGlite) and checks the registration rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (name) => readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8')
    .replace(/CREATE EXTENSION[^;]*;/i, ''); // gen_random_uuid is built in; PGlite ships without pgcrypto

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
for (const f of ['001_initial_schema.sql', '002_atomic_registration_rpc.sql', '003_seed_event.sql']) await db.exec(sql(f));

// Worst case: a project with "automatically expose new tables and functions" switched on
await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
    INSERT INTO events (slug, name, event_date, opens_at, closes_at)
    VALUES ('check', 'Check', current_date, now() - interval '1 hour', now() + interval '1 hour');
`);

const SLUG = 'check';
const register = async (phone, name = 'Test Person', email = '', role = 'typed role') =>
    (await db.query(`SELECT register_attendee($1, $2, $3, $4, $5, 'workplace', 'ar') r`, [SLUG, name, phone, email, role])).rows[0].r;
const rows = async () => (await db.query(`
    SELECT r.* FROM registrations r JOIN events e ON e.id = r.event_id WHERE e.slug = $1 ORDER BY r.created_at`, [SLUG])).rows;
const asRole = async (role, text, params) => {
    await db.exec(`SET ROLE ${role}`);
    try { return await db.query(text, params); } finally { await db.exec('RESET ROLE'); }
};
const denied = (role, text) => assert.rejects(asRole(role, text), /permission denied/, `${role} must be refused: ${text}`);

// Bug A, before the fix
let oldError = null;
try { await register('+9647700000001'); } catch (e) { oldError = e.message; }
console.log(`Before 004, first registration: ${oldError ?? 'saved'}`);
assert.match(oldError ?? '', /null value/, 'expected first registration to fail before 004');

await db.exec(sql('004_fix_registration_and_permissions.sql'));

// 005 refuses to apply over rows that break its rules, and leaves nothing half done
const checkEventId = (await db.query(`SELECT id FROM events WHERE slug = $1`, [SLUG])).rows[0].id;
for (const [phone, kind] of [['0770-bad', 'attendee'], ['+9647700000099', 'volunteer']]) {
    await db.query(`INSERT INTO registrations (event_id, full_name, phone_norm, email_norm, role_title, workplace, kind)
        VALUES ($1, 'Old Row', $2, '', 'r', 'w', $3)`, [checkEventId, phone, kind]);
    await assert.rejects(db.exec(sql('005_data_safeguards.sql')), /check constraint/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'registrations_phone_format'`)).rows.length, 0);
    await db.query(`DELETE FROM registrations WHERE phone_norm = $1`, [phone]);
}

await db.exec(sql('005_data_safeguards.sql'));

// Everyone with an empty email saves (bugs A and B)
const a = await register('+9647700000001', 'Person A');
const b = await register('+9647700000002', 'Person B');
assert.equal(a.success, true);
assert.equal(a.already_registered, false);
assert.equal(a.full_name, 'Person A');
assert.equal(b.already_registered, false);
assert.notEqual(a.serial, b.serial);
let saved = await rows();
assert.equal(saved.length, 2);
assert.equal(saved[0].full_name, 'Person A');
assert.equal(saved[0].workplace, 'workplace');
assert.equal(saved[0].email_norm, '');

// Same phone twice keeps one row and the same reference code
const again = await register('+9647700000001', 'Different Name');
assert.equal(again.already_registered, true);
assert.equal(again.serial, a.serial);
assert.equal((await rows()).length, 2);

// A real email still blocks a duplicate, and resolves to that person (bug C)
const withEmail = await register('+9647700000003', 'Person C', 'C@Example.com');
const sameEmail = await register('+9647700000004', 'Person D', 'c@example.com');
assert.equal(sameEmail.already_registered, true);
assert.equal(sameEmail.serial, withEmail.serial);
assert.equal((await rows()).length, 3);

// Volunteer import: any phone format, no email (bug D)
const importVolunteers = async (list) =>
    (await db.query(`SELECT import_volunteers_list($1, $2::jsonb) r`, [SLUG, JSON.stringify(list)])).rows[0].r;
const imported = await importVolunteers([
    { full_name: 'Late Volunteer', phone: '0770 000 0002', role_title: 'Hall lead' },
    { full_name: 'Early Volunteer', phone: '٠٧٧٠٠٠٠٠٠٠٥', role_title: 'Reception' },
    { full_name: 'No Role', phone: '009647700000006' },
    { full_name: 'Bad Row', phone: '' }
]);
assert.deepEqual(imported, { success: true, imported_count: 3, skipped_count: 1 });

// Registered before the import: upgraded, and nobody else changed
saved = await rows();
const late = saved.find(r => r.phone_norm === '+9647700000002');
assert.equal(late.kind, 'volunteer');
assert.equal(late.role_title, 'Hall lead');
assert.ok(late.volunteer_id);
assert.deepEqual(saved.filter(r => r.kind === 'volunteer').length, 1);

// Registered after the import: matched on arrival, imported role wins
const early = await register('+9647700000005', 'Early Volunteer');
assert.equal(early.kind, 'volunteer');
saved = await rows();
const earlyRow = saved.find(r => r.phone_norm === '+9647700000005');
assert.equal(earlyRow.role_title, 'Reception');
assert.ok(earlyRow.volunteer_id);

// Re-import updates rather than duplicates
await importVolunteers([{ full_name: 'Late Volunteer', phone: '+9647700000002', role_title: 'Hall lead 2' }]);
const volunteerCount = (await db.query(`SELECT count(*)::int n FROM volunteers WHERE phone_norm = '+9647700000002'`)).rows[0].n;
assert.equal(volunteerCount, 1);

// The fake seeded volunteer is gone
assert.equal((await db.query(`SELECT 1 FROM volunteers WHERE phone_norm = '+9647701234567'`)).rows.length, 0);

// Public key: can register and read the count, nothing else
for (const role of ['anon', 'authenticated']) {
    await denied(role, `SELECT get_admin_dashboard('check')`);
    await denied(role, `SELECT import_volunteers_list('check', '[]'::jsonb)`);
    const viaKey = await asRole(role, `SELECT register_attendee('check', 'Key Person', '+96477000009${String(role.length).padStart(2, '0')}', '', 'r', 'w', 'ar') r`);
    assert.equal(viaKey.rows[0].r.success, true);
    const display = await asRole(role, `SELECT get_event_display('check') r`);
    assert.ok(display.rows[0].r.total_registrations >= 1);
    assert.equal(Object.keys(display.rows[0].r).includes('attendees'), false);

    assert.equal((await asRole(role, `SELECT * FROM registrations`)).rows.length, 0);
    assert.equal((await asRole(role, `SELECT * FROM volunteers`)).rows.length, 0);
    await assert.rejects(asRole(role, `INSERT INTO registrations (event_id, full_name, phone_norm, email_norm, role_title, workplace)
        SELECT id, 'x', 'x', '', 'x', 'x' FROM events LIMIT 1`), /row-level security/);
    await assert.rejects(asRole(role, `INSERT INTO certificates (registration_id, serial) VALUES (gen_random_uuid(), 'x')`), /row-level security/);
}

// service_role keeps the admin functions
const dash = await asRole('service_role', `SELECT get_admin_dashboard('check') r`);
assert.ok(dash.rows[0].r.attendees.length >= 3);

// 005: only well-formed Iraqi mobile numbers get in
const countRows = async () => (await rows()).length;
const before = await countRows();
for (const phone of ['+9647700', '+96477000000012', '+447700900123', '+9641700000001', '07700000001', 'abc']) {
    const bad = await register(phone);
    assert.equal(bad.success, false, phone);
    assert.equal(bad.error_code, 'INVALID_PHONE', phone);
}
assert.equal(await countRows(), before);
await assert.rejects(db.query(`INSERT INTO registrations (event_id, full_name, phone_norm, email_norm, role_title, workplace)
    VALUES ($1, 'x', '+447700900123', '', 'r', 'w')`, [checkEventId]), /registrations_phone_format/);
await assert.rejects(db.query(`INSERT INTO volunteers (event_id, full_name, phone_norm, email_norm, role_title)
    VALUES ($1, 'x', '+447700900123', '', 'r')`, [checkEventId]), /volunteers_phone_format/);

// 005: one bad phone in an import is skipped, the rest still load
const mixed = await importVolunteers([
    { full_name: 'Foreign', phone: '+447700900123' },
    { full_name: 'Good', phone: '07700000007' }
]);
assert.deepEqual(mixed, { success: true, imported_count: 1, skipped_count: 1 });

// 005: events and volunteers in use cannot be deleted
await assert.rejects(db.query(`DELETE FROM events WHERE id = $1`, [checkEventId]), /foreign key/);
await assert.rejects(db.query(`DELETE FROM volunteers WHERE phone_norm = '+9647700000002'`), /foreign key/);
assert.equal((await db.query(`SELECT 1 FROM events WHERE id = $1`, [checkEventId])).rows.length, 1);
// ...but a volunteer who never registered, and an event with no registrations, still can
assert.equal((await db.query(`DELETE FROM volunteers WHERE phone_norm = '+9647700000007'`)).affectedRows, 1);
const emptyEvent = (await db.query(`INSERT INTO events (slug, name, event_date, opens_at, closes_at)
    VALUES ('empty', 'Empty', current_date, now(), now() + interval '1 hour') RETURNING id`)).rows[0].id;
await db.query(`INSERT INTO volunteers (event_id, full_name, phone_norm, email_norm, role_title)
    VALUES ($1, 'x', '+9647700000008', '', 'r')`, [emptyEvent]);
assert.equal((await db.query(`DELETE FROM events WHERE id = $1`, [emptyEvent])).affectedRows, 1);

// 005: kind = volunteer always has a volunteer_id
const hasId = /registrations_volunteer_has_id/;
await assert.rejects(db.query(`UPDATE registrations SET kind = 'volunteer' WHERE phone_norm = '+9647700000001'`), hasId);
await assert.rejects(db.query(`UPDATE registrations SET volunteer_id = NULL WHERE phone_norm = '+9647700000002'`), hasId);
await assert.rejects(db.query(`INSERT INTO registrations (event_id, full_name, phone_norm, email_norm, role_title, workplace, kind)
    VALUES ($1, 'x', '+9647700000010', '', 'r', 'w', 'volunteer')`, [checkEventId]), hasId);

await db.close();
console.log('All migration checks passed');
