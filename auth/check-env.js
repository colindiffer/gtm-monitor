require('dotenv').config();
console.log('CLIENT_ID set:', !!process.env.GOOGLE_CLIENT_ID);
console.log('CLIENT_SECRET set:', !!process.env.GOOGLE_CLIENT_SECRET);
console.log('REFRESH_TOKEN set:', !!process.env.GOOGLE_REFRESH_TOKEN);
