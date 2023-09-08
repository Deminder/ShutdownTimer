// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

export const debugMode = false;

/**
 * Log debug message if debug is enabled .
 *
 * @param {...any} args log arguments
 */
export function logDebug(...args) {
  if ('logDebug' in globalThis) {
    globalThis.logDebug(...args);
  } else if (debugMode) {
    console.log('[SDT]', ...args);
  }
}

export function proxyPromise(ProxyType, session, dest, objectPath) {
  return new Promise((resolve, reject) => {
    new ProxyType(session, dest, objectPath, (proxy, error) => {
      if (error) {
        reject(error);
      } else {
        resolve(proxy);
      }
    });
  });
}

export class Idle {
  #idleSourceId = null;
  #idleResolves = [];

  destroy() {
    // Ensure that promises are resolved
    for (const resolve of this.#idleResolves) {
      resolve();
    }
    this.#idleResolves = [];
    if (this.#idleSourceId) {
      GLib.Source.remove(this.#idleSourceId);
    }
    this.#idleSourceId = null;
  }

  /**
   * Resolves when event loop is idle
   */
  guiIdle() {
    return new Promise(resolve => {
      this.#idleResolves.push(resolve);
      if (!this.#idleSourceId) {
        this.#idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          for (const res of this.#idleResolves) {
            res();
          }
          this.#idleResolves = [];
          this.#idleSourceId = null;
          return GLib.SOURCE_REMOVE;
        });
      }
    });
  }
}

/**
 * Calls to `event` are delayed (throttled).
 * Call `cancel` drop last event.
 *
 * @param {Function} timeoutFunc called function after delay
 * @param {number} delayMillis delay in milliseconds
 * @returns [event, cancel]
 */
export function throttleTimeout(timeoutFunc, delayMillis) {
  let current = null;
  return [
    () => {
      if (current === null) {
        current = setTimeout(() => {
          current = null;
          timeoutFunc();
        }, delayMillis);
      }
    },
    () => {
      if (current) {
        clearTimeout(current);
        current = null;
      }
    },
  ];
}
