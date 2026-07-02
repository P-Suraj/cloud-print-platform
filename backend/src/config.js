import 'dotenv/config';

const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },

  pricing: {
    perPageBW: parseInt(process.env.PRICE_PER_PAGE_BW || '200'),       // paise
    perPageColor: parseInt(process.env.PRICE_PER_PAGE_COLOR || '500'), // paise
    duplexDiscountPercent: parseInt(process.env.DUPLEX_DISCOUNT_PERCENT || '10'),
  },

  printer: {
    name: process.env.PRINTER_NAME || 'HP_LaserJet_Pro',
    enabled: process.env.PRINTER_ENABLED === 'true',
  },

  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
    dir: 'uploads',
  },
};

export default config;
