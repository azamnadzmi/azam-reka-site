// api/_lib/easyparcel.js
// Client for EasyParcel's real API (form-encoded POST, ?ac=<Action>, single
// `api` key param). Verified against the official Malaysia Individual API
// PDF at developers.easyparcel.com — NOT the REST/OAuth shape that shows up
// in some AI summaries of the EasyParcel GitHub repo, which describes an API
// that does not exist.
//
// Base URL:
//   Demo (sandbox): http://demo.connect.easyparcel.my/
//   Live:           http://connect.easyparcel.my/
// Every call is POST, application/x-www-form-urlencoded, to `${base}?ac=${action}`.
// Bulk endpoints take a `bulk` array of request rows and return one result
// row per input row, in order — this wrapper always sends a single-row bulk
// array and unwraps `result[0]`, since every caller here books one parcel.

const EASYPARCEL_API_KEY = process.env.EASYPARCEL_API_KEY;
const EASYPARCEL_ENV = process.env.EASYPARCEL_ENV || 'live'; // 'live' | 'demo'

const BASE_URL = EASYPARCEL_ENV === 'demo'
  ? 'http://demo.connect.easyparcel.my/'
  : 'http://connect.easyparcel.my/';

// Appendix I of the API doc — these are the only api_status/error_code values
// EasyParcel returns at the transport level (auth/format errors, not courier
// errors — courier-level failures show up per-row in result[].status/remarks).
const API_ERROR_MESSAGES = {
  1: 'Required authentication key',
  2: 'Invalid authentication key',
  3: 'Required api key',
  4: 'Invalid api key',
  5: 'Unauthorized user',
  6: 'Invalid data insert format in array'
};

// The only two couriers Azam Reka books through — see MELPLUS_MATCH below for
// how a live courier/service name gets classified as one of these.
const ALLOWED_COURIERS = ['MELPLUS', 'JNT'];

// Fixed pickup point for every shipment — Azam Reka has one origin address.
const SENDER_ADDRESS = {
  name: 'Azam Nadzmi',
  company: '@azam.reka',
  contact: '+601155094344',  // primary contact (from EasyParcel account's saved sender address)
  mobile: '+6084369659',     // secondary contact
  addr1: 'Bora Residences, A24-06, Jalan Danga 1/1',
  addr2: '',
  city: 'Johor Bahru',
  state: 'jhr',
  postcode: '80200'
};

// Appendix III of the API doc — full Malaysian state list with EasyParcel's
// 3-letter codes. Used to build the checkout state <select> and to validate
// state codes server-side before calling EasyParcel.
const MY_STATES = [
  { code: 'jhr', name: 'Johor' },
  { code: 'kdh', name: 'Kedah' },
  { code: 'ktn', name: 'Kelantan' },
  { code: 'mlk', name: 'Melaka' },
  { code: 'nsn', name: 'Negeri Sembilan' },
  { code: 'phg', name: 'Pahang' },
  { code: 'prk', name: 'Perak' },
  { code: 'pls', name: 'Perlis' },
  { code: 'png', name: 'Pulau Pinang' },
  { code: 'sgr', name: 'Selangor' },
  { code: 'trg', name: 'Terengganu' },
  { code: 'kul', name: 'Kuala Lumpur' },
  { code: 'pjy', name: 'Putrajaya' },
  { code: 'srw', name: 'Sarawak' },
  { code: 'sbh', name: 'Sabah' },
  { code: 'lbn', name: 'Labuan' }
];

function classifyCourier(rate) {
  const hay = `${rate.courier_name || ''} ${rate.service_name || ''}`.toLowerCase();
  // MelPlus is a branded service run by Poslaju, not a courier_name of its
  // own in EasyParcel's catalogue — match on either "melplus" or "poslaju".
  if (hay.includes('melplus') || hay.includes('poslaju')) return 'MELPLUS';
  if (hay.includes('j&t') || hay.includes('jnt') || hay.includes('j & t')) return 'JNT';
  return null;
}

async function callEasyParcel(action, params) {
  if (!EASYPARCEL_API_KEY) {
    throw new Error('EASYPARCEL_API_KEY is not set');
  }

  const body = new URLSearchParams();
  body.append('api', EASYPARCEL_API_KEY);
  if (params.bulk) {
    // PHP's http_build_query encodes nested arrays as bulk[0][key]=value —
    // URLSearchParams needs the same encoding done by hand.
    params.bulk.forEach((row, i) => {
      Object.entries(row).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          body.append(`bulk[${i}][${key}]`, value);
        }
      });
    });
  } else {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) body.append(key, value);
    });
  }

  const response = await fetch(`${BASE_URL}?ac=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error(`EasyParcel HTTP ${response.status} on ${action}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`EasyParcel returned non-JSON for ${action}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.api_status !== 'Success') {
    const code = Number(data.error_code);
    const msg = data.error_remark || API_ERROR_MESSAGES[code] || 'Unknown EasyParcel error';
    throw new Error(`EasyParcel error ${data.error_code}: ${msg}`);
  }

  return data.result;
}

// --- Rate checking -----------------------------------------------------

/**
 * Get live courier rates between two Malaysian addresses, filtered to the
 * two couriers Azam Reka actually books (MelPlus/Poslaju, J&T).
 * @returns {Array<{courier: 'MELPLUS'|'JNT', courierName, serviceId, serviceName, price, delivery}>}
 */
async function checkRates({ pickCode, pickState, sendCode, sendState, weight, dateColl }) {
  const [row] = await callEasyParcel('EPRateCheckingBulk', {
    bulk: [{
      pick_code: pickCode,
      pick_state: pickState,
      pick_country: 'MY',
      send_code: sendCode,
      send_state: sendState,
      send_country: 'MY',
      weight: weight.toFixed(2),
      date_coll: dateColl
    }]
  });

  if (row.status !== 'Success') {
    throw new Error(`Rate check failed: ${row.remarks || 'no remarks'}`);
  }

  const matched = [];
  for (const rate of row.rates || []) {
    const courier = classifyCourier(rate);
    if (!courier) continue;
    matched.push({
      courier,
      courierName: rate.courier_name,
      serviceId: rate.service_id,
      serviceName: rate.service_name,
      price: parseFloat(rate.price),
      delivery: rate.delivery
    });
  }
  return matched.sort((a, b) => a.price - b.price);
}

// --- Order submission + payment ----------------------------------------

/**
 * Book a parcel: submit the order, then immediately pay it (spends EasyParcel
 * wallet credit). Returns the tracking number (awb) and label link.
 * Caller is responsible for only invoking this when they actually intend to
 * spend money — there is no dry-run mode for EPSubmitOrderBulk.
 */
async function bookShipment({ sender, receiver, parcel, serviceId, dateColl }) {
  const [submitRow] = await callEasyParcel('EPSubmitOrderBulk', {
    bulk: [{
      weight: parcel.weight.toFixed(2),
      content: parcel.content,
      value: parcel.value.toFixed(2),
      service_id: serviceId,
      pick_name: sender.name,
      pick_company: sender.company || '',
      pick_contact: sender.contact,
      pick_mobile: sender.mobile || '',
      pick_addr1: sender.addr1,
      pick_addr2: sender.addr2 || '',
      pick_city: sender.city,
      pick_state: sender.state,
      pick_code: sender.postcode,
      pick_country: 'MY',
      send_name: receiver.name,
      send_contact: receiver.contact,
      send_addr1: receiver.addr1,
      send_addr2: receiver.addr2 || '',
      send_city: receiver.city,
      send_state: receiver.state,
      send_code: receiver.postcode,
      send_country: 'MY',
      collect_date: dateColl,
      sms: '0',
      send_email: receiver.email || ''
    }]
  });

  if (submitRow.status !== 'Success') {
    throw new Error(`Order submission failed: ${submitRow.remarks || 'no remarks'}`);
  }

  const orderNo = submitRow.order_number;

  const [payRow] = await callEasyParcel('EPPayOrderBulk', {
    bulk: [{ order_no: orderNo }]
  });

  const parcelInfo = (payRow.parcel && payRow.parcel[0]) || {};

  return {
    orderNo,
    price: parseFloat(submitRow.price),
    courierName: submitRow.courier,
    paymentMessage: payRow.messagenow,
    trackingNumber: parcelInfo.awb || '',
    labelUrl: parcelInfo.awb_id_link || ''
  };
}

// --- Tracking ------------------------------------------------------------

/**
 * Live tracking status by airway bill (tracking) number.
 * @returns {{latestStatus, latestUpdate, events: Array<{date,time,status,location}>}}
 */
async function trackParcel(awbNo) {
  const [row] = await callEasyParcel('EPTrackingBulk', {
    bulk: [{ awb_no: awbNo }]
  });

  const statusList = row.status_list || {};
  const events = Object.keys(statusList)
    .filter(k => k !== 'status' && k !== 'sender' && k !== 'receiver')
    .map(k => statusList[k])
    .filter(e => e && e.event_date)
    .map(e => ({ date: e.event_date, time: e.event_time, status: e.status, location: e.location }));

  return {
    latestStatus: row.latest_status,
    latestUpdate: row.latest_update,
    events
  };
}

module.exports = {
  checkRates,
  bookShipment,
  trackParcel,
  classifyCourier,
  ALLOWED_COURIERS,
  SENDER_ADDRESS,
  MY_STATES
};
