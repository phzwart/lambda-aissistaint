import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const isoNow = () => new Date().toISOString();

export const createProcessLogger = ({ logFilePath, onLine } = {}) => {
  const lines = [];
  let logFileDisabled = false;

  const append = async (message, level = 'info') => {
    const line = `[${isoNow()}] [${level}] ${message}`;
    lines.push(line);
    if (onLine) {
      onLine(line);
    }
    if (logFilePath && !logFileDisabled) {
      try {
        await appendFile(logFilePath, `${line}\n`, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          try {
            await mkdir(dirname(logFilePath), { recursive: true });
            await appendFile(logFilePath, `${line}\n`, 'utf8');
          } catch {
            logFileDisabled = true;
          }
        } else {
          throw error;
        }
      }
    }
    return line;
  };

  const reset = async () => {
    lines.length = 0;
    if (logFilePath) {
      await writeFile(logFilePath, '', 'utf8');
    }
  };

  return { append, reset, lines, logFilePath };
};
