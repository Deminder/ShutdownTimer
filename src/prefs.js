// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported init, fillPreferencesWindow */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Install, Convenience } = Me.imports.lib;
const { logDebug } = Convenience;
const { enableGuiIdle, disableGuiIdle, guiIdle, modeLabel, MODES } =
  Convenience;

const { GLib, Gtk, Gio } = imports.gi;

function init() {
  ExtensionUtils.initTranslations();
}

const templateComponents = {
  shutdown: {
    'shutdown-mode': 'combo',
    'root-mode': 'switch',
    'show-end-session-dialog': 'switch',
    'shutdown-max-timer': 'adjustment',
    'shutdown-ref-timer': 'buffer',
    'shutdown-slider': 'adjustment',
    'nonlinear-shutdown-slider': 'adjustment',
  },
  wake: {
    'auto-wake': 'switch',
    'wake-max-timer': 'adjustment',
    'wake-ref-timer': 'buffer',
    'wake-slider': 'adjustment',
    'nonlinear-wake-slider': 'adjustment',
  },
  display: {
    'show-settings': 'switch',
    'show-shutdown-mode': 'buffer',
    'show-shutdown-slider': 'switch',
    'show-shutdown-indicator': 'switch',
    'show-shutdown-absolute-timer': 'switch',
    'show-textboxes': 'switch',
    'show-wake-slider': 'switch',
    'show-wake-items': 'switch',
    'show-wake-absolute-timer': 'switch',
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
 */
function initPage(pageId, builder, settings) {
  const page = builder.get_object(pageId);
  const pageName = pageId.split('_').at(-1);
  if (!page) {
    throw new Error(`${pageId} not found!`);
  }

  if (pageName === 'check') {
    // Check command textbuffer
    const checkCommandBuffer = builder.get_object('check_command_textbuffer');
    const commentTag = new Gtk.TextTag({ foreground: 'grey' });
    checkCommandBuffer.get_tag_table().add(commentTag);
    checkCommandBuffer.connect('changed', () => {
      const b = checkCommandBuffer;
      b.remove_all_tags(b.get_start_iter(), b.get_end_iter());
      let anchor = b.get_start_iter();
      while (!anchor.is_end()) {
        const [ok, start] = anchor.forward_search(
          '#',
          Gtk.TextSearchFlags.TEXT_ONLY,
          null
        );
        if (!ok) break;
        anchor = start.copy();
        const m = anchor.copy();
        if (!m.starts_line() && m.backward_char() && m.get_char() === '\\') {
          anchor.forward_char();
          continue;
        } else anchor.forward_to_line_end();
        b.apply_tag(commentTag, start, anchor);
        anchor.forward_char();
      }
    });
  } else if (pageName === 'install') {
    // install log textbuffer updates
    const logTextBuffer = builder.get_object('install_log_textbuffer');
    const scrollAdj = builder.get_object('installer_scrollbar_adjustment');
    const errorTag = new Gtk.TextTag({ foreground: 'red' });
    const successTag = new Gtk.TextTag({ foreground: 'green' });
    const table = logTextBuffer.get_tag_table();
    table.add(errorTag);
    table.add(successTag);

    const installSwitch = builder.get_object('install_policy_switch');
    installSwitch.set_active(Install.checkInstalled());
    installSwitch.connect('notify::active', () =>
      Install.installAction(
        installSwitch.get_active() ? 'install' : 'uninstall',
        message =>
          guiIdle(() =>
            // Format log lines
            message.split('\n').forEach(line => {
              line = ['[', '#'].includes(line[0]) ? line : ` ${line}`;
              const b = logTextBuffer;
              b.insert(b.get_end_iter(), `${line}\n`, -1);
              const end = b.get_end_iter();
              const start = end.copy();
              if (start.backward_line()) {
                if (line.startsWith('# ')) {
                  b.apply_tag(errorTag, start, end);
                } else if (line.endsWith('🟢')) {
                  b.apply_tag(successTag, start, end);
                }
              }
              guiIdle(() => scrollAdj.set_value(1000000));
            })
          )
      )
    );
    // clear log
    guiIdle(() => logTextBuffer.set_text('', -1));
  }
  if (pageName in templateComponents) {
    for (const [baseName, component] of Object.entries(
      templateComponents[pageName]
    )) {
      const baseId = baseName.replaceAll('-', '_');
      const settingsName = `${baseName}-value`;
      const compId = `${baseId}_${component}`;
      const comp = builder.get_object(compId);
      if (!comp) {
        throw new Error(`Component not found in template: ${compId}`);
      }
      if (compId === 'shutdown_mode_combo') {
        const model = new Gtk.StringList();
        for (const mode of Object.values(MODES)) {
          model.append(modeLabel(mode));
        }
        comp.model = model;
        const updateComboRow = () => {
          const index = MODES.indexOf(
            settings.get_string('shutdown-mode-value')
          );
          if (index >= 0 && index !== comp.selected) comp.selected = index;
        };
        comp.connect('notify::selected', () => {
          const mode = MODES[comp.selected];
          if (mode) settings.set_string('shutdown-mode-value', mode);
        });
        const comboHandlerId = settings.connect(
          'changed::shutdown-mode-value',
          () => updateComboRow()
        );
        comp.connect('destroy', () => settings.disconnect(comboHandlerId));
        updateComboRow();
      } else {
        settings.bind(
          settingsName,
          comp,
          {
            adjustment: 'value',
            switch: 'active',
            textbuffer: 'text',
            buffer: 'text',
          }[component],
          Gio.SettingsBindFlags.DEFAULT
        );
      }

      if (
        ['show_wake_slider_switch', 'show_wake_absolute_timer_switch'].includes(
          compId
        )
      )
        switchDependsOnSetting(comp, settings, 'show-wake-items-value');
    }
  }

  return page;
}

function switchDependsOnSetting(comp, settings, settingsName) {
  const update = () => {
    const active = settings.get_boolean(settingsName);
    comp.sensitive = active;
    const row = comp.get_parent().get_parent();
    row.sensitive = active;
  };
  const handlerId = settings.connect(`changed::${settingsName}`, () =>
    update()
  );
  comp.connect('destroy', () => settings.disconnect(handlerId));
  update();
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
  window.connect('destroy', () => {
    disableGuiIdle();
    handlers.forEach(([comp, handlerId]) => {
      comp.disconnect(handlerId);
    });
    Install.reset();
  });
}
