import { sync as commandExists } from 'command-exists';
import { runAsync } from './run.js';

const cmd = 'file';
export const fileCmdExists = commandExists(cmd);

export const getMimeType = async (filename: string): Promise<string> =>
  runAsync('file', ['-b', '--mime-type', filename]).then(s => s.trim());
