// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported load, unload */
const Main = imports.ui.main;

let sessionId = null;

/**
 *
 * @param onSessionModeChange
 */
function load(onSessionModeChange) {
  if (sessionId === null) {
    sessionId = Main.sessionMode.connect('updated', session =>
      onSessionModeChange(session.currentMode)
    );
  }
}

/**
 *
 */
function unload() {
  if (sessionId !== null) {
    Main.sessionMode.disconnect(sessionId);
    sessionId = null;
  }
}
