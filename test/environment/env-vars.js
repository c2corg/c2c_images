/* global process */
import os from 'node:os';

process.env.STORAGE_BACKEND = 'local';
process.env.TEMP_FOLDER = `${os.tmpdir}/temp`;
process.env.INCOMING_FOLDER = `${os.tmpdir}/incoming`;
process.env.ACTIVE_FOLDER = `${os.tmpdir}/active`;
process.env.API_SECRET_KEY = 'my secret';
