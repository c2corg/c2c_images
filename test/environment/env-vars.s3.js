/* global process */

process.env.NODE_ENV = 'development';
process.env.STORAGE_BACKEND = 's3';
process.env.INCOMING_BUCKET = 'incoming';
process.env.INCOMING_PREFIX = 'MINIO';
process.env.ACTIVE_BUCKET = 'active';
process.env.ACTIVE_PREFIX = 'MINIO';
process.env.MINIO_ENDPOINT = 'http://localhost:9000';
process.env.MINIO_ACCESS_KEY_ID = 'minio';
process.env.MINIO_SECRET_KEY = 'miniosecret';
