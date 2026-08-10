// api/toyyibpay-test.js
// Diagnostic endpoint to test ToyyibPay credentials

const toyyibPayApiKey = process.env.TOYYIBPAY_API_KEY;
const toyyibPayCategoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;

module.exports = async function handler(req, res) {
  try {
    // Check if credentials are set
    const credentialsStatus = {
      apiKeySet: !!toyyibPayApiKey,
      apiKeyLength: toyyibPayApiKey ? toyyibPayApiKey.length : 0,
      categoryCodeSet: !!toyyibPayCategoryCode,
      categoryCode: toyyibPayCategoryCode || 'NOT SET',
      timestamp: new Date().toISOString()
    };

    // Test 1: Check if values exist
    if (!toyyibPayApiKey || !toyyibPayCategoryCode) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Missing credentials',
        details: credentialsStatus
      });
    }

    // Test 2: Try a minimal API call to ToyyibPay
    const testParams = new URLSearchParams();
    testParams.append('apikey', toyyibPayApiKey);
    testParams.append('categoryCode', toyyibPayCategoryCode);
    testParams.append('billName', 'TEST');
    testParams.append('billDescription', 'Diagnostic test');
    testParams.append('billPriceSetting', 1);
    testParams.append('billAmount', 100); // RM 1.00

    const response = await fetch('https://toyyibpay.com/api/bill/create', {
      method: 'POST',
      body: testParams,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const contentType = response.headers.get('content-type');
    const responseText = await response.text();

    return res.status(200).json({
      status: 'TEST_COMPLETE',
      credentials: credentialsStatus,
      apiResponse: {
        httpStatus: response.status,
        contentType: contentType,
        bodyPreview: responseText.substring(0, 200),
        bodyLength: responseText.length
      },
      diagnosis: getDiagnosis(response.status, responseText)
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: error.message,
      stack: error.stack
    });
  }
};

function getDiagnosis(status, body) {
  if (status === 404) {
    return {
      issue: '404 Not Found',
      likely_cause: 'API Key or Category Code is invalid/wrong',
      action: [
        '1. Log into https://toyyibpay.com/',
        '2. Go to Settings/Business Profile',
        '3. Copy your API Key (should be alphanumeric string)',
        '4. Copy your Category Code (should be a number)',
        '5. Verify these are correct in Vercel environment variables',
        '6. Redeploy and try again'
      ]
    };
  } else if (status === 401) {
    return {
      issue: '401 Unauthorized',
      likely_cause: 'API Key is invalid or revoked',
      action: ['Regenerate your API Key in ToyyibPay dashboard']
    };
  } else if (status === 200) {
    if (body.includes('status') && body.includes('200')) {
      return { issue: 'SUCCESS', message: '✓ API Key and Category Code are correct!' };
    } else {
      return { issue: 'Unclear', message: body };
    }
  } else {
    return { issue: `HTTP ${status}`, message: body.substring(0, 100) };
  }
}
