import debug from 'debug';
import { SERVICE_NAME } from './config.js';

class Log {
  public static debug = debug(`${SERVICE_NAME}:debug`);
  public static info = debug(`${SERVICE_NAME}:info`);
  public static warn = debug(`${SERVICE_NAME}:warn`);
  public static error = debug(`${SERVICE_NAME}:error`);
}

export { Log as log };
