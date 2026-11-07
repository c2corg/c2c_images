import './env-vars.js';

process.env['GENERATE_AVIF'] = '1';
process.env['GENERATE_WEBP'] = '1';
process.env['AUTO_ORIENT_ORIGINAL'] = '1';
process.env['ALLOWED_ORIGINS'] = '*';
process.env['THUMBNAILS_PUBLISH_DELAY'] = '1000';
process.env['MAX_UPLOAD_SIZE'] = '100000';
process.env['UPLOAD_RATE_LIMIT'] = '5';
process.env['AUTH_FAILURE_RATE_LIMIT'] = '3';
