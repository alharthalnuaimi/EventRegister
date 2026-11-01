// bot/worker.js
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { generateCertificate } = require('./template');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_KEY';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 25;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 3000;
const OUTPUT_DIR = path.join(__dirname, 'output', 'certificates');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

async function processBatch() {
    try {
        // 1. Fetch pending certificates
        const { data: certs, error } = await supabase
            .from('certificates')
            .select(`
                id,
                serial,
                attempts,
                registration_id,
                registrations (
                    full_name,
                    role_title,
                    events (
                        name,
                        event_date
                    )
                )
            `)
            .eq('status', 'pending')
            .lt('attempts', 3)
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE);

        if (error) throw error;
        if (!certs || certs.length === 0) return 0;

        console.log(`[Certificate Worker] Processing batch of ${certs.length} certificates...`);

        for (const cert of certs) {
            const reg = cert.registrations;
            const event = reg?.events;
            const fileName = `${cert.serial}.pdf`;
            const localFilePath = path.join(OUTPUT_DIR, fileName);

            // Mark as processing
            await supabase
                .from('certificates')
                .update({
                    status: 'processing',
                    attempts: (cert.attempts || 0) + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cert.id);

            try {
                // Generate PDF
                const pdfBytes = await generateCertificate({
                    fullName: reg?.full_name || 'Participant',
                    eventTitle: event?.name || 'AI Is Not As We Know It',
                    dateStr: event?.event_date || '2026-11-02',
                    serial: cert.serial,
                    outputPath: localFilePath
                });

                // Upload to Supabase Storage if bucket exists
                let publicFilePath = fileName;
                try {
                    const { error: uploadError } = await supabase.storage
                        .from('certificates')
                        .upload(fileName, pdfBytes, {
                            contentType: 'application/pdf',
                            upsert: true
                        });
                    if (uploadError) {
                        console.warn(`Storage upload warning for ${fileName}:`, uploadError.message);
                    }
                } catch (storageEx) {
                    // Non-critical: local file is still saved
                }

                // Mark as ready
                await supabase
                    .from('certificates')
                    .update({
                        status: 'ready',
                        file_path: publicFilePath,
                        last_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cert.id);

                console.log(`[Certificate Worker] Successfully generated: ${cert.serial}`);

            } catch (certErr) {
                console.error(`[Certificate Worker] Failed to generate ${cert.serial}:`, certErr);
                await supabase
                    .from('certificates')
                    .update({
                        status: 'failed',
                        last_error: certErr.message || String(certErr),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', cert.id);
            }
        }

        return certs.length;

    } catch (err) {
        console.error('[Certificate Worker] Error in batch processing:', err);
        return 0;
    }
}

// Continuous worker loop
let isRunning = true;
async function startWorker() {
    console.log('[Certificate Worker] Started. Polling for pending certificates...');
    while (isRunning) {
        const processed = await processBatch();
        const waitTime = processed > 0 ? 500 : POLL_INTERVAL_MS;
        await new Promise(r => setTimeout(r, waitTime));
    }
}

if (require.main === module) {
    process.on('SIGINT', () => { isRunning = false; process.exit(0); });
    process.on('SIGTERM', () => { isRunning = false; process.exit(0); });
    startWorker();
}

module.exports = {
    processBatch,
    startWorker
};
