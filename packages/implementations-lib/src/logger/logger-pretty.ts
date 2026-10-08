/* eslint-disable */

import { Writable } from 'node:stream';

import pino from 'pino';

const Reset = '\x1b[0m';
const Bright = '\x1b[1m';
const Dim = '\x1b[2m';
const Underscore = '\x1b[4m';
const Blink = '\x1b[5m';
const Reverse = '\x1b[7m';
const Hidden = '\x1b[8m';

const FgBlack = '\x1b[30m';
const FgRed = '\x1b[31m';
const FgGreen = '\x1b[32m';
const FgYellow = '\x1b[33m';
const FgBlue = '\x1b[34m';
const FgMagenta = '\x1b[35m';
const FgCyan = '\x1b[36m';
const FgWhite = '\x1b[37m';
const FgGray = '\x1b[90m';

const BgBlack = '\x1b[40m';
const BgRed = '\x1b[41m';
const BgGreen = '\x1b[42m';
const BgYellow = '\x1b[43m';
const BgBlue = '\x1b[44m';
const BgMagenta = '\x1b[45m';
const BgCyan = '\x1b[46m';
const BgWhite = '\x1b[47m';
const BgGray = '\x1b[100m';

class CustomLoggerPrettifier extends Writable {
  _write(
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    // prep parts
    const strInput = chunk.toString();
    const inputLines = strInput.split(/\r?\n/);
    let linesStr = inputLines.join(',');
    if (linesStr.length > 0) {
      linesStr = linesStr.slice(0, -1);
    }
    let lines: any[] = [];

    try {
      lines = JSON.parse(`[${linesStr}]`);
    } catch (e) {
      // nothing, this is the logger after all :)
    }

    const outputLines: string[] = [];
    lines.forEach((line: any) => {
      const time = `${Dim}${new Date(line.time).toISOString().replace(/T/, ' ').replace(/Z/, '')}${Reset}`;
      const bcAndApp = `${FgGray}(${line.bcName}/${line.appName})${Reset}`;
      const component = line.component
        ? `${Dim}${FgMagenta}[${line.component}]${Reset}`
        : `${Dim}[null component]${Reset}`;

      let levelLabel = pino.levels.labels[line.level];
      let levelColor = FgGray;
      if (line.level <= 10) {
        levelColor = FgGray;
      } else if (line.level <= 20) {
        levelColor = FgBlue;
      } else if (line.level <= 30) {
        levelColor = FgGreen;
      } else if (line.level <= 40) {
        levelColor = FgYellow;
      } else if (line.level <= 50) {
        levelColor = FgRed;
      } else if (line.level <= 60) {
        levelColor = FgMagenta;
      } else {
        // odd
      }
      levelLabel = `${levelColor}(${levelLabel})${Reset}`;

      outputLines.push(
        `${time} ${bcAndApp} ${component} ${levelLabel}: ${line.msg}`
      );
    });

    console.log(outputLines.join('\n'));
    callback();
  }
}

// This is what pino transport expects, must return a WritableStream instance
let stream = new CustomLoggerPrettifier();
export default async (options: any) => {
  return stream;
};
