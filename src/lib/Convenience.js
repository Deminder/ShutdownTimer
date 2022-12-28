/**
 * Convenience module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported MODES, WAKE_MODES, modeLabel, logDebug, proxyPromise, durationString, longDurationString, absoluteTimeString, disableGuiIdle, enableGuiIdle, guiIdle, throttleTimeout */

const { GLib } = imports.gi;
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const _n = Gettext.ngettext;

let debugMode = false;

/**
 *
 * @param {...any} args
 */
function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}

var MODES = ['suspend', 'poweroff', 'reboot'];
var WAKE_MODES = ['wake', 'no-wake'];
/**
 *
 * @param mode
 */
function modeLabel(mode) {
  return {
    suspend: _('Suspend'),
    poweroff: _('Power Off'),
    reboot: _('Restart'),
    wake: _('Wake'),
    'no-wake': _('No Wake'),
  }[mode];
}

/**
 *
 * @param ProxyType
 * @param session
 * @param dest
 * @param objectPath
 */
function proxyPromise(ProxyType, session, dest, objectPath) {
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
 *
 * @param seconds
 */
function durationString(seconds) {
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
function longDurationString(minutes, hrFmt, minFmt) {
  const hours = Math.floor(minutes / 60);
  const residualMinutes = minutes % 60;
  let parts = [minFmt(residualMinutes).format(residualMinutes)];
  if (hours) {
    parts = [hrFmt(hours).format(hours)].concat(parts);
  }
  return parts.join(' ');
}

function absoluteTimeString(minutes, timeFmt) {
  return GLib.DateTime.new_now_local().add_minutes(minutes).format(timeFmt)
}


let idleSourceId = null;
let idleCallbacks = [];
let idleEnabled = false;

/**
 *
 */
function enableGuiIdle() {
  idleEnabled = true;
}

/**
 *
 */
function disableGuiIdle() {
  idleEnabled = false;
  idleCallbacks = [];
  if (idleSourceId) {
    GLib.Source.remove(idleSourceId);
  }
  idleSourceId = null;
}

/**
 *
 * @param callback
 */
function guiIdle(callback) {
  if (idleEnabled) {
    idleCallbacks.push(callback);
    if (!idleSourceId) {
      idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        for (const func of idleCallbacks) {
          func();
        }
        idleCallbacks = [];
        idleSourceId = null;
        return GLib.SOURCE_REMOVE;
      });
    }
  }
}

/**
 *
 * @param timeoutFunc
 * @param delayMillis
 */
function throttleTimeout(timeoutFunc, delayMillis) {
  let current = null;
  return [
    () => {
      if (current === null) {
        current = setTimeout(() => {
          timeoutFunc();
          current = null;
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
