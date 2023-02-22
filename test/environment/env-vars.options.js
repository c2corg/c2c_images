/* global process */
import './env-vars.js';

process.env.GENERATE_AVIF = '1';
process.env.GENERATE_WEBP = '1';
process.env.AUTO_ORIENT_ORIGINAL = '1';
process.env.ALLOWED_ORIGINS = '*';
process.env.THUMBNAILS_PUBLISH_DELAY = '1000';
