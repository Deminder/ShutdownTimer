/**
 * Textbox module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported showTextbox, hideAll */
const Main = imports.ui.main;
const { GLib, St, Clutter } = imports.gi;
let textboxes = [];

// show textbox with message
function showTextbox(textmsg) {
  for (let t of textboxes) {
    if (t.text === textmsg && _cancelTimeout(t)) {
      // if already displaying message: move to top
      textboxes.splice(t['_boxIndex'], 1);
      textboxes.unshift(t);
      _startFadeout(t);
      return;
    }
  }

  const textbox = new St.Label({
    style_class: 'textbox-label',
    text: textmsg,
    opacity: 255,
  });
  Main.uiGroup.add_actor(textbox);
  textbox['_boxIndex'] = 0;
  textboxes.unshift(textbox);
  _startFadeout(textbox);
}

function _reposition() {
  const monitor = Main.layoutManager.primaryMonitor;
  let height_offset = 0;
  for (let i = 0; i < textboxes.length; i++) {
    const textbox = textboxes[i];
    textbox['_boxIndex'] = i;
    if (i === 0) {
      height_offset = -textbox.height / 2;
    }
    textbox.set_position(
      Math.floor(monitor.width / 2 - textbox.width / 2),
      Math.floor(monitor.height / 2 + height_offset)
    );
    height_offset += textbox.height + 10;
    if ('_sourceId' in textbox) {
      textbox.opacity = i === 0 ? 255 : Math.max(
        25,
        25 + 230 * (1 - height_offset / (monitor.height / 2))
      );
    }
  }
}

function _startFadeout(textbox) {
  textbox['_sourceId'] = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    3,
    () => {
      textbox.ease({
        opacity: 0,
        duration: 1000,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          _removeTextbox(textbox);
          textboxes.splice(textbox['_boxIndex'], 1);
          _reposition();
        },
      });
      delete textbox['_sourceId'];
      return GLib.SOURCE_REMOVE;
    }
  );
  _reposition();
}

function _cancelTimeout(textbox) {
  const active = '_sourceId' in textbox;
  if (active) {
    GLib.Source.remove(textbox['_sourceId']);
    delete textbox['_sourceId'];
  }
  return active;
}

function _removeTextbox(textbox) {
  _cancelTimeout(textbox);
  Main.uiGroup.remove_actor(textbox);
}

function hideAll() {
  for (let t of textboxes) {
    _removeTextbox(t);
  }
  textboxes = [];
}
