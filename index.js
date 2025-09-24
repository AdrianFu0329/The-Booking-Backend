import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import Service from "./service.js";
import ServiceType from "./Enums.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
let prevMsg = "";

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
  const contacts = changes?.value?.contacts;

  if (messages && prevMsg !== messages[0].text.body) {
    const msg = messages[0];
    const from = msg.from; // customer’s number
    const text = msg.text?.body; // message text
    const name = contacts?.[0]?.profile?.name; // customer's WhatsApp account Name
    const whatsappMsgId = msg.id;

    console.log(`Received message from ${name} ${from}: ${text}`);

    try {      
      const { data, error } = await Service().performServiceRequest(ServiceType.ServiceTypeGetCustomerId, { name: name, from: from });

      if (!error) {
        const msgIdCheckingReq = {
          restaurantId: process.env.RESTAURANT_ID,
          customerId: data.customerId, 
          customerMsg: text,
          whatsappMsgId: whatsappMsgId,
        };

        const msgIdCheckingRsp = await Service().performServiceRequest(ServiceType.ServiceTypeCheckForExistingWhatsAppMsgId, msgIdCheckingReq);

        if (!msgIdCheckingRsp.isExisting) {
          const chatLogsTableBody = {
            restaurant_id: process.env.RESTAURANT_ID,
            customer_id: data.customerId,
            message: text,
            sender: 'customer',
            whatsapp_msg_id: whatsappMsgId,
          }
    
          // 2. Insert chat log linked to customer
          const { saveChatStatus, error: saveChatError } = await Service().performServiceRequest(ServiceType.ServiceTypeSendMessage, chatLogsTableBody);
  
          if (!saveChatError) {
            console.log("Saved chat log successfully!");
            
            // 3. Response with AI after inactivity for 7 seconds
            const aiRequest = {
              customerId: data.customerId,
              customerNm: name,
              prompt: text,
            };
  
            const aiRsp = await Service().performServiceRequest(ServiceType.ServiceTypeAI, aiRequest);
  
            let aiMsg = '';
  
            if (!aiRsp.isReqSuccessful) {
              console.error("Failed to generate AI response.");
              aiMsg = "Our service is currently unavailable. Please try again later or wait for our staff to assist you. We apologize for the inconvenience.";
            } else {
              aiMsg = aiRsp.rspMsg;
            }
  
            const sendMsgReq = {
              restaurant_id: process.env.RESTAURANT_ID,
              customer_id: data.customerId,
              message: aiMsg,
              sender: 'staff',
            };
  
            const { saveChatStatus, error: saveChatError } = await Service().performServiceRequest(ServiceType.ServiceTypeSendMessage, sendMsgReq);
  
            if (!saveChatStatus) {
              console.error("Failed to save msg to DB: " + saveChatError);
              // res.sendStatus(802);
              return;
            } else {
              await axios.post(
                `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
                {
                  messaging_product: "whatsapp",
                  to: from,
                  type: "text",
                  text: { body: aiMsg },
                },
                {
                  headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              console.log("AI response sent to customer:", aiMsg);
  
              if (!aiRsp.isReqSuccessful) {
                // res.sendStatus(801);
              } else {
                res.sendStatus(200);
              }
            }
          } else {
            console.error("Failed to insert chat log:", saveChatError);
            res.sendStatus(500);
            return;
          }
        } else {
          console.log("Duplicate message, ignoring:", whatsappMsgId);
          return res.sendStatus(200);
        }
      } else {
        console.error("Failed to get customer data:", error);
        res.sendStatus(500);
        return;
      }
    } catch (error) {
      console.error("Error saving webhook data:", error.message);
    }
  }
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