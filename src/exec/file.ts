import { sync as commandExists } from 'command-exists';
import { runSync } from './run';

const cmd = 'file';
export const fileCmdExists = commandExists(cmd);

export const getMimeType = (filename: string): string => {
  return runSync('file', ['-b', '--mime-type', filename]).trim();
};
