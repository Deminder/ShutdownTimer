const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { Gio } = imports.gi;
const { proxyPromise, logDebug } = Convenience;

let screenSaver;

const ScreenSaverInf =
  '<node>\
  <interface name="org.gnome.ScreenSaver">\
    <method name="GetActive"> \
      <arg type="b" name="active" direction="out">\
      </arg>\
    </method>\
    <signal name="ActiveChanged">\
      <arg name="new_value" type="b">\
      </arg>\
    </signal>\
  </interface>\
</node>';
const ScreenSaverProxy = Gio.DBusProxy.makeProxyWrapper(ScreenSaverInf);

function screenSaverGetActive() {
  return new Promise((resolve, reject) => {
    if (screenSaver != null) {
      screenSaver.then((proxy) => {
        proxy.GetActiveRemote(([active], error) => {
          if (error) {
            reject(error);
          } else {
            resolve(active);
          }
        });
      });
    } else {
      reject(new Error("ScreenSaver proxy not loaded!"));
    }
  });
}

function screenSaverTurnsActive(durationSeconds, sleepCancel) {
  return new Promise((resolve, reject) => {
    if (screenSaver != null) {
      screenSaver.then((proxy) => {
        let done = false;
        const changeSignalId = proxy.connectSignal(
          "ActiveChanged",
          (proxy, _sender, [active]) => {
            if (active && !done) {
              done = true;
              proxy.disconnectSignal(changeSignalId);
              resolve(true);
            }
          }
        );
        RootMode.execCheck(
          ["sleep", `${durationSeconds}`],
          sleepCancel
        ).finally(() => {
          if (!done) {
            done = true;
            proxy.disconnectSignal(changeSignalId);
            resolve(false);
          }
        });
      });
    } else {
      reject(new Error("ScreenSaver proxy not loaded!"));
    }
  });
}

function load() {
  if (screenSaver == null) {
    screenSaver = proxyPromise(
      ScreenSaverProxy,
      Gio.DBus.session,
      "org.gnome.ScreenSaver",
      "/org/gnome/ScreenSaver"
    );
  }
}

function unload() {
  screenSaver = undefined;
}
