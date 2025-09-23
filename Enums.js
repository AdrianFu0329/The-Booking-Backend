import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const restaurantId = process.env.RESTAURANT_ID;

const ServiceType = {
    "ServiceTypeGetTableList": (restaurantId) => `${supabaseUrl}/rest/v1/tables?restaurant_id=eq.${restaurantId}`,
    "ServiceTypeCreateBooking": `${supabaseUrl}/rest/v1/bookings`,
    "ServiceTypeAI": 'ServiceTypeAI',
    "ServiceTypeGetBookingAvailabilities": (restaurantId) => `${supabaseUrl}/rest/v1/bookings?select=*,tables!table_id(*)&restaurant_id=eq.${restaurantId}&status=eq.confirmed`,
    "ServiceTypeGetCustomerId": `${supabaseUrl}/rest/v1/customers`,
    "ServiceTypeSendMessage": `${supabaseUrl}/rest/v1/chat_logs`,
    "ServiceTypeGetBooking": (bookingId) => `${supabaseUrl}/rest/v1/bookings?select=*,restaurants!restaurant_id(*),customers!customer_id(*),tables!table_id(*)&id=eq.${bookingId}`,
    "ServiceTypeUpdateCustomerBooking": (bookingId) => `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}`,
    "ServiceTypeUpdateBooking": (bookingId) => `${supabaseUrl}/rest/v1/bookings?id=eq.${bookingId}`,
    "ServiceTypeGetChats": (restaurantId, customerId) => `${supabaseUrl}/rest/v1/chat_logs?restaurant_id=eq.${restaurantId}&customer_id=eq.${customerId}&select=*, customers!customer_id(*)`,
    "ServiceTypeCheckForExistingWhatsAppMsgId": (restaurantId, customerId, msgId) => `${supabaseUrl}/rest/v1/chat_logs?restaurant_id=eq.${restaurantId}&customer_id=eq.${customerId}&whatsapp_msg_id=eq.${msgId}&select=*, customers!customer_id(*)`,
    "ServiceTypeCheckForDuplicateMsg": (restaurantId, customerId, customerMsg) => `${supabaseUrl}/rest/v1/chat_logs?restaurant_id=eq.${restaurantId}&customer_id=eq.${customerId}&message=eq.${customerMsg}&select=*, customers!customer_id(*)`,
    "ServiceTypeGetCustomerBookings": (restaurantId, customerId) => `${supabaseUrl}/rest/v1/bookings?select=*,restaurants!restaurant_id(*),customers!customer_id(*),tables!table_id(*)&restaurant_id=eq.${restaurantId}&customer_id=eq.${customerId}`,
}

export default ServiceType;