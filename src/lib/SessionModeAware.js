/**
 * ScreenModeAware module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
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
