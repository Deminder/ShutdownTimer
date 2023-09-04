// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import { gettext as _, ngettext as _n } from './translation.js';

const debugMode = false;

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

export function logTest(...args) {
  if ('testLog' in globalThis) {
    globalThis.testLog(...args);
  }
}

export const MODES = ['suspend', 'poweroff', 'reboot'];
export const WAKE_MODES = ['wake', 'no-wake'];
/**
 * Get the translated mode label
 *
 * @param mode
 */
export function modeLabel(mode) {
  return {
    suspend: _('Suspend'),
    poweroff: _('Power Off'),
    reboot: _('Restart'),
    wake: _('Wake'),
    'no-wake': _('No Wake'),
  }[mode];
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

/**
 * A short duration string showing >=3 hours, >=1 mins, or secs.
 *
 * @param {number} seconds duration in seconds
 */
export function durationString(seconds) {
  const sign = Math.sign(seconds);
  const absSec = Math.floor(Math.abs(seconds));
  const minutes = Math.floor(absSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 3) {
    return _n('%s hour', '%s hours', hours).format(sign * hours);
  } else if (minutes === 0) {
    return _n('%s sec', '%s secs', absSec).format(
      sign * (absSec > 5 ? 10 * Math.ceil(absSec / 10) : absSec)
    );
  }
  return _n('%s min', '%s mins', minutes).format(sign * minutes);
}

/**
 *
 * @param minutes
 * @param hrFmt
 * @param minFmt
 */
export function longDurationString(minutes, hrFmt, minFmt) {
  const hours = Math.floor(minutes / 60);
  const residualMinutes = minutes % 60;
  let parts = [minFmt(residualMinutes).format(residualMinutes)];
  if (hours) {
    parts = [hrFmt(hours).format(hours)].concat(parts);
  }
  return parts.join(' ');
}

export function absoluteTimeString(minutes, timeFmt) {
  return GLib.DateTime.new_now_local().add_minutes(minutes).format(timeFmt);
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
