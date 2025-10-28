import Service from "./service.js";
import axios from "axios";
import dotenv from "dotenv";
import ServiceType from "./Enums.js";


export default function ServiceModel() {
    dotenv.config();

    const requestSendMessageService = async (request) => {
        const from = request.from;
        delete request.from;
        const sendMsgReq = request;

        const { saveChatStatus, error: saveChatError } = await Service().performServiceRequest(ServiceType.ServiceTypeSendMessage, sendMsgReq);

        let sendMsgRsp;

        if (!saveChatStatus) {
            sendMsgRsp = {
                isReqSuccessful: false,
                error: saveChatError,
            };

            console.error("Failed to save msg to DB: " + saveChatError);
        } else {
            try {
                const response = await axios.post(
                    `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
                    {
                        messaging_product: "whatsapp",
                        to: from,
                        type: "text",
                        text: { body: sendMsgReq.message },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (response.data.messages && response.data.messages.length > 0) {
                    sendMsgRsp = {
                        isReqSuccessful: true,
                        error: null,
                    };
                    console.log("Message sent successfully:", response.data);
                } else {
                    sendMsgRsp = {
                        isReqSuccessful: false,
                        error: "Message API response did not include messages",
                    };
                    console.error("Message API response did not include messages:", response.data);
                }
            } catch (error) {
                sendMsgRsp = {
                    isReqSuccessful: false,
                    error: error.response?.data || error.message,
                };
                console.error("Error sending message:", error.response?.data || error.message);
            }            
        }
        return sendMsgRsp;
    }

    return {
        requestSendMessageService,
    }
}