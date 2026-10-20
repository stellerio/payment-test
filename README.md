# Payment Test

A starter online store with **real Stripe Checkout and PayPal Checkout integrations**. Card details are entered on the payment providers' hosted checkout; this app does not store card numbers.

## What works

- Stripe-hosted checkout for cards and payment methods enabled for your Stripe account.
- Eligible Apple Pay / Google Pay options when supported by Stripe, your domain, currency, device, and buyer location.
- PayPal order creation and capture through the server.
- Server-side price configuration and Stripe session verification.
- Stripe webhook signature verification endpoint.

**This is not ready to accept public real-money orders yet.** The Stripe webhook currently logs paid sessions but does not create an order record or deliver products. Add persistent order storage and reliable fulfillment before selling downloads or other goods.

## Setup

1. Use Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add provider credentials to `.env`. Never commit `.env` or put secret keys in browser code.
5. Run `npm start` and open `http://localhost:3000`.

Configure these product values in `.env`:
- `PRODUCT_NAME`
- `PRODUCT_DESCRIPTION`
- `PRODUCT_PRICE_CENTS` (500 means $5.00)
- `PRODUCT_CURRENCY` (e.g. usd)

## Stripe

1. Create a Stripe account at https://dashboard.stripe.com/.
2. Start in test mode and set `STRIPE_SECRET_KEY` to your test secret key.
3. Set a webhook endpoint to `https://YOUR-DOMAIN/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Set `STRIPE_WEBHOOK_SECRET` to the endpoint's signing secret.
5. Enable/configure any eligible wallet methods in Stripe. Apple Pay/Google Pay availability is not guaranteed for every buyer.

## PayPal

1. Create an app at https://developer.paypal.com/dashboard/applications.
2. Start with Sandbox credentials.
3. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox`.
4. The client ID is public and sent to the browser; the client secret stays server-side.
5. Switch to live credentials and `PAYPAL_ENV=live` only after Sandbox tests pass.

## Deploy

GitHub Pages only serves static files and cannot run this Node.js backend. Deploy the repository to a Node.js host such as Render. Configure all environment variables in the host's dashboard, set `NODE_ENV=production`, and set `BASE_URL` to your public HTTPS URL.

## Before launch

- Add a database for orders, refunds, and payment IDs.
- Fulfill goods only after verified provider confirmation, using idempotent processing.
- Add privacy, terms, refund, delivery, and contact pages.
- Test completed, failed, cancelled, duplicate, and refunded payments.
- Check taxes and local requirements.
- Payment processors may require the account holder to be an adult or otherwise legally eligible. If you're under 18, involve a parent/guardian who can legally manage the merchant account.
