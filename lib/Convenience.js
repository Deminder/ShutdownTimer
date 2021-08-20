/*
  AUTHOR: Deminder
*/
/* exported logDebug, proxyPromise */

const Config = imports.misc.config;
const shellVersion = parseFloat(Config.PACKAGE_VERSION);

let debugMode = false;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}

function proxyPromise(ProxyType, session, dest, objectPath) {
  return new Promise((resolve, reject) => {
    new ProxyType(session, dest, objectPath, (proxy, error) => {
      if (error) {
        reject(error);
      } else {
        resolve(proxy);
      }
    });
  });
}

if (shellVersion <= 3.36) {
  String.prototype.replaceAll = function (searchValue, replaceValue) {
    if (typeof searchValue !== 'string') {
      throw new Error('Not implemented! searchValue must be string');
    }
    if (typeof replaceValue !== 'string') {
      throw new Error('Not implemented! replaceValue must be string');
    }
    if (this) {
      const pos = String.prototype.indexOf.call(this, searchValue);
      if (pos > -1) {
        return (
          String.prototype.substring.call(this, 0, pos) +
          replaceValue +
          String.prototype.substring
            .call(this, pos + searchValue.length)
            .replaceAll(searchValue, replaceValue)
        );
      }
    }
    return this;
  };
}
