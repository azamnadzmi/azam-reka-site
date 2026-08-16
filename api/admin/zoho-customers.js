// api/admin/zoho-customers.js
// Fetch list of Zoho customers for admin dropdown/selection

const { getAccessToken, zohoFetch } = require('../_lib/zoho-books');

const adminPassword = process.env.ADMIN_PASSWORD;
const zohoClientId = process.env.ZOHO_CLIENT_ID;
const zohoClientSecret = process.env.ZOHO_CLIENT_SECRET;
const zohoRefreshToken = process.env.ZOHO_REFRESH_TOKEN;
const zohoOrgId = process.env.ZOHO_ORGANIZATION_ID;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { search } = req.query;
    const password = req.headers['x-admin-password'];

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get Zoho access token
    let accessToken;
    try {
      accessToken = await getAccessToken(zohoClientId, zohoClientSecret, zohoRefreshToken);
    } catch (error) {
      console.error('Zoho token error:', error);
      return res.status(500).json({ error: 'Failed to authenticate with Zoho' });
    }

    // Fetch contacts from Zoho
    let contacts = [];
    try {
      const response = await zohoFetch(accessToken, '/books/v3/contacts', {
        method: 'GET',
        headers: { 'X-com-zoho-books-organizationid': zohoOrgId }
      });

      const data = response;
      if (data.contacts && Array.isArray(data.contacts)) {
        contacts = data.contacts
          .filter(c => c.contact_status === 'active')
          .map(c => ({
            id: c.contact_id,
            name: c.contact_name,
            email: c.email || '',
            phone: c.phone || '',
            customerId: c.customer_id || null
          }));
      }

      // Filter by search query if provided
      if (search) {
        const q = search.toLowerCase();
        contacts = contacts.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q)
        );
      }

      // Limit results
      contacts = contacts.slice(0, 50);
    } catch (error) {
      console.error('Zoho fetch contacts error:', error);
      return res.status(500).json({ error: 'Failed to fetch Zoho customers' });
    }

    return res.status(200).json({ customers: contacts });
  } catch (error) {
    console.error('Zoho customers error:', error);
    return res.status(500).json({ error: 'Failed to fetch customers' });
  }
}
