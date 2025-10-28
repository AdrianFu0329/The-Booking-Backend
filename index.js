import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import Service from "./service.js";
import ServiceType from "./Enums.js";
import ServiceModel from "./ServiceModel.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
let prevMsg = "";
let staffTokenList = [];
let userMessageCounts = new Map();

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

  let text;
  let imageId;
  let mimeType;
  let imageBuffer;

  if (messages) {
    const msg = messages[0];
    const currentTime = new Date(msg.timestamp * 1000).toLocaleString("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      hour12: false,
    });;
    const from = msg.from; // customer’s number
    const name = contacts?.[0]?.profile?.name; // customer's WhatsApp account Name
    const whatsappMsgId = msg.id;
    let isUnsupportedType = false;

    if (msg.type === "text") {
      text = msg.text?.body;
      console.log(`Received message from ${name} ${from}: ${text}`);
    } else if (msg.type === "image") {
      imageId = msg.image.id;
      mimeType = msg.image.mime_type;
  
      const request = {
        mediaId: imageId,
      }
  
      const whatsappImgRsp = await Service().performServiceRequest(ServiceType.ServiceTypeDownloadMedia, request);

      imageBuffer = whatsappImgRsp.buffer;
      console.log(`Received image message from ${name} ${from}: ${imageBuffer}`);
    } else {
      isUnsupportedType = true;
    }

    try {
      // Start Processing AI Rsp
      const { data, error } = await Service().performServiceRequest(ServiceType.ServiceTypeGetCustomerId, { name: name, from: from });

      if (!error) {
        if (await Service().performServiceRequest(ServiceType.ServiceTypeDoCheckMsgLimit, { customerId: data.customerId, userMessageCounts: userMessageCounts })) {
          console.log(`Rate limited: User ${data.customerId} exceeded 3 messages/min`);
          return res.sendStatus(200);
        }

        const msgIdCheckingReq = {
          restaurantId: process.env.RESTAURANT_ID,
          customerId: data.customerId, 
          customerMsg: text,
          whatsappMsgId: whatsappMsgId,
        };

        const msgIdCheckingRsp = await Service().performServiceRequest(ServiceType.ServiceTypeCheckForExistingWhatsAppMsgId, msgIdCheckingReq);

        const staffRsp = await Service().performServiceRequest(ServiceType.ServiceTypeGetRestaurantStaff);
    
        if (!staffRsp.isReqSuccessful) {
          console.error("Failed to obtain Restaurant's Staff List from DB!");
        } else {
          console.error("Obtained Restaurant's Staff List from DB!");
          staffTokenList = staffRsp.staffTokenList;
        }

        if (!msgIdCheckingRsp.isExisting) {
          // 2. Insert chat log or image linked to customer
          let filePath;
          if (msg.type === "image") {
            const fileExt = mimeType.split("/")[1] || "jpg";
            const timestamp = new Date().toISOString().replace(/:/g, "-");

            filePath = `${data.customerId}/${timestamp}_${data.customerId}.${fileExt}`;

            const uploadImgReq = {
              mimeType: mimeType,
              filePath: filePath,
              buffer: imageBuffer,
            }

            const uploadImgRsp = await Service().performServiceRequest(ServiceType.ServiceTypeUploadImg, uploadImgReq);

            if (!uploadImgRsp.isReqSuccessful) {
              console.error("Failed to upload whatsapp image to DB:", uploadImgRsp.error);
              res.sendStatus(500);
              return;
            }
          }

          const chatLogsTableBody = {
            restaurant_id: process.env.RESTAURANT_ID,
            customer_id: data.customerId,
            message: isUnsupportedType ? "Unsupported Message...": ((msg.type === "image") ? `IMG - ${filePath}`: text),
            sender: 'customer',
            whatsapp_msg_id: whatsappMsgId,
          }

          const { saveChatStatus, error: saveChatError } = await Service().performServiceRequest(ServiceType.ServiceTypeSendMessage, chatLogsTableBody);
  
          if (!saveChatError) {
            console.log("Saved chat log successfully!");

            if (staffTokenList.length > 0 && !isUnsupportedType) {
              // Send Notification to Mobile App
              const req = {
                tokens: staffTokenList,
                title: name,
                body: (msg.type === "image") ? "Image" : text,
                data: { 
                  "foo": "bar", 
                  "customerId": data.customerId,
                  "action": "openChat"
                }
              };
              
              const rsp = await Service().performServiceRequest(ServiceType.ServiceTypeSendNotification, req);
            }
            
            if (isUnsupportedType) {
              const sendMsgReq = {
                restaurant_id: process.env.RESTAURANT_ID,
                customer_id: data.customerId,
                message: "We're so sorry, but we can only process text and image messages at the moment. Please resend your message in a supported format.",
                sender: 'staff',
                from: from,
              };

              const sendMsgRsp = await ServiceModel().requestSendMessageService(sendMsgReq);

              if (sendMsgRsp.isReqSuccessful) {
                console.log("Response sent successfully.");
                return res.sendStatus(200);
              } else {
                console.error("Failed to send response:", sendMsgRsp.error);
                res.sendStatus(500);

                return;
              }
            } else {
              // 3. Response with AI after inactivity for 7 seconds
              const imgPrompt = imageBuffer ? {
                mimeType: mimeType,
                data: imageBuffer.toString("base64"),
              } : null;

              const aiRequest = {
                customerId: data.customerId,
                customerNm: name,
                prompt: text,
                promptImg: imgPrompt,
                currentTime: currentTime,
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
                from: from,
              };
    
              const sendMsgRsp = await ServiceModel().requestSendMessageService(sendMsgReq);

              if (sendMsgRsp.isReqSuccessful) {
                console.log("AI response sent successfully.");
                res.sendStatus(200);
              } else {
                console.error("Failed to send AI response:", sendMsgRsp.error);
                res.sendStatus(500);
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