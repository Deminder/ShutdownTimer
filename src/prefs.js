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
const { logDebug } = Convenience;
const { enableGuiIdle, disableGuiIdle, guiIdle, modeLabel, MODES } =
  Convenience;

const { GLib, Gtk, Gio } = imports.gi;

/**
 *
 */
function init() {
  ExtensionUtils.initTranslations();
}

const templateComponents = {
  shutdown: {
    'shutdown-mode': 'combo',
    'root-mode': 'switch',
    'show-end-session-dialog': 'switch',
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
    'show-shutdown-indicator': 'switch',
    'show-textboxes': 'switch',
    'show-wake-slider': 'switch',
    'show-wake-items': 'switch',
  },
  check: {
    'check-command': 'textbuffer',
    'enable-check-command': 'switch',
  },
};

/**
 *
 * @param pageId
 * @param builder
 * @param settings
 * @param handlers
 */
function initPage(pageId, builder, settings, handlers) {
  const page = builder.get_object(pageId);
  const pageName = pageId.split('_').at(-1);
  if (!page) {
    throw new Error(`${pageId} not found!`);
  }

  const connectComp = (baseName, component) => {
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

    if (compId === 'show_shutdown_mode_buffer') {
      builder
        .get_object(`${baseId}_entry`)
        .set_placeholder_text(
          `${MODES.join(',')} (${MODES.map(modeLabel).join(', ')})`
        );
    }
  };

  if (pageName in templateComponents) {
    for (const [k, v] of Object.entries(templateComponents[pageName])) {
      connectComp(k, v);
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
    const applyCommentTags = b => {
      b.remove_tag(commentTag, b.get_start_iter(), b.get_end_iter());
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
    applyCommentTags(checkCommandBuffer);
    handlers.push([
      checkCommandBuffer,
      checkCommandBuffer.connect('changed', applyCommentTags),
    ]);
  } else if (pageName === 'install') {
    // install log textbuffer updates
    const logTextBuffer = builder.get_object('install_log_textbuffer');
    const scrollAdj = builder.get_object('installer_scrollbar_adjustment');
    const errorTag = new Gtk.TextTag({ foreground: 'red' });
    const successTag = new Gtk.TextTag({ foreground: 'green' });
    logTextBuffer.get_tag_table().add(errorTag);
    logTextBuffer.get_tag_table().add(successTag);
    const appendLogLine = line => {
      line = ['[', '#'].includes(line[0]) ? line : ` ${line}`;
      logTextBuffer.insert(logTextBuffer.get_end_iter(), `${line}\n`, -1);
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
      guiIdle(() => scrollAdj.set_value(1000000));
    };

    const installSwitch = builder.get_object('install_policy_switch');
    installSwitch.set_active(Install.checkInstalled());
    const switchHandlerId = installSwitch.connect('notify::active', () =>
      Install.installAction(
        installSwitch.get_active() ? 'install' : 'uninstall',
        message => guiIdle(() => message.split('\n').forEach(appendLogLine))
      )
    );
    handlers.push([installSwitch, switchHandlerId]);

    // clear log
    guiIdle(() => logTextBuffer.set_text('', -1));
  }
  return page;
}

/**
 *
 * @param window
 */
function fillPreferencesWindow(window) {
  const builder = Gtk.Builder.new();
  builder.add_from_file(
    Me.dir.get_child('ui').get_child('prefs.ui').get_path()
  );

  const settings = ExtensionUtils.getSettings();
  const handlers = [];
  const pageNames = ['install', 'shutdown', 'wake', 'display', 'check'].map(
    n => `shutdowntimer-prefs-${n}`
  );
  enableGuiIdle();
  for (const page of pageNames.map(name =>
    initPage(name.replaceAll('-', '_'), builder, settings, handlers)
  )) {
    window.add(page);
  }
  const selPageName =
    pageNames[settings.get_int('preferences-selected-page-value')];
  if (selPageName) {
    window.set_visible_page_name(selPageName);
  }
  const pageVisHandlerId = window.connect('notify::visible-page-name', () => {
    logDebug(window.get_visible_page_name());
    settings.set_int(
      'preferences-selected-page-value',
      pageNames.indexOf(window.get_visible_page_name())
    );
  });
  handlers.push([window, pageVisHandlerId]);
  // release all resources on destroy
  const destroyId = window.connect('destroy', () => {
    disableGuiIdle();
    handlers.forEach(([comp, handlerId]) => {
      comp.disconnect(handlerId);
    });
    Install.reset();
    window.disconnect(destroyId);
  });
}
