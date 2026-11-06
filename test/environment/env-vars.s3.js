process.env['NODE_ENV'] = 'development';
process.env['STORAGE_BACKEND'] = 's3';
process.env['INCOMING_BUCKET'] = 'incoming';
process.env['INCOMING_PREFIX'] = 'S3';
process.env['ACTIVE_BUCKET'] = 'active';
process.env['ACTIVE_PREFIX'] = 'S3';
// the CloudServer of docker-compose.s3.yml
process.env['S3_ENDPOINT'] = 'http://localhost:9000';
process.env['S3_ACCESS_KEY_ID'] = 'images-access-key';
process.env['S3_SECRET_KEY'] = 'images-secret-key';
process.env['S3_DEFAULT_REGION'] = 'us-east-1';
