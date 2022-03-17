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

const { GLib, Gtk, Gio } = imports.gi;

function init() {
  ExtensionUtils.initTranslations();
}

const templateComponents = {
  shutdown: {
    'shutdown-mode': 'combo',
    'root-mode': 'switch',
    'shutdown-max-timer': 'adjustment',
    'shutdown-slider': 'adjustment',
    'nonlinear-shutdown-slider': 'adjustment',
  },
  wake: {
    'auto-wake': 'switch',
    'wake-max-timer': 'adjustment',
    'wake-slider': 'adjustment',
    'nonlinear-wake-slider': 'adjustment',
  },
  display: {
    'show-settings': 'switch',
    'show-shutdown-mode': 'buffer',
    'show-shutdown-slider': 'switch',
    'show-textboxes': 'switch',
    'show-wake-slider': 'switch',
    'show-wake-items': 'switch',
  },
  check: {
    'check-command': 'textbuffer',
    'enable-check-command': 'switch',
  },
};

function _guiIdle(idleSourceIds) {
  return new Promise((resolve, reject) => {
    try {
      const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        delete idleSourceIds[sourceId];
        return GLib.SOURCE_REMOVE;
      });
      idleSourceIds[sourceId] = 1;
    } catch (err) {
      reject(err);
    }
  });
}

function init_page(pageId, builder, settings, handlers, guiIdle) {
  const page = builder.get_object(pageId);
  const pageName = pageId.split('_').at(-1);
  if (!page) {
    throw new Error(`${pageId} not found!`);
  }

  const connect_comp = (baseName, component) => {
    const baseId = baseName.replaceAll('-', '_');
    const settingsName = `${baseName}-value`;
    const compId = `${baseId}_${component}`;
    const comp = builder.get_object(compId);
    if (!comp) {
      throw new Error(`Component not found in template: ${compId}`);
    }
    if (compId === 'shutdown_mode_combo') {
      // replace combo box entries
      comp.remove_all();
      MODES.forEach(mode => {
        comp.append(mode, modeLabel(mode));
      });
    }

    // init field value
    ({
      adjustment: (v, sn) => v.set_value(settings.get_int(sn)),
      switch: (v, sn) => v.set_active(settings.get_boolean(sn)),
      textbuffer: (v, sn) => v.set_text(settings.get_string(sn), -1),
      buffer: (v, sn) => v.set_text(settings.get_string(sn), -1),
      combo: (v, sn) => v.set_active_id(settings.get_string(sn)),
    }[component](comp, settingsName));

    if (compId === 'show_shutdown_mode_buffer') {
      builder
        .get_object(`${baseId}_entry`)
        .set_placeholder_text(
          `${MODES.join(',')} (${MODES.map(modeLabel).join(', ')})`
        );
    }

    settings.bind(
      settingsName,
      comp,
      {
        adjustment: 'value',
        switch: 'active',
        textbuffer: 'text',
        buffer: 'text',
        combo: 'active-id',
      }[component],
      Gio.SettingsBindFlags.DEFAULT
    );
  };

  if (pageName in templateComponents) {
    for (const [k, v] of Object.entries(templateComponents[pageName])) {
      connect_comp(k, v);
    }
  }

  const lineIter = (buffer, lineIndex) => {
    const [ok, iter] = buffer.get_iter_at_line(lineIndex);
    if (!ok) {
      throw new Error(`Line ${lineIndex} not found!`);
    }
    return iter;
  };

  if (pageName === 'check') {
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
  } else if (pageName === 'install') {
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
      guiIdle()
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
          guiIdle()
            .then(() => message.split('\n').forEach(appendLogLine))
            .catch(err => {
              logDebug(`${err}...\nMissed message: ${message}`);
            })
      )
    );
    handlers.push([installSwitch, switchHandlerId]);

    guiIdle().then(() => {
      // clear log
      logTextBuffer.set_text('', -1);
    });
  }
  return page;
}

function fillPreferencesWindow(window) {
  const builder = Gtk.Builder.new();
  builder.add_from_file(
    Me.dir.get_child('ui').get_child('prefs.ui').get_path()
  );

  const settings = ExtensionUtils.getSettings();
  const handlers = [];
  const idleSourceIds = {};
  const pageNames = ['install', 'shutdown', 'wake', 'display', 'check'].map(
    n => 'shutdowntimer-prefs-' + n
  );
  for (const page of pageNames.map(name =>
    init_page(name.replaceAll('-', '_'), builder, settings, handlers, () =>
      _guiIdle(idleSourceIds)
    )
  )) {
    window.add(page);
  }
  const selPageName =
    pageNames[settings.get_int('preferences-selected-page-value')];
  if (selPageName) {
    window.set_visible_page_name(selPageName);
  }
  const pageVisHandlerId = window.connect('notify::visible-page-name', () =>
    settings.set_int(
      'preferences-selected-page-value',
      pageNames.indexOf(window.get_visible_page_name())
    )
  );
  handlers.push([window, pageVisHandlerId]);
  // release all resources on destroy
  const destroyId = window.connect('destroy', () => {
    Object.keys(idleSourceIds).forEach(sourceId => {
      GLib.Source.remove(sourceId);
    });
    handlers.forEach(([comp, handlerId]) => {
      comp.disconnect(handlerId);
    });
    Install.reset();
    window.disconnect(destroyId);
  });
}
