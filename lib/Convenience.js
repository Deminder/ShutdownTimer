/*
  AUTHOR: Deminder
*/

const Config = imports.misc.config;
const [major, minor] = Config.PACKAGE_VERSION.split(".");

let debugMode = false;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}

if (major < 3 || minor < 38) {
  String.prototype.replaceAll = function (searchValue, replaceValue) {
    if (typeof searchValue != "string") {
      throw new Error("Not implemented! searchValue must be string");
    }
    if (typeof replaceValue != "string") {
      throw new Error("Not implemented! replaceValue must be string");
    }
    if (this) {
      const pos = String.prototype.indexOf.call(this, searchValue);
      if (pos > -1) {
        return (
          String.prototype.substring.call(this, 0, pos) +
          replaceValue +
          String.prototype.substring
            .call(this, pos + replaceValue.length)
            .replaceAll(searchValue, replaceValue)
        );
      }
    }
    return this;
  };
}
