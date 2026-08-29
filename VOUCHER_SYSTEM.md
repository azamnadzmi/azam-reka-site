# Voucher Code System

## Overview

A complete voucher/discount code system for the Azam Reka e-commerce site, supporting flexible discount configurations and usage tracking.

## Database Schema

### Vouchers Collection

```javascript
{
  _id: ObjectId,
  code: "RM20-ABCD1234",           // Unique voucher code
  discountValue: 20,                // Discount amount in RM or percentage
  discountType: "fixed",            // "fixed" or "percentage"
  maxUses: 1,                       // Max uses allowed (null = unlimited)
  currentUses: 0,                   // Current usage count
  minOrderValue: 0,                 // Minimum order amount required
  active: true,                     // Is voucher active?
  createdAt: Date,                  // Creation timestamp
  expiresAt: Date,                  // Expiration date (1 year from creation)
  appliedOrders: [ObjectId, ...]    // Array of order IDs this voucher was used for
}
```

### Order Schema (Updated)

When a voucher is applied to an order, the order document is updated with:

```javascript
{
  // ... existing order fields ...
  voucherCode: "RM20-ABCD1234",
  discountAmount: 20,               // Discount amount applied in RM
  updatedAt: Date
}
```

## Admin Commands

### Generate Voucher Codes

Generate 5 RM20 voucher codes (default):

```bash
node scripts/generate-vouchers.js
```

Generate 10 codes with RM30 discount:

```bash
node scripts/generate-vouchers.js --count 10 --value 30
```

**Output Example:**
```
✓ Generated 5 voucher codes:
  1. RM20-ABC12345 - RM20 discount
  2. RM20-XYZ98765 - RM20 discount
  3. RM20-QWE54321 - RM20 discount
  4. RM20-RTY11111 - RM20 discount
  5. RM20-UIO22222 - RM20 discount
```

### List All Vouchers

```bash
curl -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  https://azamreka.com/api/admin/list-vouchers
```

**Response:**
```json
{
  "success": true,
  "total": 5,
  "active": 5,
  "vouchers": [
    {
      "_id": "...",
      "code": "RM20-ABC12345",
      "discountValue": 20,
      "discountType": "fixed",
      "active": true,
      "maxUses": 1,
      "currentUses": 0,
      "usageRemaining": 1,
      "minOrderValue": 0,
      "createdAt": "2026-08-28T10:00:00Z",
      "expiresAt": "2027-08-28T10:00:00Z",
      "appliedOrders": 0
    }
  ]
}
```

## API Endpoints

### 1. Validate Voucher (`POST /api/validate-voucher`)

Validates a voucher code and calculates the discount amount.

**Request:**
```json
{
  "code": "RM20-ABC12345",
  "orderTotal": 75.50
}
```

**Success Response (200):**
```json
{
  "valid": true,
  "voucherId": "...",
  "code": "RM20-ABC12345",
  "discountType": "fixed",
  "discountValue": 20,
  "discountAmount": 20.00,
  "finalTotal": 55.50
}
```

**Error Responses:**
- `404`: Voucher code not found
- `400`: Voucher expired, inactive, usage limit reached, or minimum order not met

### 2. Apply Voucher (`POST /api/apply-voucher`)

Applies a voucher to a confirmed order. Call after payment is confirmed.

**Request:**
```json
{
  "orderId": "...",
  "voucherCode": "RM20-ABC12345"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "orderId": "...",
  "voucherCode": "RM20-ABC12345",
  "discountAmount": 20,
  "message": "RM20 discount applied"
}
```

**Error Responses:**
- `404`: Order or voucher not found
- `400`: Voucher already applied, invalid, or limit reached

## Integration with Checkout Flow

### Frontend (checkout.html)

1. **Input Field** (already exists):
   ```html
   <div class="summary-promo">
     <input type="text" id="promoCode" placeholder="Discount code or gift card">
     <button id="applyPromo">Apply</button>
   </div>
   ```

2. **JavaScript Handler** (add to checkout):
   ```javascript
   document.getElementById('applyPromo').addEventListener('click', async () => {
     const code = document.getElementById('promoCode').value;
     if (!code) return;

     const response = await fetch('/api/validate-voucher', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         code,
         orderTotal: subtotal + effectiveShipping + rushCharge
       })
     });

     if (response.ok) {
       const result = await response.json();
       // Update UI with discount
       document.getElementById('discountAmount').textContent = 
         `RM ${result.discountAmount.toFixed(2)}`;
       document.getElementById('finalTotal').textContent = 
         `RM ${result.finalTotal.toFixed(2)}`;
       // Store voucher for order creation
       currentVoucher = result;
     } else {
       const error = await response.json();
       alert(`Voucher invalid: ${error.error}`);
     }
   });
   ```

3. **When Creating Order** (in payment creation):
   ```javascript
   const orderData = {
     // ... existing fields ...
     voucherId: currentVoucher?.voucherId,
     voucherCode: currentVoucher?.code,
     voucherDiscount: currentVoucher?.discountAmount || 0
   };
   ```

### Backend Integration

The `/api/create-payment` endpoint should be updated to:

1. Accept `voucherId`, `voucherCode`, and `voucherDiscount` in the request
2. Store these in the order document
3. Call `/api/apply-voucher` after payment confirmation

## Voucher Lifecycle

```
Create Voucher (unique code generated)
    ↓
   [Distributed to customer]
    ↓
Customer enters code in checkout
    ↓
Frontend validates via /api/validate-voucher
    ↓
Shows discount in order summary
    ↓
Customer completes payment
    ↓
Order created with voucherCode/discount fields
    ↓
/api/apply-voucher called to increment usage
    ↓
Voucher becomes "used" (if maxUses = 1)
```

## Configuration

Add to `.env`:

```
ADMIN_API_KEY=your-secure-random-key
```

## Example: Generate 5 RM20 Codes

```bash
# Generate codes
node api/admin/generate-vouchers.js --count 5 --value 20

# List generated codes
curl -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  http://localhost:3000/api/admin/list-vouchers
```

## Safety Features

- ✓ Unique codes (enforced via MongoDB unique index)
- ✓ Usage tracking and limits
- ✓ Expiration dates
- ✓ Min order value requirements
- ✓ Active/inactive status
- ✓ Admin authentication for sensitive endpoints
- ✓ Discount cap (cannot exceed order total)

## Future Enhancements

- [ ] Percentage-based discounts
- [ ] Date range restrictions
- [ ] User-specific codes
- [ ] Bulk upload of codes
- [ ] Voucher analytics dashboard
- [ ] Email notifications on expiry
- [ ] Code deactivation tools
