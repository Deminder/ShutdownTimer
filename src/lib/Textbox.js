/**
 * Textbox module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported showTextbox */
const Main = imports.ui.main;
const { GLib, St, Clutter } = imports.gi;
let textbox;

// show textbox with message
function showTextbox(textmsg) {
  if (textbox === undefined) {
    textbox = new St.Label({
      style_class: 'textbox-label',
      text: 'Hello, world!',
    });
    Main.uiGroup.add_actor(textbox);
  } else {
    _cancelHideTimeout();
  }
  textbox.text = textmsg;
  textbox.opacity = 255;
  let monitor = Main.layoutManager.primaryMonitor;
  textbox.set_position(
    Math.floor(monitor.width / 2 - textbox.width / 2),
    Math.floor(monitor.height / 2 - textbox.height / 2)
  );
  textbox['_sourceId'] = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    3,
    () => {
      textbox.ease({
        opacity: 0,
        // delay: 3000,  // delay does not work for shell 3.38
        duration: 1000,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: _hideTextbox,
      });
      delete textbox['_sourceId'];
      return GLib.SOURCE_REMOVE;
    }
  );
}

function _cancelHideTimeout() {
  if (textbox !== undefined && '_sourceId' in textbox) {
    GLib.Source.remove(textbox['_sourceId']);
    delete textbox['_sourceId'];
  }
}

function _hideTextbox() {
  _cancelHideTimeout();
  if (textbox !== undefined) {
    Main.uiGroup.remove_actor(textbox);
    textbox = undefined;
  }
}
