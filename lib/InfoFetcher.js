/**
    AUTHOR: Deminder
**/
const Me = imports.misc.extensionUtils.getCurrentExtension();
const logDebug = Me.imports.lib.Convenience.logDebug;

async function readFile(path) {
  return new Promise((resolve, reject) => {
    try {
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (file, res) => {
        try {
          const [, contents] = file.load_contents_finish(res);
          resolve(ByteArray.toString(contents));
          GLib.free(contents);
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function wakeInfo(rtc) {
  return readFile(`/sys/class/rtc/${rtc}/wakealarm`)
    .catch(() => "")
    .then((content) => {
      return { deadline: content !== "" ? parseInt(content) : -1 };
    });
}

async function shutdownInfo() {
  return readFile("/run/systemd/shutdown/scheduled")
    .then((content) => {
      const [usec, _warn, mode] = content
        .split("\n")
        .map((l) => l.split("=")[1]);
      resolve({
        mode,
        deadline: parseInt(usec) / 1000000,
      });
    })
    .catch(() => {
      return { deadline: -1 };
    });
}

var InfoFetcher = class {
  constructor() {
    this._rtc = "rtc0";
    this._infoCallback = () => {};
  }

  startScheduleInfoLoop(infoCallback) {
    this._infoCallback = infoCallback;
    this.updateScheduleInfo();
  }

  _updateInfoLoop() {
    this._infoTimerId = new Promise((resolve, _) => {
      Promise.all([shutdownInfo(), wakeInfo(this._rtc)]).then(
        ([info, wakeInfo]) => {
          this._infoCallback(info, wakeInfo);
          const nextTimerId = GLib.timeout_add_seconds(
            GLib.LOW_PRIORITY,
            5,
            () => {
              this._updateInfoLoop();
              return GLib.SOURCE_REMOVE;
            }
          );
          resolve(nextTimerId);
        }
      );
    });
  }

  async stopScheduleInfoLoop(clean = true) {
    if (clean) {
      this._infoCallback = () => {};
    }

    if (this._infoTimerId !== null) {
      GLib.Source.remove(await this._infoTimerId);
    }
    this._infoTimerId = null;
  }

  async updateScheduleInfo() {
    await this.stopScheduleInfoLoop(false);
    // restart loop
    return this._updateInfoLoop();
  }
};
