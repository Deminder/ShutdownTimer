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
const { setTimeout, cancelTimeout } = Convenience;
let textboxes = [];
let currentUpdate = null;

// show textbox with message
function showTextbox(textmsg) {
  const renewedTextboxes = [];
  textboxes = textboxes.filter(t => {
    const moveToTop = t.text === textmsg && _cancelTimeout(t);
    if (moveToTop) {
      _startFadeout(t);
      renewedTextboxes.unshift(t);
    }
    return !moveToTop;
  });
  if (renewedTextboxes.length) {
    textboxes = renewedTextboxes.concat(textboxes);
    _debouncedUpdate();
    return;
  }

  const textbox = new St.Label({
    style_class: 'textbox-label',
    text: textmsg,
    opacity: 255,
  });
  Main.uiGroup.add_actor(textbox);
  textboxes.unshift(textbox);
  _startFadeout(textbox);
  _debouncedUpdate();
}

function _debouncedUpdate() {
  if (currentUpdate === null) {
    currentUpdate = setTimeout(50, () => {
      _update();
      currentUpdate = null;
    });
  }
}

function _update() {
  textboxes = textboxes.filter(t => {
    if (t['_hidden']) {
      Main.uiGroup.remove_actor(t);
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
      Math.floor(monitor.width / 2 - textbox.width / 2),
      Math.floor(monitor.height / 2 + height_offset)
    );
    height_offset += textbox.height + 10;
    if ('_sourceId' in textbox) {
      textbox.opacity =
        i === 0
          ? 255
          : Math.max(25, 25 + 230 * (1 - height_offset / (monitor.height / 2)));
    }
  });
}

function _startFadeout(textbox) {
  textbox['_sourceId'] = setTimeout(3000, () => {
    textbox.ease({
      opacity: 0,
      duration: 1000,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        textbox['_hidden'] = true;
        _debouncedUpdate();
      },
    });
    delete textbox['_sourceId'];
  });
}

function _cancelTimeout(textbox) {
  const cancelled = cancelTimeout(textbox['_sourceId']);
  if (cancelled) {
    delete textbox['_sourceId'];
  }
  return cancelled;
}

function hideAll() {
  cancelTimeout(currentUpdate);
  for (const t of textboxes) {
    _cancelTimeout(t);
    t['_hidden'] = true;
  }
  _debouncedUpdate();
}
