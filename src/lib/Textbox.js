/**
 * Textbox module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported showTextbox, hideAll */
const Main = imports.ui.main;
const { St, Clutter } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { logDebug, debounceTimeout } = Convenience;
let textboxes = [];
let [debounceUpdate, debounceUpdateCancel] = debounceTimeout(50, _update);

// show textbox with message
function showTextbox(textmsg) {
  for (const t of textboxes) {
    // replace old textbox if it has the same text
    if (t.text === textmsg) {
      t['_hidden'] = 1;
    }
  }
  logDebug('show textbox: ' + textmsg);
  const textbox = new St.Label({
    style_class: 'textbox-label',
    text: textmsg,
    opacity: 0,
  });
  Main.uiGroup.add_actor(textbox);
  textboxes.unshift(textbox);
  debounceUpdate();
}

function _update() {
  // remove hidden textboxes
  textboxes = textboxes.filter(t => {
    if (t['_hidden']) {
      clearTimeout(t['_sourceId']);
      t.destroy();
    }
    return !t['_hidden'];
  });
  const monitor = Main.layoutManager.primaryMonitor;
  let height_offset = 0;
  textboxes.forEach((textbox, i) => {
    if (i === 0) {
      height_offset = -textbox.height / 2;
    }
    textbox.set_position(
      monitor.x + Math.floor(monitor.width / 2 - textbox.width / 2),
      monitor.y + Math.floor(monitor.height / 2 + height_offset)
    );
    height_offset += textbox.height + 10;
    if (!('_sourceId' in textbox)) {
      // start fadeout of textbox after 3 seconds
      textbox['_sourceId'] = setTimeout(() => {
        textbox.ease({
          opacity: 0,
          duration: 1000,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => {
            textbox['_hidden'] = 1;
            debounceUpdate();
          },
        });
        textbox['_sourceId'] = 0;
      }, 3000);
    }
    if (textbox['_sourceId']) {
      // set opacity before fadeout starts
      textbox.opacity =
        i === 0
          ? 255
          : Math.max(25, 25 + 230 * (1 - height_offset / (monitor.height / 2)));
    }
  });
}

function hideAll() {
  debounceUpdateCancel();
  for (const t of textboxes) {
    t['_hidden'] = 1;
  }
  _update();
}
