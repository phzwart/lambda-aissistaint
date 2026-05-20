import { appendFile, writeFile } from 'node:fs/promises';

const isoNow = () => new Date().toISOString();

export const createProcessLogger = ({ logFilePath, onLine } = {}) => {
  const lines = [];

  const append = async (message, level = 'info') => {
    const line = `[${isoNow()}] [${level}] ${message}`;
    lines.push(line);
    if (onLine) {
      onLine(line);
    }
    if (logFilePath) {
      await appendFile(logFilePath, `${line}\n`, 'utf8');
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
