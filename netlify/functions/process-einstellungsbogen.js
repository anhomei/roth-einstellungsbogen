const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// E-Mail Konfiguration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// PDF generieren
function generatePDF(data, fileName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40
    });

    const tmpFile = path.join(os.tmpdir(), fileName);
    const stream = fs.createWriteStream(tmpFile);

    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve(tmpFile));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Roth GmbH', { align: 'center' });
    doc.fontSize(14).text('Onboarding-Formular Personalfragebogen', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text('Eingereicht: ' + new Date().toLocaleDateString('de-DE'), { align: 'right' });
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(1);

    // Persönliche Angaben
    const familienname = data.familienname || '-';
    const vorname = data.vorname || '-';

    doc.fontSize(12).font('Helvetica-Bold').text('Persönliche Angaben');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${familienname}, ${vorname}`, { indent: 20 });
    doc.text(`Geburtsdatum: ${data.geburtsdatum || '-'}`, { indent: 20 });
    doc.text(`Geburtsort: ${data.geburtsort || '-'}`, { indent: 20 });
    doc.text(`Anschrift: ${data.strasse || '-'}, ${data.plz || ''} ${data.ort || ''}`, { indent: 20 });
    doc.text(`Telefon: ${data.telefon || '-'}`, { indent: 20 });
    doc.text(`Staatsangehörigkeit: ${data.staatsangehoerigkeit || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    // Beschäftigungsverhältnis
    doc.fontSize(12).font('Helvetica-Bold').text('Beschäftigungsverhältnis');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Eintrittsdatum: ${data.eintrittsdatum || '-'}`, { indent: 20 });
    doc.text(`Tätigkeit: ${data.taetigkeit || '-'}`, { indent: 20 });
    doc.text(`Arbeitnehmergruppe: ${data.arbeitnehmergruppe || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    // Sozialversicherung
    doc.fontSize(12).font('Helvetica-Bold').text('Sozialversicherung');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Versicherungsnummer: ${data.versicherungsnummer || '-'}`, { indent: 20 });
    doc.text(`Krankenkasse: ${data.krankenkasse || '-'}`, { indent: 20 });
    doc.moveDown(0.5);

    // Steuerliche Angaben
    doc.fontSize(12).font('Helvetica-Bold').text('Steuerliche Angaben');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Steuer-ID: ${data.steuer_id || '-'}`, { indent: 20 });
    doc.text(`IBAN: ${data.iban || '-'}`, { indent: 20 });
    doc.moveDown(1);

    // Footer
    doc.fontSize(9).text('Dieses Dokument wurde automatisch generiert.', { align: 'center' });
    doc.text('Roth GmbH | Kaiserslautern', { align: 'center' });

    doc.pipe(stream);
    doc.end();
  });
}

// Zu GitHub committen
async function commitToGithub(pdfPath, familienname, vorname) {
  try {
    const filename = `Einstellungsbogen_${familienname}_${vorname}_${new Date().toISOString().split('T')[0]}.pdf`;
    const repoPath = process.env.GITHUB_REPO_PATH || '/tmp/roth-einstellungsbogen';
    const submissionsDir = path.join(repoPath, 'submissions');

    // Stelle sicher, dass das Verzeichnis existiert
    if (!fs.existsSync(submissionsDir)) {
      fs.mkdirSync(submissionsDir, { recursive: true });
    }

    // Kopiere PDF ins submissions-Verzeichnis
    const destPath = path.join(submissionsDir, filename);
    fs.copyFileSync(pdfPath, destPath);

    // Git Commit
    execSync(`cd ${repoPath} && git add submissions/${filename}`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git config user.email "github-actions@roth-gmbh.de"`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git config user.name "Netlify Bot"`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git commit -m "Add: ${filename} (Netlify Forms Submission)"`, { encoding: 'utf-8' });
    execSync(`cd ${repoPath} && git push origin main`, { encoding: 'utf-8' });

    return { success: true, filename, message: `PDF committed: ${filename}` };
  } catch (error) {
    console.error('Git Error:', error.message);
    return { success: false, error: error.message };
  }
}

// E-Mail senden
async function sendEmail(data, familienname, vorname, filename) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'andreas.meiser@rothgmbh-kl.de',
      subject: `Neue Submission: ${familienname}, ${vorname}`,
      html: `
        <h2>Neue Onboarding-Submission</h2>
        <p><strong>Mitarbeiter:</strong> ${vorname} ${familienname}</p>
        <p><strong>Eintrittsdatum:</strong> ${data.eintrittsdatum || '-'}</p>
        <p><strong>Tätigkeit:</strong> ${data.taetigkeit || '-'}</p>
        <p><strong>Kontakt:</strong> ${data.telefon || '-'}</p>
        <hr>
        <p><strong>Dateiname:</strong> ${filename}</p>
        <p><a href="https://github.com/anhomei/roth-einstellungsbogen/blob/main/submissions/${filename}">PDF in GitHub anschauen</a></p>
        <p style="color: #999; font-size: 12px;">Diese E-Mail wurde automatisch von Netlify Forms generiert.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    return { success: true, message: 'E-Mail gesendet' };
  } catch (error) {
    console.error('Email Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Hauptfunktion
exports.handler = async (event) => {
  console.log('=== Netlify Forms Submission ===');

  try {
    // Payload parsen
    const payload = JSON.parse(event.body);
    const data = payload.data || {};

    console.log('Received data:', data);

    // Validierung
    const familienname = (data.familienname || 'Unbekannt').replace(/[^a-zA-ZäöüßÄÖÜ\s-]/g, '');
    const vorname = (data.vorname || 'Unbekannt').replace(/[^a-zA-ZäöüßÄÖÜ\s-]/g, '');

    // PDF generieren
    const fileName = `Einstellungsbogen_${familienname}_${vorname}_temp.pdf`;
    console.log('Generating PDF:', fileName);
    const pdfPath = await generatePDF(data, fileName);
    console.log('PDF created:', pdfPath);

    // Zu GitHub committen (optional — kann fehlschlagen)
    let gitResult = { success: false };
    if (process.env.GITHUB_TOKEN) {
      gitResult = await commitToGithub(pdfPath, familienname, vorname);
      console.log('Git result:', gitResult);
    } else {
      console.log('GITHUB_TOKEN nicht gesetzt, überspringe Git Commit');
    }

    // E-Mail senden
    const finalFilename = `Einstellungsbogen_${familienname}_${vorname}_${new Date().toISOString().split('T')[0]}.pdf`;
    const emailResult = await sendEmail(data, familienname, vorname, finalFilename);
    console.log('Email result:', emailResult);

    // Cleanup
    try {
      fs.unlinkSync(pdfPath);
    } catch (e) {
      // Ignoriere Fehler beim Löschen
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Submission verarbeitet',
        filename: finalFilename,
        git: gitResult,
        email: emailResult
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
