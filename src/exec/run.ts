import spawn from 'cross-spawn';
import { log } from '../log.js';

export const runSync = (command: string, args: string[]): string => {
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

export const runAsync = async (command: string, args: string[]): Promise<string> => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });

  log.debug(`${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    let stdout = '';

    child.stdout?.on('data', data => {
      stdout += data;
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Command failed, exited with code #${code}`));
      }
      resolve(stdout);
    });

    child.on('error', error => {
      reject(error);
    });
  });
};
