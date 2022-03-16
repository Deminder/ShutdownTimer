/**
 * Extension preferences GUI
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported init, fillPreferencesWindow */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Install, Convenience } = Me.imports.lib;
var { logDebug, modeLabel, MODES } = Convenience;

const { GLib, Gtk } = imports.gi;

function init() {
  ExtensionUtils.initTranslations();
}

const templateComponents = {
  'shutdown-max-timer': 'adjustment',
  'shutdown-slider': 'adjustment',
  'non-linear-shutdown-slider': 'decimal',
  'show-settings': 'switch',
  'root-mode': 'switch',
  'show-shutdown-mode': 'buffer',
  'show-shutdown-slider': 'switch',
  'show-textboxes': 'switch',
  'check-command': 'textbuffer',
  'enable-check-command': 'switch',
  'shutdown-mode': 'combo',
  'auto-wake': 'switch',
  'wake-max-timer': 'adjustment',
  'wake-slider': 'adjustment',
  'non-linear-wake-slider': 'decimal',
  'show-wake-slider': 'switch',
  'show-wake-items': 'switch',
};

function guiIdle(page) {
  return new Promise((resolve, reject) => {
    try {
      const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        delete page._idleSourceIds[sourceId];
        return GLib.SOURCE_REMOVE;
      });
      page._idleSourceIds[sourceId] = 1;
    } catch (err) {
      reject(err);
    }
  });
}

function init_page(builder) {
  const settings = ExtensionUtils.getSettings();
  const handlers = [];
  const settingsHandlerIds = [];

  const page = builder.get_object('shutdowntimer_prefs_page');
  page._idleSourceIds = {};

  const connectFuncs = {
    adjustment: [
      v => v.get_value(),
      (v, s) => v.set_value(s),
      sn => settings.get_int(sn),
      (sn, v) => settings.set_int(sn, v),
      'value-changed',
    ],
    decimal: [
      v => v.get_value(),
      (v, s) => v.set_value(s),
      sn => Number.parseFloat(settings.get_string(sn)),
      (sn, v) => settings.set_string(sn, v.toFixed(3)),
      'value-changed',
    ],
    switch: [
      v => v.get_active(),
      (v, s) => v.set_active(s),
      sn => settings.get_boolean(sn),
      (sn, v) => settings.set_boolean(sn, v),
      'notify::active',
    ],
    textbuffer: [
      v => v.get_text(v.get_start_iter(), v.get_end_iter(), false),
      (v, s) => v.set_text(s, -1),
      sn => settings.get_string(sn),
      (sn, v) => settings.set_string(sn, v),
      'notify::text',
    ],
    buffer: [
      v => v.get_text(),
      (v, s) => v.set_text(s, -1),
      sn => settings.get_string(sn),
      (sn, v) => settings.set_string(sn, v),
      'notify::text',
    ],
    combo: [
      v => v.get_active_id(),
      (v, s) => v.set_active_id(s),
      sn => settings.get_string(sn),
      (sn, v) => settings.set_string(sn, v),
      'changed',
    ],
  };

  const connect_comp = (baseName, component) => {
    const baseId = baseName.replaceAll('-', '_');
    const [fieldGetter, fieldSetter, settingsGetter, settingsSetter, signal] =
      connectFuncs[component];
    const settingsName = `${baseName}-value`;
    const fieldValue = settingsGetter(settingsName);
    const compId = `${baseId}_${component}`;
    const comp = builder.get_object(compId);
    if (!comp) {
      throw new Error(`Component not found in template: ${compId}`);
    }
    if (baseName === 'shutdown-mode') {
      // replace combo box entries
      comp.remove_all();
      MODES.forEach(mode => {
        comp.append(mode, modeLabel(mode));
      });
    }
    fieldSetter(comp, fieldValue);

    if (component === 'buffer') {
      const entry = builder.get_object(`${baseId}_entry`);
      entry.set_placeholder_text(
        baseName === 'show-shutdown-mode'
          ? `${MODES.join(',')} (${MODES.map(modeLabel).join(', ')})`
          : entry.get_placeholder_text()
      );
    }
    let lastActivity = { type: 'internal', time: 0 };
    const maybeUpdate = (type, update) => {
      const time = GLib.get_monotonic_time();
      if (lastActivity.type === type || time > lastActivity.time + 100000) {
        lastActivity = { type, time };
        update();
      }
    };
    const handlerId = comp.connect(signal, w => {
      maybeUpdate('internal', () => {
        const val = fieldGetter(w);
        settingsSetter(settingsName, val);
      });
    });
    // update ui if values change externally
    const settingsHandlerId = settings.connect(
      'changed::' + settingsName,
      () => {
        maybeUpdate('external', () => {
          const val = settingsGetter(settingsName);
          if (val !== fieldGetter(comp)) {
            fieldSetter(comp, val);
          }
        });
      }
    );
    handlers.push([comp, handlerId]);
    settingsHandlerIds.push(settingsHandlerId);
  };

  const notebook = builder.get_object('main_notebook');
  notebook.set_current_page(
    settings.get_int('preferences-selected-page-value')
  );
  const notebookHandlerId = notebook.connect(
    'switch-page',
    (_nb, _pg, page_num) => {
      settings.set_int('preferences-selected-page-value', page_num);
    }
  );
  handlers.push([notebook, notebookHandlerId]);

  Object.entries(templateComponents).forEach(([k, v]) => {
    connect_comp(k, v);
  });

  const lineIter = (buffer, lineIndex) => {
    const [ok, iter] = buffer.get_iter_at_line(lineIndex);
    if (!ok) {
      throw new Error(`Line ${lineIndex} not found!`);
    }
    return iter;
  };
  // check command textbuffer

  const checkCommandBuffer = builder.get_object('check_command_textbuffer');
  const commentTag = new Gtk.TextTag({ foreground: 'grey' });
  checkCommandBuffer.get_tag_table().add(commentTag);
  const apply_comment_tags = b => {
    b.remove_all_tags(b.get_start_iter(), b.get_end_iter());
    const lc = b.get_line_count();
    for (let i = 0; i < lc; i++) {
      const startIter = lineIter(b, i);
      const endIter = lc === i + 1 ? b.get_end_iter() : lineIter(b, i + 1);
      const line = b.get_text(startIter, endIter, false);
      if (line.trimLeft().startsWith('#')) {
        b.apply_tag(commentTag, startIter, endIter);
      }
    }
  };
  const ccBufferHandlerId = checkCommandBuffer.connect(
    'changed',
    apply_comment_tags
  );
  apply_comment_tags(checkCommandBuffer);
  handlers.push([checkCommandBuffer, ccBufferHandlerId]);

  // install log textbuffer updates
  const logTextBuffer = builder.get_object('install_log_textbuffer');
  const scrollAdj = builder.get_object('installer_scrollbar_adjustment');
  const errorTag = new Gtk.TextTag({ foreground: 'red' });
  const successTag = new Gtk.TextTag({ foreground: 'green' });
  logTextBuffer.get_tag_table().add(errorTag);
  logTextBuffer.get_tag_table().add(successTag);
  const appendLogLine = line => {
    line = ['[', '#'].includes(line[0]) ? line : ' ' + line;
    logTextBuffer.insert(logTextBuffer.get_end_iter(), line + '\n', -1);
    const lastLineIndex = logTextBuffer.get_line_count() - 1;
    const applyTag = tag => {
      logTextBuffer.apply_tag(
        tag,
        lineIter(logTextBuffer, lastLineIndex - 1),
        lineIter(logTextBuffer, lastLineIndex)
      );
    };
    if (line.startsWith('# ')) {
      applyTag(errorTag);
    } else if (line.endsWith('🟢')) {
      applyTag(successTag);
    }
    guiIdle(page)
      .then(() => {
        scrollAdj.set_value(1000000);
      })
      .catch(() => {});
  };

  const installSwitch = builder.get_object('install_policy_switch');
  installSwitch.set_active(Install.checkInstalled());
  const switchHandlerId = installSwitch.connect('notify::active', () =>
    Install.installAction(
      installSwitch.get_active() ? 'install' : 'uninstall',
      message =>
        guiIdle(page)
          .then(() => message.split('\n').forEach(appendLogLine))
          .catch(err => {
            logDebug(`${err}...\nMissed message: ${message}`);
          })
    )
  );
  handlers.push([installSwitch, switchHandlerId]);

  guiIdle(page).then(() => {
    // clear log
    logTextBuffer.set_text('', -1);
  });

  // release all resources on destroy
  const destroyId = page.connect('destroy', () => {
    Object.keys(page._idleSourceIds).forEach(sourceId => {
      GLib.Source.remove(sourceId);
    });
    handlers.forEach(([comp, handlerId]) => {
      comp.disconnect(handlerId);
    });
    settingsHandlerIds.forEach(handlerId => {
      settings.disconnect(handlerId);
    });
    Install.reset();
    page.disconnect(destroyId);
  });
  return page;
}

function fillPreferencesWindow(window) {
  let builder = Gtk.Builder.new();
  builder.add_from_file(Me.dir.get_child('ui').get_child('prefs.ui').get_path());
  window.add(init_page(builder));
}
