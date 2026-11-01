// bot/template.js
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Colors
const COLOR_NAVY = rgb(11 / 255, 19 / 255, 43 / 255);
const COLOR_CRIMSON = rgb(165 / 255, 28 / 255, 48 / 255);
const COLOR_GOLD = rgb(212 / 255, 175 / 255, 55 / 255);
const COLOR_GRAY = rgb(100 / 255, 110 / 255, 125 / 255);
const COLOR_WHITE = rgb(1, 1, 1);

// Font path
const LOCAL_FONT_PATH = path.join(__dirname, 'fonts', 'arial.ttf');

/**
 * Generates an official vector PDF Certificate in milliseconds
 */
async function generateCertificate({
    fullName,
    eventTitle = 'AI Is Not As We Know It',
    speakerName = 'Prof. Dr. Dhia Al-Jumeily',
    speakerAffiliation = 'Liverpool John Moores University, UK',
    dateStr = '2026-11-02',
    venue = 'Babil Hall — Alfarabi University',
    serial = 'ALF-2026-00000000',
    verificationUrl = null,
    outputPath = null
}) {
    // 1. Create Landscape A4 Document (841.89 x 595.28 points)
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const width = 841.89;
    const height = 595.28;
    const page = pdfDoc.addPage([width, height]);

    // 2. Load Unicode Font (Supports Arabic and English)
    let mainFont;
    if (fs.existsSync(LOCAL_FONT_PATH)) {
        const fontBytes = fs.readFileSync(LOCAL_FONT_PATH);
        mainFont = await pdfDoc.embedFont(fontBytes);
    } else {
        // Fallback to standard Helvetica if custom font is missing
        mainFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const fontBold = mainFont;
    const fontRegular = mainFont;

    // 3. Elegant Certificate Borders
    // Outer Border
    page.drawRectangle({
        x: 20,
        y: 20,
        width: width - 40,
        height: height - 40,
        borderColor: COLOR_NAVY,
        borderWidth: 4,
        color: COLOR_WHITE
    });

    // Inner Gold Accent Border
    page.drawRectangle({
        x: 28,
        y: 28,
        width: width - 56,
        height: height - 56,
        borderColor: COLOR_GOLD,
        borderWidth: 1.5,
        color: COLOR_WHITE
    });

    // Corner Ornaments
    const cornerSize = 24;
    const corners = [
        [32, height - 32 - cornerSize],
        [width - 32 - cornerSize, height - 32 - cornerSize],
        [32, 32],
        [width - 32 - cornerSize, 32]
    ];
    for (const [cx, cy] of corners) {
        page.drawRectangle({
            x: cx,
            y: cy,
            width: cornerSize,
            height: cornerSize,
            color: COLOR_CRIMSON,
            opacity: 0.15
        });
    }

    // 4. Header: University Branding
    const uniText = 'ALFARABI UNIVERSITY';
    const uniWidth = fontBold.widthOfTextAtSize(uniText, 22);
    page.drawText(uniText, {
        x: (width - uniWidth) / 2,
        y: height - 80,
        size: 22,
        font: fontBold,
        color: COLOR_NAVY
    });

    const uniArText = 'Alfarabi Department of Artificial Intelligence';
    const uniArWidth = fontRegular.widthOfTextAtSize(uniArText, 12);
    page.drawText(uniArText, {
        x: (width - uniArWidth) / 2,
        y: height - 100,
        size: 12,
        font: fontRegular,
        color: COLOR_GOLD
    });

    // Gold divider
    page.drawLine({
        start: { x: width / 2 - 120, y: height - 115 },
        end: { x: width / 2 + 120, y: height - 115 },
        thickness: 2,
        color: COLOR_GOLD
    });

    // 5. Certificate Title
    const certTitle = 'CERTIFICATE OF ATTENDANCE';
    const titleWidth = fontBold.widthOfTextAtSize(certTitle, 26);
    page.drawText(certTitle, {
        x: (width - titleWidth) / 2,
        y: height - 160,
        size: 26,
        font: fontBold,
        color: COLOR_CRIMSON
    });

    const certSubtitle = 'This is proudly presented to:';
    const subWidth = fontRegular.widthOfTextAtSize(certSubtitle, 14);
    page.drawText(certSubtitle, {
        x: (width - subWidth) / 2,
        y: height - 190,
        size: 14,
        font: fontRegular,
        color: COLOR_GRAY
    });

    // 6. Attendee Full Name
    const nameText = fullName || 'Attendee';
    const nameSize = 28;
    const nameWidth = fontBold.widthOfTextAtSize(nameText, nameSize);
    page.drawText(nameText, {
        x: (width - nameWidth) / 2,
        y: height - 240,
        size: nameSize,
        font: fontBold,
        color: COLOR_NAVY
    });

    // Name underline
    page.drawLine({
        start: { x: (width - nameWidth) / 2 - 20, y: height - 250 },
        end: { x: (width + nameWidth) / 2 + 20, y: height - 250 },
        thickness: 1,
        color: COLOR_GOLD
    });

    // 7. Statement of Participation
    const statement1 = 'for participating in the scientific distinguished lecture entitled:';
    const st1Width = fontRegular.widthOfTextAtSize(statement1, 13);
    page.drawText(statement1, {
        x: (width - st1Width) / 2,
        y: height - 280,
        size: 13,
        font: fontRegular,
        color: COLOR_GRAY
    });

    // Lecture Title
    const lectureText = `"${eventTitle}"`;
    const lecWidth = fontBold.widthOfTextAtSize(lectureText, 20);
    page.drawText(lectureText, {
        x: (width - lecWidth) / 2,
        y: height - 315,
        size: 20,
        font: fontBold,
        color: COLOR_CRIMSON
    });

    // Speaker Line
    const speakerText = `Delivered by: ${speakerName} (${speakerAffiliation})`;
    const spkWidth = fontRegular.widthOfTextAtSize(speakerText, 12);
    page.drawText(speakerText, {
        x: (width - spkWidth) / 2,
        y: height - 345,
        size: 12,
        font: fontRegular,
        color: COLOR_NAVY
    });

    // Venue and Date
    const venueText = `Held at ${venue} — Date: ${dateStr}`;
    const venWidth = fontRegular.widthOfTextAtSize(venueText, 11);
    page.drawText(venueText, {
        x: (width - venWidth) / 2,
        y: height - 370,
        size: 11,
        font: fontRegular,
        color: COLOR_GRAY
    });

    // 8. Generate QR Code for online verification
    const verifyUrl = verificationUrl || `https://alfarabiuc.edu.iq/verify?serial=${encodeURIComponent(serial)}`;
    const qrBuffer = await QRCode.toBuffer(verifyUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 80
    });
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    page.drawImage(qrImage, {
        x: 60,
        y: 50,
        width: 70,
        height: 70
    });

    page.drawText(`Serial: ${serial}`, {
        x: 60,
        y: 40,
        size: 8,
        font: fontRegular,
        color: COLOR_GRAY
    });

    // 9. Signatures Block
    const sigLineY = 85;
    page.drawLine({
        start: { x: width - 260, y: sigLineY },
        end: { x: width - 60, y: sigLineY },
        thickness: 1,
        color: COLOR_NAVY
    });

    const sigText1 = 'Department of Artificial Intelligence';
    const sig1Width = fontBold.widthOfTextAtSize(sigText1, 10);
    page.drawText(sigText1, {
        x: width - 160 - sig1Width / 2,
        y: sigLineY - 15,
        size: 10,
        font: fontBold,
        color: COLOR_NAVY
    });

    const sigText2 = 'Alfarabi University — Baghdad, Iraq';
    const sig2Width = fontRegular.widthOfTextAtSize(sigText2, 9);
    page.drawText(sigText2, {
        x: width - 160 - sig2Width / 2,
        y: sigLineY - 28,
        size: 9,
        font: fontRegular,
        color: COLOR_GRAY
    });

    // 10. Save PDF
    const pdfBytes = await pdfDoc.save();

    if (outputPath) {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, pdfBytes);
    }

    return pdfBytes;
}

module.exports = {
    generateCertificate
};
