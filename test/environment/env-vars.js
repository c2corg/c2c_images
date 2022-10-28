/* global process */
import os from 'node:os';

process.env.NODE_ENV = 'development';
process.env.STORAGE_BACKEND = 'local';
process.env.INCOMING_FOLDER = `${os.tmpdir()}/images/incoming`;
process.env.ACTIVE_FOLDER = `${os.tmpdir()}/images/active`;
process.env.API_SECRET_KEY = 'my secret';
process.env.AUTO_ORIENT_ORIGINAL = '1';
