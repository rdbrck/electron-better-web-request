'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = match;

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _startsWith = require('lodash/startsWith');

var _startsWith2 = _interopRequireDefault(_startsWith);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var ALL_SCHEMES = {};

function getParts(pattern) {
  if (pattern === '<all_urls>') {
    return {
      scheme: ALL_SCHEMES,
      host: '*',
      path: '*'
    };
  }

  var matchScheme = '(\\*|ws|wss|http|https|file|ftp)';
  var matchHost = '(\\*|(?:\\*\\.)?(?:[^/*]+))?';
  var matchPath = '(.*)?';
  var regex = new RegExp('^' + matchScheme + '://' + matchHost + '(/)' + matchPath + '$');

  var result = regex.exec(pattern);
  (0, _assert2.default)(result, 'Invalid pattern');

  return {
    scheme: result[1],
    host: result[2],
    path: result[4]
  };
}

function createMatcher(pattern) {
  var parts = getParts(pattern);
  var str = '^';

  // check scheme
  if (parts.scheme === ALL_SCHEMES) {
    str += '(ws|wss|http|https|ftp|file)';
  } else if (parts.scheme === '*') {
    // XXX
    str += '(http|https)';
  } else {
    str += parts.scheme;
  }

  str += '://';

  // check host
  if (parts.host === '*') {
    str += '.*';
  } else if ((0, _startsWith2.default)(parts.host, '*.')) {
    str += '.*';
    str += '\\.?';
    str += parts.host.substr(2).replace(/\./g, '\\.');
  } else if (parts.host) {
    str += parts.host;
  }

  // check path
  if (!parts.path) {
    str += '/?';
  } else if (parts.path) {
    str += '/';
    str += parts.path.replace(/[?.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  }

  str += '$';

  var regex = new RegExp(str);
  return function matchUrl(url) {
    return regex.test(url);
  };
}

function match(pattern, optionalUrl) {
  var matcher = createMatcher(pattern);

  if (arguments.length === 2) {
    return matcher(optionalUrl);
  }

  return matcher;
}
