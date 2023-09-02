// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function currentSessionMode() {
  return Main.sessionMode.currentMode;
}

/**
 * Check if we want to show foreground activity
 */
export function foregroundActive() {
  // ubuntu22.04 uses 'ubuntu' as 'user' sessionMode
  return Main.sessionMode.currentMode !== 'unlock-dialog';
}

/**
 * Observe foreground activity changes
 *
 * @param {object} obj bind obj as observer
 * @param {Function} callback called upon change
 */
export function observeForegroundActive(obj, callback) {
  if (!obj._sessionModeSignalId) {
    obj._sessionModeSignalId = Main.sessionMode.connect('updated', () => {
      callback(foregroundActive());
    });
  }
  callback(foregroundActive());
}

/**
 * Unobserve session mode
 */
export function unobserveForegroundActive(obj) {
  if (obj._sessionModeSignalId) {
    Main.sessionMode.disconnect(obj._sessionModeSignalId);
    delete obj._sessionModeSignalId;
  }
}
