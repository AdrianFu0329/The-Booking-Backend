import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import ServiceType from "./Enums.js";

export default function Service() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;  
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const performServiceRequest = async (serviceType, request) => {
        switch (serviceType) {
            case ServiceType.ServiceTypeGetTableList:
                return await doGetTableList(request);
            case ServiceType.ServiceTypeCreateBooking:
                return await doAddBooking(request);
            case ServiceType.ServiceTypeAI:
                return await doOnlineAIRequest(request);
            case ServiceType.ServiceTypeGetBookingAvailabilities(): 
                return await doGetTableAvailability(request);
            case ServiceType.ServiceTypeGetCustomerId:
                return await doGetCustomerId(request);
            case ServiceType.ServiceTypeSendMessage:
                return await doSendMessage(request);
            case ServiceType.ServiceTypeGetBooking:
                return await doGetBooking(request);
            case ServiceType.ServiceTypeCheckForExistingWhatsAppMsgId:
              return await doCheckForExistingWhatsAppMsgId(request);
    
          default:
            throw new Error("Unknown service type");
        }
    };

    const doGetTableList = async (reqModel) => {   
        let tableList = null;

        try {
          console.log("doGetTableList STARTED");
    
          const rsp = await fetch(ServiceType.ServiceTypeGetTableList(reqModel.restaurantId), {
            headers: {
              apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
            },
          });
    
          if (!rsp.ok) {
            console.error("doGetTableList :: Failed to get tables list: " + rsp.status);
            return { isReqSuccessful: false };
            } else {
                const data = await rsp.json();
                // console.log(data);
                
                tableList = data.map((item) => {
                    const table = {
                        tableId: item.id,
                        tableNumber: item.table_number,
                        capacity: item.capacity,
                        location: item.location,
                        movable: item.movable,
                        status: item.status,
                    };

                    return table;
                });
        
                console.log("doGetTableList ENDED");
                return { rsp: tableList, isReqSuccessful: false };
            }
        } catch (err) {
          console.log("doGetTableList :: " + err);
          return { isReqSuccessful: false };
        }
    }

    const doAddBooking = async (reqModel) => {    
        let rspModel = {};
    
        try {
          console.log("doAddBooking :: write to bookings STARTED");
    
          const bookingItem = reqModel.booking;
    
          if (bookingItem) {
            const jsonItem = {
                restaurant_id: process.env.RESTAURANT_ID,
                customer_id: bookingItem.customerId,
                table_id: bookingItem.bookingUnit || null,
                title: bookingItem.title,
                pax: Number(bookingItem.pax),
                status: bookingItem.bookingStatus,
                notes: bookingItem.notes,
                start_date_time: bookingItem.startDateTime,
                end_date_time: bookingItem.endDateTime,
                type: bookingItem.type,
            };

            console.log("doAddBooking :: jsonItem =>", jsonItem);
                    
            const rsp = await fetch(ServiceType.ServiceTypeCreateBooking, {
              method: "POST",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify(jsonItem),
            });
    
            if (!rsp.ok) {
                console.error("doAddBooking :: Failed to add booking: ", rsp);
                return { isReqSuccessful: false };
            } else {
              const data = await rsp.json();
              console.log(
                "doAddBooking :: Success Response: Booking added => ",
                data
              );
    
              return { isReqSuccessful: true, bookingId: data[0].id };
            }
          }
        } catch (err) {
          console.error("doAddBooking :: Error while adding booking: " + err);
          return { isReqSuccessful: false };
        }
    
        return rspModel;
    }

    const doOnlineAIRequest = async (request) => {
        console.log("doOnlineAIRequest :: online AI request STARTED");
      
        const reqModel = request;
        let rspModel = {};
      
        try {
          let tableIdMap = new Map();
          let tableAvailabilityMap = new Map();
          let customerPrevChatList = [];
          let customerBookings = [];
    
          // Get Current Restaurant's tables
          const bookingReqModel = {
            restaurantId: process.env.RESTAURANT_ID
          };
    
          const bookingRspModel = await doGetTableList(bookingReqModel);
    
          if (!bookingRspModel.isReqSuccessful) {
            // Try again? 
          } else {
              const tableMap = new Map(bookingRspModel.rsp.map(table => [
                      `${table.tableNumber} (At ${table.location} for ${table.capacity} pax)`, 
                      table.tableId
                  ])
              );
    
              tableIdMap = tableMap;
          }
    
          // Get Current booked restaurant tables
          const bookingAvailabilityReqModel = {
            restaurantId: process.env.RESTAURANT_ID,
          };
          
          const bookingAvailabilityRspModel = await doGetTableAvailability(bookingAvailabilityReqModel);
    
          if (!bookingAvailabilityRspModel.isReqSuccessful) {
            // Try again? 
          } else {
              tableAvailabilityMap = bookingAvailabilityRspModel.bookingAvailabilityMap;
          }

          const getCustomerPrevChatMsgReq = {
            restaurantId: process.env.RESTAURANT_ID,
            customerId: reqModel.customerId,
          }

          const getCustomerPrevChatMsgRsp = await doGetChats(getCustomerPrevChatMsgReq);

          if (!getCustomerPrevChatMsgRsp.isReqSuccessful) {
            // Try again? 
          } else {
            customerPrevChatList = getCustomerPrevChatMsgRsp.chatList;
          }

          const getCustomerBookingsReq = {
            restaurantId: process.env.RESTAURANT_ID,
            customerId: reqModel.customerId,
          }
          const getCustomerBookingsRsp = await doGetCustomerBookings(getCustomerBookingsReq);

          if (!getCustomerBookingsRsp.isReqSuccessful) {
            // Try again? 
          } else {
            customerBookings = getCustomerBookingsRsp.customerBookings;
          }
    
          const tableListForAI = Array.from(tableIdMap.entries()).map(([desc, id]) => ({
            id,
            description: desc,
          }));
          
          const availabilityForAI = Array.from(tableAvailabilityMap.entries()).map(([tableId, status]) => ({
            status,
            tableId,
          }));
    
          let prompt;
          
          const textPrompt = `
            Today's or Tonight's or Now's date: ${new Date().toISOString()}
            Customer name: ${reqModel.customerNm}
            
            Customer Chat History (for context): 
            ${JSON.stringify(customerPrevChatList)}
            =========================================
    
            Restaurant Tables: 
            ${JSON.stringify(tableListForAI)}
            =========================================
    
            Currently Reserved Tables: 
            ${JSON.stringify(availabilityForAI)}
            =========================================

            Customer Bookings: 
            ${JSON.stringify(customerBookings)}
            =========================================
    
            General Instructions: 
            1. Use their name in your responses naturally.  
            2. Convert all times to Malaysian time from UTC.
            3. Don't mention anything technical to the customer (date formats, timezones).
            4. Keep messages short and concise.

            Booking Placement Instructions:
            1. Assign a table_id from Restaurant Tables that:
              - Matches or is a table that can accomodate the provided pax (capacity).
              - The currently reserved tables' start_date_time is not reserved at the requested time. (Check both date & time)
              - Always return a valid 'table_id' from "Restaurant Tables". 
              - Do not return placeholders like "N/A".
              - If a table is not available, suggest other tables or other reservation times
            2. Once the customer confirms the booking details, set the action to "confirm_booking" and include the chosen table_id.
            3. Please inform the customer that the maximum reservation time is ${process.env.MAX_RESERVATION_TIME_HR} hours.
            4. Don't ask the customer about the title.
            5. If the customer requests for a reservation time in the past, kindly reject and inform them.
            6. If customer asks for a reservation for tomorrow, just take today's date and add 1 day.
            
            Booking Update Instructions: 
            1. Only fill up the booking_id field when the user confirms the booking details update.
            2. Once the customer confirms the updated booking details, set the action to "confirm_update_booking" and return the updated booking details.
            3. If the provided start date and time clashes with other bookings from other customers, kindly recommend another time.
            4. If the provided pax or capacity clashes with other tables from other customers' bookings, kindly recommend another table from the list.

            Booking Cancel Instructions: 
            1. Only fill up the booking_id field when the user confirms the booking cancellation, otherwise return a null value for that field.
            2. Once the customer confirms the action to cancel their booking, set the action to "cancel_update_booking" and return the cancelled booking_id.

            Conversation:
            "${reqModel.prompt}"
          `;
      
          if (reqModel.promptImg) {
            const imagePart = { inlineData: reqModel.promptImg };
            prompt = [textPrompt ?? null, imagePart ?? null];
          } else {
            prompt = textPrompt ?? null;
          }
      
          if (prompt !== null) {
            const result = await model.generateContent({
              contents: [{ parts: [{ text: prompt }] }],
              systemInstruction: {
                role: "system",
                parts: [
                  {
                    text: process.env.CLIENT_CONTEXT
                  }
                ]
              },
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "object",
                  properties: {
                    action: { type: "string", enum: [
                        "request_update_booking", 
                        "request_cancel_booking", 
                        "request_booking_info", 
                        "confirm_booking", 
                        "confirm_update_booking", 
                        "confirm_cancel_booking", 
                        "modify", 
                        "cancel", 
                        "reject", 
                        "confirmed"
                      ] 
                    },
                    name: { type: "string" },
                    booking_id: { type: "string" },
                    start_date: { type: "string" },
                    start_time: { type: "string" },
                    end_date: { type: "string"},
                    end_time: { type: "string"},
                    num_guests: { type: "integer" },
                    special_requests: { type: "string" },
                    booking_title: { type: "string" },
                    table_id: { type: "string" },
                    message: { type: "string" }
                  },
                  required: [
                    "action", 
                    "message", 
                    "num_guests", 
                    "start_date", 
                    "start_time", 
                    "end_date", 
                    "end_time", 
                    "special_requests", 
                    "name", 
                    "booking_title", 
                    "table_id"
                  ]
                }
              }
            });
      
            const response = await result.response;
      
            if (response) {
                let rspTxt = response.text();  
                rspTxt = rspTxt.replace(/```json|```/g, "").trim();

                const parsedTxt = JSON.parse(rspTxt);
                console.log("API Rsp: " + rspTxt);
        
                const booking = {
                  id: parsedTxt.booking_id ?? null,
                  customerId: reqModel.customerId,
                  customerNm: parsedTxt.name ?? null,
                  startDateTime: (parsedTxt.start_date && parsedTxt.start_time) ? parseDateAndTime(parsedTxt.start_date, parsedTxt.start_time).toISOString() ?? null : null,
                  endDateTime: (parsedTxt.end_date && parsedTxt.end_time) ? parseDateAndTime(parsedTxt.end_date, parsedTxt.end_time).toISOString() ?? null : null,
                  pax: parsedTxt.num_guests ?? null,
                  notes: parsedTxt.special_requests ?? null,
                  title: `${process.env.SERVICE_TYPE} Reservation for ${parsedTxt.num_guests} Pax`,
                  type: process.env.SERVICE_TYPE,
                  bookingStatus: parsedTxt.action,
                  bookingUnit: parsedTxt.table_id,
                };

                rspModel = {
                    isReqSuccessful: true,
                    rspMsg: parsedTxt.message,
                }
            
                // Write booking to DB once status is confirmed.
                if (
                    parsedTxt.action === "confirmed_booking" 
                    && booking.customerId !== null
                    && booking.bookingUnit !== null
                    && booking.title !== null
                    && (booking.pax !== null && booking.pax > 0)
                    && booking.startDateTime !== null
                    && booking.endDateTime !== null
                    && booking.type !== null
                ) {
                    const addBookingReq = {
                        booking: booking,
                    }

                    const addBookingRsp = await doAddBooking(addBookingReq);

                    if (!addBookingRsp.isReqSuccessful) {
                      console.error("doOnlineAIRequest :: Booking not added successfully to DB.");
                      return { isReqSuccessful: false };
                    } else {
                      return rspModel;
                    }
                } else if (
                  parsedTxt.action === "confirm_update_booking" 
                  && parsedTxt.booking_id !== null
                ) {
                  const updateBookingReq = {
                    restaurant_id: process.env.RESTAURANT_ID,
                    booking: booking,
                  }

                  const updateBookingRsp = await doUpdateCustomerBooking(updateBookingReq);

                  if (!updateBookingRsp.isReqSuccessful) {
                    console.error("doOnlineAIRequest :: Booking not updated successfully to DB.");
                    return { isReqSuccessful: false };
                  } else {
                    return rspModel;
                  }

                } else {
                    return rspModel;
                }
            } else {
              console.error("Online AI request failed: empty response");
              return { isReqSuccessful: false };
            }
          }
        } catch (error) {
          console.error("Online AI request failed: ", error);
          return { isReqSuccessful: false };
        }
    };
    
    function parseDateAndTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) return null;
      
        // Expecting DD/MM/YYYY
        const [day, month, year] = dateStr.split("/");
        if (!day || !month || !year) return null;
      
        const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timeStr}`;
        const parsed = new Date(isoDate);
      
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    
    const doGetTableAvailability = async (reqModel) => {  
        let availabilityMap = null;

        try {
          console.log("doGetTableAvailability STARTED");
    
          const rsp = await fetch(ServiceType.ServiceTypeGetBookingAvailabilities(reqModel.restaurantId), {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          });
    
          if (!rsp.ok) {
            console.error("doGetTableAvailability :: Failed to get table availabilities: " + rsp.status);
            return { isReqSuccessful: false }
        } else {
            const data = await rsp.json();
            // console.log("doGetTableAvailability fetched table availabilities:", data);
    
            availabilityMap = new Map(data.map((item) => [
              `${new Date(item.start_date_time)} - ${new Date(item.end_date_time)}`,
              item.table_id
            ]));
    
            console.log("doGetTableAvailability ENDED");
            return { bookingAvailabilityMap: availabilityMap, isReqSuccessful: true };
          }
        } catch (error) {
          console.log("doGetTableAvailability error: ", error);
          console.log("doGetTableAvailability ENDED");
          return { isReqSuccessful: false }
        }
    };

    const doGetCustomerId = async (request) => {
        try {
          console.log('doGetCustomerId :: STARTED');

          const rsp = await fetch(ServiceType.ServiceTypeGetCustomerId, {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
          });
    
          if (!rsp.ok) {
            console.error("getCustomers :: Failed to get customers: " + rsp.status);
            rspModel.setIsReqSuccessful(false);
          } else {
            const customersData = await rsp.json();
    
            let isExistingCustomer = false;
            let customerId = '';
            let tempBookingId = '';
    
            customersData.forEach(customer => {
              if (customer.phone === request.from) {
                isExistingCustomer = true;
                customerId = customer.id;
                tempBookingId = customer.temp_booking_id;
              }
            });
    
            if (!isExistingCustomer) {
              const customersTableBody = {
                name: request.name,
                phone: request.from,
                email: "N/A",
              }
        
              // 1. Upsert customer into "customers"
              const customerRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/customers`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 
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
              customerId = customerData[0]?.id; // returned uuid
              tempBookingId = customerData[0]?.temp_booking_id;
            }

            console.log('doGetCustomerId :: ENDED');
            return { data: { customerId: customerId, tempBookingId: tempBookingId }, error: null };
          }
        }
        catch (err) 
        {
            return { data: null, error: err.message };
        }
    }

    const doSendMessage = async (chatLogsTableBody) => {
        try {
            const chatLogRes = await fetch(ServiceType.ServiceTypeSendMessage, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`, 
              Prefer: "return=representation",
            },
            body: JSON.stringify(chatLogsTableBody),
          });
    
          if (!chatLogRes.ok) {
            const errorText = await chatLogRes.text();
            console.error("Failed to insert chat log:", errorText);
            return { saveChatStatus: false, error: errorText };
          }
    
          return { saveChatStatus: true, error: null };
        } catch (err) {
            console.error("Failed to insert chat log:", errorText);
            return { saveChatStatus: false, error: err.message };
        }
    }

    const doGetBooking = async (reqModel) => {
        const rspModel = {};
    
        try {
          console.log("doGetBookings STARTED");
    
          const rsp = await fetch(ServiceType.ServiceTypeGetBooking(reqModel.bookingId), {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          });
    
          if (!rsp.ok) {
            console.error("doGetBookings :: Failed to get booking: " + rsp.status);
            const booking = {
                bookingId: null,
                location: null,
                title: null,
                pax: null,
                bookingUnit: null,
                type: null,
                startDateTime: null,
                endDateTime: null,
                customerNm: null,
                customerContact: null,
                bookingStatus: null,
                notes: null,
            };

            return { booking: booking, isReqSuccessful: false };
          } else {
            const data = await rsp.json();
            console.log("doGetBookings fetched booking:", data);
    
            const selectedBooking = data.map((item) => {
              const booking = {
                bookingId: item.id,
                location: item.restaurants.name,
                title: item.title,
                pax: item.pax,
                bookingUnit: item.tables ? item.tables.table_number : null,
                type: item.type,
                startDateTime: new Date(item.start_date_time),
                endDateTime: new Date(item.end_date_time),
                customerNm: item.customers.name,
                customerContact: item.customers.phone,
                bookingStatus: item.status,
                notes: item.notes ?? "N/A",
              };
    
              return booking;
            });
    
            return { booking: selectedBooking, isReqSuccessful: true };
          }
        } catch (error) {
          console.log("doGetBookings error: ", error);
          return { isReqSuccessful: false };
        }
    };

    const doUpdateCustomerBooking = async (reqModel) => {
        try {
            const jsonItem = {
              restaurant_id: reqModel.restaurant_id,
              customer_id: reqModel.booking.customer_id,
              table_id: reqModel.booking.bookingUnit,
              title: reqModel.booking.title,
              type: reqModel.booking.type,
              pax: reqModel.booking.pax,
              status: "confirmed",
              notes: reqModel.booking.notes,
              start_date_time: new Date(reqModel.booking.startDateTime).toISOString(),
              end_date_time: new Date(reqModel.booking.endDateTime).toISOString(),
            }

            const rsp = await fetch(ServiceType.ServiceTypeUpdateCustomerBooking(reqModel.booking.id), {
                method: "PATCH",
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                  Prefer: "return=representation",
                },
                body: JSON.stringify(jsonItem),
              });
      
              if (!rsp.ok) {
                  console.error("doUpdateCustomerBooking :: Failed to update customer booking ID: ", rsp);
                  return { isReqSuccessful: false };
              } else {
                const data = await rsp.json();
                console.log(
                  "doUpdateCustomerBooking :: Success Response: Customer Booking updated => ",
                  data
                );
      
                return { isReqSuccessful: true };
              }
        } catch (err) {
            console.error("Failed to update customer's booking: " + err.message);
            return { isReqSuccessful: false };
        }
    }

    const doGetChats = async (reqModel) => {
        const rspModel = {};
    
        try {
          console.log("doGetChats STARTED");
    
          const rsp = await fetch(ServiceType.ServiceTypeGetChats(reqModel.restaurantId, reqModel.customerId), {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          });
    
          if (!rsp.ok) {
            console.error("doGetChats :: Failed to get chats: " + rsp.status);
            return { isReqSuccessful: false };
          } else {
            const data = await rsp.json();
                
            const sortedList = data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
            const groupedByCustomer = sortedList.reduce((acc, item) => {
              if (!acc[item.customer_id]) {
                acc[item.customer_id] = [];
              }
              acc[item.customer_id].push(item);
              return acc;
            }, {});        
    
            const chats = Object.entries(groupedByCustomer).map(([customerId, messages]) => {  
                const chat = {
                    chatId: customerId,
                    chatNm: messages[0].customers.name,
                    phoneNumber: messages[0].customers.phone,
                    chatTimestamp: messages[messages.length - 1].timestamp,
                    chatMessagesList: messages
                        .slice(-10)
                        .map((msg) => {
                            const chatMsg = {
                                chatMessageId: msg.id,
                                message: msg.message,
                                messageSender: (msg.sender === "customer") ? messages[0].customers.name : "staff",
                                timestamp: msg.timestamp,
                            };
                            return chatMsg;
                        }
                    ),
                };
                
                return chat;
            });
    
            console.log("doGetChats ENDED");
            return { chatList: chats, isReqSuccessful: true };
          }
        } catch (error) {
          console.log("doGetChats error: ", error);
          return { isReqSuccessful: false };
        }
      }

    const doCheckForExistingWhatsAppMsgId = async (reqModel) => {
      try {
        const checkExistingRsp = await fetch(ServiceType.ServiceTypeCheckForExistingWhatsAppMsgId(reqModel.restaurantId, reqModel.customerId, reqModel.whatsappMsgId), {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });

        if (!checkExistingRsp.ok) {
          console.error("doCheckForExistingWhatsAppMsgId :: Failed to get chats: " + checkExistingRsp.status);
          return { isReqSuccessful: false };
        } else {
          const data = await checkExistingRsp.json();
          console.log("doCheckForExistingWhatsAppMsgId Rsp: ", JSON.stringify(data, null, 2));
          
          if (Array.isArray(data) && data.length > 0) {
            return { isReqSuccessful: true, isExisting: true };
          }

          const checkDuplicateRsp = await fetch(ServiceType.ServiceTypeCheckForDuplicateMsg(reqModel.restaurantId, reqModel.customerId, reqModel.customerMsg), {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          });
    
          if (!checkDuplicateRsp.ok) {
            console.error("doCheckForExistingWhatsAppMsgId :: Failed to get chats: " + checkDuplicateRsp.status);
            return { isReqSuccessful: false };
          } else {
            const duplicateData = await checkDuplicateRsp.json();
            console.log("doCheckForExistingWhatsAppMsgId Rsp: ", JSON.stringify(duplicateData, null, 2));

            if (Array.isArray(duplicateData) && duplicateData.length > 0) {
              const lastMsg = duplicateData[0];
              const secondsDiff = (Date.now() - new Date(lastMsg.timestamp).getTime()) / 1000;
        
              if (secondsDiff < 10) {
                console.log("Duplicate retry detected (same user + same text within 10s)");
                return { isReqSuccessful: true, isExisting: true };
              }
            }
        
            return { isReqSuccessful: true, isExisting: false };  
          }    
        }
      } catch (error) {
        console.log("doCheckForExistingWhatsAppMsgId error: ", error.message);
        return { isReqSuccessful: false };
      }
    }

    const doGetCustomerBookings = async (reqModel) => {
      try {
        const customerBookingsRsp = await fetch(ServiceType.ServiceTypeGetCustomerBookings(reqModel.restaurantId, reqModel.customerId), {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });

        if (!customerBookingsRsp.ok) {
          console.error("doGetCustomerBookings :: Failed to get customer bookings: " + customerBookingsRsp.status);
          return { isReqSuccessful: false };
        } else {
          const data = await customerBookingsRsp.json();
            console.log("doGetCustomerBookings fetched booking:", data);
    
            const customerBookings = data.map((item) => {
              const booking = {
                bookingId: item.id,
                location: item.restaurants.name,
                title: item.title,
                pax: item.pax,
                bookingUnit: item.tables ? item.tables.table_number : null,
                type: item.type,
                startDateTime: new Date(item.start_date_time),
                endDateTime: new Date(item.end_date_time),
                customerNm: item.customers.name,
                customerContact: item.customers.phone,
                bookingStatus: item.status,
                notes: item.notes ?? "N/A",
              };
    
              return booking;
            });
    
            return { customerBookings: customerBookings, isReqSuccessful: true };
        }
      } catch (error) {
        console.log("doGetCustomerBookings error: ", error.message);
        return { isReqSuccessful: false };
      }
    }

    return {
        performServiceRequest,
    };
}