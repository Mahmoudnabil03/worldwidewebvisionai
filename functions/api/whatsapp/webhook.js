/* Meta WhatsApp webhook — https://www.visionguardeg.com/api/whatsapp/webhook
 *
 * This is the URL registered in the Meta dashboard, so it has to exist at
 * this path. It is the same handler as /api/order-webhook, re-exported rather
 * than reimplemented: two copies of a webhook is exactly how the previous
 * pair drifted apart, one of them still reading secret names that had been
 * renamed months earlier.
 *
 * Both paths therefore behave identically — verification, delivery receipts,
 * and the ?diag=1 configuration report. Whichever one is configured in Meta
 * works, and there is one place to change.
 */
export { onRequest } from '../order-webhook.js';
