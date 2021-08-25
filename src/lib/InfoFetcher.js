/**
 * InfoFetcher module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported InfoFetcher */

const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;

function readFile(path) {
  return new Promise((resolve, reject) => {
    try {
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (f, res) => {
        try {
          const [, contents] = f.load_contents_finish(res);
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

async function isWakeInfoLocal() {
  const content = await readFile('/etc/adjtime').catch(() => '');
  return content.trim().toLowerCase().endsWith('local');
}

async function wakeInfo(rtc) {
  const content = await readFile(`/sys/class/rtc/${rtc}/wakealarm`).catch(
    () => ''
  );
  let timestamp = content !== '' ? parseInt(content) : -1;
  if (timestamp > -1) {
    const dt = GLib.DateTime.new_from_unix_local(timestamp);
    const isLocal = await isWakeInfoLocal();
    timestamp = isLocal
      ? dt.to_unix() - dt.get_utc_offset() / 1000000
      : timestamp;
  }
  return { deadline: timestamp };
}

async function shutdownInfo() {
  try {
    const content = await readFile('/run/systemd/shutdown/scheduled');
    // content: schedule unix-timestamp (micro-seconds), warn-all, shutdown-mode
    const [usec, _, mode] = content.split('\n').map(l => l.split('=')[1]);
    return {
      mode,
      deadline: parseInt(usec) / 1000000,
    };
  } catch {
    return { deadline: -1 };
  }
}

var InfoFetcher = class {
  constructor() {
    this._infoTimerId = null;
    this._rtc = 'rtc0';
    this._infoCallback = () => {};
  }

  startScheduleInfoLoop(infoCallback) {
    this._infoCallback = infoCallback;
    return this.updateScheduleInfo();
  }

  _updateInfoLoop() {
    this._infoTimerId = new Promise((resolve, _) => {
      Promise.all([shutdownInfo(), wakeInfo(this._rtc)]).then(
        ([schedule, wake]) => {
          this._infoCallback(schedule, wake);
          const nextTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_LOW,
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
