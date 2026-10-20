const statusEl = document.querySelector("#status");
const stripeButton = document.querySelector("#stripe-button");
let storeConfig = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function money(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

async function postJSON(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Payment request failed.");
  return data;
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Store configuration could not load.");
    storeConfig = await response.json();
    document.querySelector("#product-name").textContent = storeConfig.product.name;
    document.querySelector("#product-description").textContent = storeConfig.product.description;
    document.querySelector("#price").textContent = money(storeConfig.product.priceCents, storeConfig.product.currency);
    if (!storeConfig.stripeReady) stripeButton.title = "Stripe needs to be configured by the store owner.";
    if (storeConfig.paypalReady) await loadPayPalButtons();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

stripeButton.addEventListener("click", async () => {
  stripeButton.disabled = true;
  setStatus("Connecting to secure Stripe checkout…");
  try {
    const data = await postJSON("/api/checkout/stripe");
    if (!data.url || !data.url.startsWith("https://")) throw new Error("Stripe did not return a valid checkout URL.");
    window.location.assign(data.url);
  } catch (error) {
    setStatus(error.message, "error");
    stripeButton.disabled = false;
  }
});

async function loadPayPalButtons() {
  const clientId = storeConfig.paypalClientId;
  // The public client ID is intentionally served by the server config endpoint below.
  if (!clientId) return;
  const script = document.createElement("script");
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(storeConfig.product.currency)}&intent=capture`;
  script.onload = () => {
    if (!window.paypal) return;
    window.paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal", height: 44 },
      createOrder: async () => {
        setStatus("Creating PayPal order…");
        const data = await postJSON("/api/checkout/paypal/create");
        return data.id;
      },
      onApprove: async (data) => {
        setStatus("Confirming payment with PayPal…");
        const result = await postJSON("/api/checkout/paypal/capture", { orderID: data.orderID });
        if (result.status === "COMPLETED") {
          setStatus("Payment completed. Thank you for your order.", "success");
          window.location.assign("/success.html?provider=paypal&order_id=" + encodeURIComponent(result.orderID));
        } else {
          setStatus("PayPal has not confirmed this payment yet.", "error");
        }
      },
      onCancel: () => setStatus("PayPal checkout was cancelled."),
      onError: (error) => {
        console.error("PayPal checkout error:", error);
        setStatus("PayPal checkout failed. Please try again.", "error");
      }
    }).render("#paypal-button-container");
  };
  script.onerror = () => setStatus("Could not load PayPal. Check the store configuration.", "error");
  document.head.appendChild(script);
}

loadConfig();