export async function onRequest(context) {
  const { request, env } = context;

  // 1. Handle Meta Webhook Verification (GET Request)
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === env.META_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2. Handle Incoming Order Webhook (POST Request)
  if (request.method === "POST") {
    try {
      const orderData = await request.json();

      // Extract details from your checkout payload
      const orderId = orderData.order_id || orderData.id || "N/A";
      const total = orderData.total_price || orderData.total || "N/A";

      // Call Meta's WhatsApp Cloud API
      const whatsappResponse = await fetch(
        `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: env.MY_PHONE_NUMBER, // e.g., 201xxxxxxxxx
            type: "template",
            template: {
              name: "new_order_alert", // Your approved Meta template name
              language: { code: "en_US" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: String(orderId) },
                    { type: "text", text: String(total) }
                  ]
                }
              ]
            }
          }),
        }
      );

      const result = await whatsappResponse.json();

      return new Response(JSON.stringify({ success: true, metaResponse: result }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}