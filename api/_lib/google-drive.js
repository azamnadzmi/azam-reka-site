// api/_lib/google-drive.js
// Uploads message-attachment images to a shared Google Drive folder using a
// Service Account (a "robot" identity — no interactive OAuth consent screen,
// no rotating refresh token to babysit like EasyParcel's). One-time setup:
// create a Service Account in Google Cloud Console, share a Drive folder
// with its email, save its key as GOOGLE_SERVICE_ACCOUNT_KEY (the full JSON
// key file contents, as a single-line env var).

const { JWT } = require('google-auth-library');

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SERVICE_ACCOUNT_KEY_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;
  if (!SERVICE_ACCOUNT_KEY_RAW || !DRIVE_FOLDER_ID) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_DRIVE_FOLDER_ID not fully set');
  }
  const key = JSON.parse(SERVICE_ACCOUNT_KEY_RAW);
  cachedClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  return cachedClient;
}

/**
 * Uploads a base64-encoded image to the shared Drive folder and makes it
 * viewable by anyone with the link (needed so customers/admin can see it
 * in the chat thread without their own Drive access).
 *
 * @param {string} base64Data - raw base64 (no "data:image/..." prefix)
 * @param {string} mimeType - e.g. "image/jpeg"
 * @param {string} filename
 * @returns {Promise<string>} a directly-viewable URL
 */
async function uploadImage(base64Data, mimeType, filename) {
  const client = getClient();
  const { access_token } = await client.getAccessToken();

  const boundary = 'azamreka' + Date.now();
  const metadata = { name: filename, parents: [DRIVE_FOLDER_ID] };
  const buffer = Buffer.from(base64Data, 'base64');

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n`
    ),
    Buffer.from(buffer.toString('base64')),
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error(`Drive upload failed: ${JSON.stringify(uploadData).slice(0, 300)}`);
  }

  // Anyone-with-the-link viewer access — matches how the message thread
  // is shared (billCode + phone, not a Google login).
  await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  return `https://drive.google.com/uc?export=view&id=${uploadData.id}`;
}

module.exports = { uploadImage };
