const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// PDF im RAM generieren (Buffer, nicht auf Disk)
function generatePDFBuffer(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // Inhalt
    doc.fontSize(20).font('Helvetica-Bold').text('Roth GmbH', { align: 'center' });
    doc.fontSize(14).text('Onboarding-Formular', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text('Eingereicht: ' + new Date().toLocaleDateString('de-DE'), { align: 'right' });
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').text('Persönliche Angaben');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${data.familienname || '-'}, ${data.vorname || '-'}`, { indent: 20 });
    doc.text(`Geburtsdatum: ${data.geburtsdatum || '-'}`, { indent: 20 });
    doc.text(`Geburtsort: ${data.geburtsort || '-'}`, { indent: 20 });
    doc.text(`Anschrift: ${data.strasse || '-'}, ${data.plz || ''} ${data.ort || ''}`, { indent: 20 });
    doc.text(`Telefon: ${data.telefon || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Beschäftigungsverhältnis');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Eintrittsdatum: ${data.eintrittsdatum || '-'}`, { indent: 20 });
    doc.text(`Tätigkeit: ${data.taetigkeit || '-'}`, { indent: 20 });
    doc.text(`Arbeitnehmergruppe: ${data.arbeitnehmergruppe || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Sozialversicherung & Steuern');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Versicherungsnummer: ${data.versicherungsnummer || '-'}`, { indent: 20 });
    doc.text(`Krankenkasse: ${data.krankenkasse || '-'}`, { indent: 20 });
    doc.text(`Steuer-ID: ${data.steuer_id || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica-Bold').text('Bankverbindung');
    doc.fontSize(10).font('Helvetica');
    doc.text(`IBAN: ${data.iban || '-'}`, { indent: 20 });
    doc.text(`Bank: ${data.bank || '-'}`, { indent: 20 });
    doc.moveDown(1);

    doc.fontSize(9).text('Automatisch generiert von Netlify Forms', { align: 'center' });

    doc.end();
  });
}

// Zu GitHub committen
async function commitToGithub(pdfBuffer, familienname, vorname) {
  try {
    const filename = `Einstellungsbogen_${familienname}_${vorname}_${new Date().toISOString().split('T')[0]}.pdf`;
    const repoPath = '/tmp/roth-repo';
    const submissionsDir = path.join(repoPath, 'submissions');

    // Repo klonen (falls nicht vorhanden)
    if (!fs.existsSync(repoPath)) {
      execSync(`git clone https://${process.env.GITHUB_TOKEN}@github.com/anhomei/roth-einstellungsbogen.git ${repoPath}`, { encoding: 'utf-8' });
    }

    // submissions-Ordner erstellen
    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }

    // PDF schreiben
    const destPath = path.join(submissionsDir, filename);
    fs.writeFileSync(destPath, pdfBuffer);

    // Git Commit
    execSync(`cd ${repoPath} && git config user.email "netlify@roth-gmbh.de" && git config user.name "Netlify Forms"`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git add submissions/${filename}`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git commit -m "Submission: ${filename}"`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git push`, { encoding: 'utf-8' });

    return { success: true, filename };
  } catch (error) {
    console.warn('Git warning:', error.message);
    return { success: false, error: error.message };
  }
}

// E-Mail mit PDF-Anhang senden
async function sendEmail(data, familienname, vorname, filename, pdfBuffer) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'andreas.meiser@rothgmbh-kl.de',
      subject: `✅ Neue Submission: ${vorname} ${familienname}`,
      html: `
        <h2>Neue Onboarding-Submission</h2>
        <p><strong>Mitarbeiter:</strong> ${vorname} ${familienname}</p>
        <p><strong>Eintrittsdatum:</strong> ${data.eintrittsdatum || '-'}</p>
        <p><strong>Tätigkeit:</strong> ${data.taetigkeit || '-'}</p>
        <p><strong>Kontakt:</strong> ${data.telefon || '-'}</p>
        <hr>
        <p>PDF als Anhang anbei.</p>
        <p style="color: #999; font-size: 12px;">Auch verfügbar: https://github.com/anhomei/roth-einstellungsbogen/tree/main/submissions</p>
      `,
      attachments: [
        {
          filename: filename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Email error:', error.message);
    return { success: false, error: error.message };
  }
}

// Main Handler
exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body);
    const data = payload.data || {};

    const familienname = (data.familienname || 'Unbekannt').replace(/[^a-zA-ZäöüßÄÖÜ\s-]/g, '');
    const vorname = (data.vorname || 'Unbekannt').replace(/[^a-zA-ZäöüßÄÖÜ\s-]/g, '');
    const filename = `Einstellungsbogen_${familienname}_${vorname}_${new Date().toISOString().split('T')[0]}.pdf`;

    console.log(`Processing: ${vorname} ${familienname}`);

    // PDF generieren (RAM)
    const pdfBuffer = await generatePDFBuffer(data);
    console.log(`PDF generated: ${pdfBuffer.length} bytes`);

    // E-Mail senden
    const emailResult = await sendEmail(data, familienname, vorname, filename, pdfBuffer);
    console.log(`Email sent:`, emailResult);

    // GitHub committen (optional)
    const gitResult = process.env.GITHUB_TOKEN
      ? await commitToGithub(pdfBuffer, familienname, vorname)
      : { success: false, message: 'GITHUB_TOKEN not set' };
    console.log(`GitHub:`, gitResult);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Submission erfolgreich verarbeitet',
        filename: filename,
        email: emailResult.success ? 'gesendet' : 'fehler',
        github: gitResult.success ? 'committed' : 'übersprungen'
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
