/**
 * Convenience module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported MODES, WAKE_MODES, modeLabel, logDebug, proxyPromise, longDurationString */

const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

let debugMode = false;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}

var MODES = ['suspend', 'poweroff', 'reboot'];
var WAKE_MODES = ['wake', 'no-wake'];
function modeLabel(mode) {
  return {
    suspend: _('Suspend'),
    poweroff: _('Power Off'),
    reboot: _('Restart'),
    wake: _('Wake after'),
    'no-wake': _('No Wake'),
  }[mode];
}

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

function longDurationString(minutes, hrFmt, minFmt) {
  const hours = Math.floor(minutes / 60)
  const residualMinutes = minutes % 60;
  let parts = [minFmt(residualMinutes).format(residualMinutes)];
  if (hours) {
    parts = [hrFmt(hours).format(hours)].concat(parts);
  }
  return parts.join(' ');
}
