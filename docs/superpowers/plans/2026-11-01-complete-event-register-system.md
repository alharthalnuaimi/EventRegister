# Complete Event Registration System Implementation Plan (500+ Concurrent Users)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-grade, end-to-end event registration and certification system capable of handling 500+ concurrent attendees scanning a QR code simultaneously during an auditorium lecture rush, with zero dropped registrations, atomic deduplication, resilient offline/weak-network recovery, and asynchronous certificate generation.

**Architecture:** 
1. **Frontend Tier:** Mobile-first vanilla JS with local storage ticket caching, aggressive debounce, network retry with exponential backoff, and jittered certificate polling to eliminate thundering herd traffic.
2. **Database Tier (Supabase/PostgreSQL):** Composite B-Tree indexes for $O(\log N)$ duplicate lookups, and an atomic PostgreSQL stored procedure (`register_attendee`) that executes existence checks, insertions, volunteer matching, and certificate enqueuing in a single transaction in $<5\text{ ms}$.
3. **Backend Tier:** High-throughput Express API with connection pooling, IP rate limiting, and graceful degradation fallback.
4. **Worker Tier:** Asynchronous batch worker using `pdf-lib` (vector rendering, ~15ms per certificate, zero headless browser overhead) to process pending certificates in parallel without blocking web requests.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3, PostgreSQL (Supabase), Node.js, Express, `pdf-lib`, `dotenv`.

**Spec:** [`CONTRACT.md`](file:///d:/antigravity/M.P.AI/event-register/CONTRACT.md)

---

## Global Constraints
- Phone numbers must be normalized to E.164 (Iraqi `07XXXXXXXX` $\to$ `+9647XXXXXXXX`).
- Email addresses must be trimmed and lowercased.
- Rule 0: Registration must succeed and persist immediately. Certificate generation is asynchronous follow-up and must never block or fail the registration.
- Duplicate submissions with identical `(event_id, phone_norm)` or `(event_id, email_norm)` must return the existing record with `already_registered: true` without raising a 500 error.
- All client polling must include random jitter (0-2s) to prevent synchronized database bombardment from 500 devices.

---

## Review Focus
1. **Thundering Herd Burst (500 users in $<10\text{ seconds}$):** 500 phones simultaneously hitting the registration endpoint. System must not exhaust database connections or throw 504 Gateway Timeout.
2. **Double-tapping / Rapid Repeated Clicks:** Attendees furiously tapping the "Register" button on slow connections. Client must lock the button immediately upon tap; database must handle duplicate requests idempotently.
3. **Weak Auditorium Connectivity / Packet Loss:** Attendees experiencing intermittent mobile network in Babil Hall. Client must cache form state, retry with exponential backoff, and save confirmed ticket locally.
4. **Certificate Worker Starvation / Out-of-Memory:** 500 PDFs generated simultaneously. Must NOT use headless Puppeteer/Chrome; must use batching with pure JS vector generator (`pdf-lib`).
5. **Real-time Big Screen Projector Hammering:** The venue stage screen (`display.html`) refreshing every second. Must use lightweight debounced counter queries or Supabase realtime subscriptions without overloading the database.

---

## Tasks

### Task 1: Commit and Push Existing Phase 1 Work to GitHub
**Files:**
- Modify: `.gitignore`
- Repository: `https://github.com/mb69i/Registration-tool.git`

- [ ] Verify git staging status (`git status`).
- [ ] Create initial commit for the frontend baseline: `feat: initial frontend registration tool and contract`.
- [ ] Push to `origin master`.
- [ ] Verify remote branch is up to date.

---

### Task 2: Database Schema, Indexes & Atomic Stored Procedure (Plan 4)
**Files:**
- Create: `db/migrations/001_initial_schema.sql`
- Create: `db/migrations/002_atomic_registration_rpc.sql`
- Create: `db/migrations/003_seed_event.sql`

- [ ] Write `001_initial_schema.sql` defining `events`, `volunteers`, `registrations`, `certificates` tables with UUID primary keys, check constraints, and timestamps.
- [ ] Add composite B-Tree indexes: `idx_registrations_event_phone` on `(event_id, phone_norm)` and `idx_registrations_event_email` on `(event_id, email_norm)` for instant duplicate lookups.
- [ ] Write `002_atomic_registration_rpc.sql` creating the `register_attendee` PostgreSQL function. It validates event open status, performs atomic `INSERT ... ON CONFLICT DO UPDATE`, matches volunteers, creates `pending` certificate rows, and returns a JSON payload in one round trip.
- [ ] Write Row Level Security (RLS) policies allowing public anonymous calls to `register_attendee` and public read of open events, while protecting private data.
- [ ] Write `003_seed_event.sql` to seed the Nov 2, 2026 Al-Farabi University lecture:
  - slug: `ai-lecture-2026`
  - name: `محاضرة علمية: AI Is Not As We Know It - أ.د. ضياء الجميلي`
  - date: `2026-11-02`
  - hall: `قاعة بابل`
- [ ] Test migration scripts syntax and transaction safety.

---

### Task 3: Frontend Concurrency & Resilience Hardening (Plan 1+)
**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

- [ ] Add submission lock (immediate disable + loading spinner) to prevent multiple form submissions from eager clicking.
- [ ] Implement `localStorage` caching of registration status: if a user refreshes or returns, immediately restore their confirmed registration ticket with QR and certificate status.
- [ ] Implement automatic fetch retry (3 attempts with exponential backoff: 1s, 2s, 4s) for unreliable auditorium network connections.
- [ ] Upgrade certificate polling with exponential backoff and random jitter (initial 3s, then 6s, 12s + random 0-2s jitter, max 10 polls) to prevent thundering herd on Supabase.
- [ ] Update `EVENT_SLUG` default to `ai-lecture-2026`.
- [ ] Add venue and speaker details into `index.html` header matching the flyer.

---

### Task 4: High-Throughput Node.js Backend API (Plan 2)
**Files:**
- Create: `backend/package.json`
- Create: `backend/server.js`
- Create: `backend/config.js`
- Create: `backend/.env.example`

- [ ] Initialize Node.js project with `express`, `cors`, `dotenv`, `express-rate-limit`, and `@supabase/supabase-js`.
- [ ] Implement `POST /api/events/:slug/register` routing to the database atomic RPC.
- [ ] Implement `GET /api/events/:slug` to return event status and attendee count.
- [ ] Implement `GET /api/registrations/:id/certificate` with caching headers.
- [ ] Add IP rate limiting (e.g. max 30 requests per minute per IP to prevent spamming while allowing normal retries).
- [ ] Add health check endpoint `GET /health` with memory and latency metrics.

---

### Task 5: Asynchronous Certificate Worker & Generator (Plan 3)
**Files:**
- Create: `bot/package.json`
- Create: `bot/worker.js`
- Create: `bot/template.js`
- Create: `bot/.env.example`

- [ ] Initialize `bot` project using `pdf-lib` and `qrcode` for ultra-fast vector PDF generation.
- [ ] Create `template.js` designing an elegant, official certificate with:
  - Al-Farabi University branding & colors
  - Attendee full name (large calligraphic styling)
  - Lecture title: *"AI Is Not As We Know It"*
  - Speaker: Prof. Dr. Dhia Al-Jumeily
  - Date & venue (2026/11/2 - Babil Hall)
  - Unique certificate serial number + QR code for online verification.
- [ ] Create `worker.js` batch processor: polls or listens for `status = 'pending'`, processes up to 25 certificates per batch asynchronously, writes output PDF, and updates status to `'ready'`.

---

### Task 6: 500+ Concurrent User Load Simulation & Verification
**Files:**
- Create: `test/load_test_500.js`
- Create: `test/package.json`

- [ ] Write a load testing script in Node.js simulating 500 unique attendees submitting registrations within a 5-second burst window.
- [ ] Verify:
  - 100% of requests succeed with HTTP 200/201.
  - Zero database deadlocks or connection drops.
  - Duplicate submissions (same phone/email) correctly return `already_registered: true` without failing.
  - Total processing time and p95 latency under 200ms.
- [ ] Run the test and record performance metrics.

---

### Task 7: Stage Display (`display.html`) Real-Time Polish
**Files:**
- Modify: `frontend/display.html`

- [ ] Connect live attendee counter with 5-second debounced polling or Supabase Realtime channel.
- [ ] Configure QR code to automatically point to the current hosted URL with `?event=ai-lecture-2026`.
- [ ] Verify responsive layout on projector resolutions (1080p and 4K).

