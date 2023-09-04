// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

const baseTestRegex = /\/test-base\.js:\d+:\d+$/;
const logFmt = new Intl.DateTimeFormat('en-US', {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
});
const fileRegex = /(.*)@(.*\/)(.*:\d+)(:\d+)$/;

const GRAY = '\u001b[30m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const BLUE = '\u001b[94m';
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';
function throwError(message) {
  const error = new Error(message);
  error.assertion = true;
  throw error;
}
let logLines = [];
export const logOriginExcludes = new Map();

function testLog(...args) {
  const error = new Error();
  const originLine = error.stack
    .split('\n')
    .slice(1)
    .find(line => !baseTestRegex.test(line));
  if (
    [...logOriginExcludes.values()].every(
      excludeRegex => !excludeRegex.test(originLine)
    )
  ) {
    logLines.push([fileRegex.exec(originLine)[3], new Date(), ...args]);
  }
}

async function runIt(unit, [should, func]) {
  try {
    print('  ', should);
    logLines = [];
    logOriginExcludes.clear();
    const ret = func();
    return ret instanceof Promise ? await ret : ret;
  } catch (error) {
    print(`${RED}[TEST FAILED]${RESET}`);
    for (const [origin, date, ...line] of logLines) {
      print(
        `${GREEN}${origin} ${BLUE}${logFmt.format(date)}${RESET}:`,
        ...line
      );
    }
    if (error.assertion) {
      print(
        `${RED}[assertion failed]${RESET} ${error.message}\n${error.stack
          .split('\n')
          .filter(line => !baseTestRegex.test(line))
          .map(line => {
            line = line.trimStart();
            if (line) {
              const [_, funcName, filePath, fileName, col] =
                fileRegex.exec(line);
              return `${RESET}${range(25)
                .map(c => funcName[c] ?? ' ')
                .join(
                  ''
                )} @ ${CYAN}${filePath}${RESET}${fileName}${GRAY}${col}${RESET}`;
            } else {
              return line;
            }
          })
          .join('\n')}`
      );
    } else {
      console.error(`[failed] ${error.message}\n`, error.stack);
    }
    throw new Error(`${unit}: ${should}!`);
  }
}

export async function describe(unit, ...itEntires) {
  const origLog = globalThis.log;
  const origLogDebug = globalThis.logDebug;
  globalThis.testLog = testLog;
  globalThis.log = testLog;
  globalThis.logDebug = testLog;

  print(`${unit}:`);
  for await (const itResult of itEntires.map(itEntry => runIt(unit, itEntry))) {
    if (itResult !== undefined) {
      console.warn('Unexpected return value:', itResult);
    }
  }
  delete globalThis.testLog;
  globalThis.log = origLog;
  globalThis.logDebug = origLogDebug;
}

export function it(should, testFunc) {
  return [should, testFunc];
}

export function assert(a, message = 'should be true') {
  if (!a) throwError(message);
}

export function assertEquals(a, b, message = 'should equal') {
  const strA = JSON.stringify(a);
  const strB = JSON.stringify(b);
  if (strA !== strB) throwError(`${message}\n${strA} != ${strB}`);
}

export function permutations(keys, k) {
  k ??= keys.length;
  return k <= 1
    ? keys.map(key => [key])
    : keys.length > 1
    ? keys.flatMap((key, i) =>
        permutations([...keys.slice(0, i), ...keys.slice(i + 1)], k - 1).map(
          comb => [key, ...comb]
        )
      )
    : [keys];
}

export function product(aa, bb) {
  return aa.flatMap(a => bb.map(b => [a,b]))
}

export function range(end) {
  return [...Array(end).keys()];
}
export function combinations(keys, k) {
  return permutations(keys, k).filter(p =>
    [...p].sort().every((v, i) => v === p[i])
  );
}
