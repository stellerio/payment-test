import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import paypal from "@paypal/checkout-server-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));

function requireBaseUrl(req) {
  const value = BASE_URL || `${req.protocol}://${req.get("host")}`;
  const parsed = new URL(value);
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("BASE_URL must use HTTPS in production.");
  }
  return parsed.origin;
}

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured yet.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function paypalClient() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error("PayPal is not configured yet.");
  const environment = process.env.PAYPAL_ENV === "live"
    ? new paypal.core.LiveEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(environment);
}

function getProduct() {
  // Change these values to your real product. Prices are always calculated on the server.
  const name = process.env.PRODUCT_NAME || "My digital product";
  const description = process.env.PRODUCT_DESCRIPTION || "A product from my store.";
  const amount = Number(process.env.PRODUCT_PRICE_CENTS || 500);
  const currency = (process.env.PRODUCT_CURRENCY || "usd").toLowerCase();
  if (!Number.isSafeInteger(amount) || amount < 50 || amount > 100000000) {
    throw new Error("PRODUCT_PRICE_CENTS must be an integer between 50 and 100000000.");
  }
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("PRODUCT_CURRENCY must be a 3-letter currency code.");
  return { name, description, amount, currency };
}

app.get("/api/config", (_req, res) => {
  res.json({
    product: {
      name: process.env.PRODUCT_NAME || "My digital product",
      description: process.env.PRODUCT_DESCRIPTION || "A product from my store.",
      priceCents: Number(process.env.PRODUCT_PRICE_CENTS || 500),
      currency: (process.env.PRODUCT_CURRENCY || "usd").toUpperCase()
    },
    stripeReady: Boolean(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes("replace_me")),
    paypalClientId: process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.includes("replace_me") ? process.env.PAYPAL_CLIENT_ID : null,
    paypalReady: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET &&
      !process.env.PAYPAL_CLIENT_ID.includes("replace_me") && !process.env.PAYPAL_CLIENT_SECRET.includes("replace_me"))
  });
});

app.post("/api/checkout/stripe", express.json(), async (req, res) => {
  try {
    const stripe = stripeClient();
    const product = getProduct();
    const origin = requireBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      billing_address_collection: "auto",
      line_items: [{
        price_data: {
          currency: product.currency,
          product_data: { name: product.name, description: product.description },
          unit_amount: product.amount
        },
        quantity: 1
      }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { product: product.name },
      // Stripe Checkout displays eligible wallets and payment methods automatically.
      // Availability depends on country, currency, device, and Stripe account settings.
      automatic_tax: { enabled: false }
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error.message);
    res.status(400).json({ error: error.message || "Could not start Stripe checkout." });
  }
});

app.post("/api/checkout/paypal/create", express.json(), async (req, res) => {
  try {
    const client = paypalClient();
    const product = getProduct();
    const currency = product.currency.toUpperCase();
    const amount = (product.amount / 100).toFixed(2);
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{
        description: product.description,
        amount: { currency_code: currency, value: amount },
        items: [{
          name: product.name.slice(0, 127),
          quantity: "1",
          unit_amount: { currency_code: currency, value: amount },
          category: "DIGITAL_GOODS"
        }]
      }],
      application_context: {
        brand_name: process.env.STORE_NAME || "Payment Test",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    });
    const order = await client.execute(request);
    res.json({ id: order.result.id });
  } catch (error) {
    console.error("PayPal order error:", error.message);
    res.status(400).json({ error: error.message || "Could not create PayPal order." });
  }
});

app.post("/api/checkout/paypal/capture", express.json(), async (req, res) => {
  try {
    const orderId = String(req.body?.orderID || "");
    if (!/^[A-Z0-9-]{10,}$/i.test(orderId)) {
      return res.status(400).json({ error: "Invalid PayPal order ID." });
    }
    const client = paypalClient();
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await client.execute(request);
    const status = capture.result.status;
    if (status !== "COMPLETED") {
      return res.status(400).json({ error: "PayPal has not completed this payment." });
    }
    res.json({ status, orderID: capture.result.id });
  } catch (error) {
    console.error("PayPal capture error:", error.message);
    res.status(400).json({ error: error.message || "Could not capture PayPal payment." });
  }
});

// Stripe sends raw webhook bytes, so this route must be registered before any global JSON parser.
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send("Stripe webhook is not configured.");
  }
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).send(`Webhook signature error: ${error.message}`);
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    // TODO: fulfill the order here only after verifying the payment status.
    // For downloads, deliver a short-lived, single-use download link from a private storage bucket.
    console.log("Paid Stripe checkout:", session.id, session.payment_status);
  }
  res.json({ received: true });
});

app.get("/api/checkout/stripe/session", async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "Invalid checkout session." });
    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    res.json({
      paymentStatus: session.payment_status,
      status: session.status,
      product: session.metadata?.product || "Order",
      paid: session.payment_status === "paid"
    });
  } catch (error) {
    res.status(400).json({ error: "Could not verify checkout session." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Payment Test server listening on port ${PORT}`));