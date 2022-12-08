import spawn from 'cross-spawn';
import { log } from '../log.js';

export const runSync = (command: string, args: string[]) => {
  const { error, status, stdout } = spawn.sync(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });

  log.debug(`${command} ${args.join(' ')}`);

  if (error) {
    throw error;
  }

  if (status !== 0) {
    throw new Error(`Command failed, exited with code #${status}`);
  }

  return stdout.toString();
};
