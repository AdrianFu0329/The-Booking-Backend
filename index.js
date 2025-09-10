const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// 1. Webhook verification (Meta calls this once)
app.get("/webhook", (req, res) => {
  const verifyToken = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === verifyToken) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2. Webhook receiver (messages come here)
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];

  const messages = changes?.value?.messages;
  const contacts = value?.contacts;

  if (messages) {
    const msg = messages[0];
    const from = msg.from; // customer’s number
    const text = msg.text?.body; // message text
    const name = contacts.profile?.name; // customer name

    console.log(`Received message from ${name} ${from}: ${text}`);

    try {
      const customersTableBody = {
        name: name,
        phone: from,
        email: "N/A",
      }

      // 1. Upsert customer into "customers"
      const customerRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/customers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`, 
          Prefer: "return=representation",
        },
        body: JSON.stringify(customersTableBody),
      });

      if (!customerRes.ok) {
        const errorText = await customerRes.text();
        console.error("Failed to insert customer:", errorText);
        return res.sendStatus(500);
      }

      const customerData = await customerRes.json();
      const customerId = customerData[0]?.id; // returned uuid

      const chatLogsTableBody = {
        restaurantId: process.env.RESTAURANT_ID,
        customerId: customerId,
        message: text,
        sender: 'customer',
      }

      // 2. Insert chat log linked to customer
      const chatLogRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`, 
          Prefer: "return=representation",
        },
        body: JSON.stringify(chatLogsTableBody),
      });

      if (!chatLogRes.ok) {
        const errorText = await chatLogRes.text();
        console.error("Failed to insert chat log:", errorText);
        return res.sendStatus(500);
      }

      console.log("Saved chat log successfully!");
    } catch (error) {
      console.error("Error saving webhook data:", error.message);
    }
  }

  res.sendStatus(200);
});

// 3. Send a WhatsApp message
app.post("/send-message", async (req, res) => {
  const { to, text } = req.body;

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});