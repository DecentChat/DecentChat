#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../node_modules/.bun/peerjs-js-binarypack@2.1.0/node_modules/peerjs-js-binarypack/dist/binarypack.cjs
var require_binarypack = __commonJS((exports, module) => {
  function $parcel$export(e, n, v, s) {
    Object.defineProperty(e, n, { get: v, set: s, enumerable: true, configurable: true });
  }
  $parcel$export(exports, "unpack", () => $305e16fc3067229c$export$417857010dc9287f);
  $parcel$export(exports, "pack", () => $305e16fc3067229c$export$2a703dbb0cb35339);
  $parcel$export(exports, "Packer", () => $305e16fc3067229c$export$b9ec4b114aa40074);

  class $df5e3223d81bc678$export$93654d4f2d6cd524 {
    constructor() {
      this.encoder = new TextEncoder;
      this._pieces = [];
      this._parts = [];
    }
    append_buffer(data) {
      this.flush();
      this._parts.push(data);
    }
    append(data) {
      this._pieces.push(data);
    }
    flush() {
      if (this._pieces.length > 0) {
        const buf = new Uint8Array(this._pieces);
        this._parts.push(buf);
        this._pieces = [];
      }
    }
    toArrayBuffer() {
      const buffer = [];
      for (const part of this._parts)
        buffer.push(part);
      return $df5e3223d81bc678$var$concatArrayBuffers(buffer).buffer;
    }
  }
  function $df5e3223d81bc678$var$concatArrayBuffers(bufs) {
    let size = 0;
    for (const buf of bufs)
      size += buf.byteLength;
    const result = new Uint8Array(size);
    let offset = 0;
    for (const buf of bufs) {
      const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      result.set(view, offset);
      offset += buf.byteLength;
    }
    return result;
  }
  function $305e16fc3067229c$export$417857010dc9287f(data) {
    const unpacker = new $305e16fc3067229c$var$Unpacker(data);
    return unpacker.unpack();
  }
  function $305e16fc3067229c$export$2a703dbb0cb35339(data) {
    const packer = new $305e16fc3067229c$export$b9ec4b114aa40074;
    const res = packer.pack(data);
    if (res instanceof Promise)
      return res.then(() => packer.getBuffer());
    return packer.getBuffer();
  }

  class $305e16fc3067229c$var$Unpacker {
    constructor(data) {
      this.index = 0;
      this.dataBuffer = data;
      this.dataView = new Uint8Array(this.dataBuffer);
      this.length = this.dataBuffer.byteLength;
    }
    unpack() {
      const type = this.unpack_uint8();
      if (type < 128)
        return type;
      else if ((type ^ 224) < 32)
        return (type ^ 224) - 32;
      let size;
      if ((size = type ^ 160) <= 15)
        return this.unpack_raw(size);
      else if ((size = type ^ 176) <= 15)
        return this.unpack_string(size);
      else if ((size = type ^ 144) <= 15)
        return this.unpack_array(size);
      else if ((size = type ^ 128) <= 15)
        return this.unpack_map(size);
      switch (type) {
        case 192:
          return null;
        case 193:
          return;
        case 194:
          return false;
        case 195:
          return true;
        case 202:
          return this.unpack_float();
        case 203:
          return this.unpack_double();
        case 204:
          return this.unpack_uint8();
        case 205:
          return this.unpack_uint16();
        case 206:
          return this.unpack_uint32();
        case 207:
          return this.unpack_uint64();
        case 208:
          return this.unpack_int8();
        case 209:
          return this.unpack_int16();
        case 210:
          return this.unpack_int32();
        case 211:
          return this.unpack_int64();
        case 212:
          return;
        case 213:
          return;
        case 214:
          return;
        case 215:
          return;
        case 216:
          size = this.unpack_uint16();
          return this.unpack_string(size);
        case 217:
          size = this.unpack_uint32();
          return this.unpack_string(size);
        case 218:
          size = this.unpack_uint16();
          return this.unpack_raw(size);
        case 219:
          size = this.unpack_uint32();
          return this.unpack_raw(size);
        case 220:
          size = this.unpack_uint16();
          return this.unpack_array(size);
        case 221:
          size = this.unpack_uint32();
          return this.unpack_array(size);
        case 222:
          size = this.unpack_uint16();
          return this.unpack_map(size);
        case 223:
          size = this.unpack_uint32();
          return this.unpack_map(size);
      }
    }
    unpack_uint8() {
      const byte = this.dataView[this.index] & 255;
      this.index++;
      return byte;
    }
    unpack_uint16() {
      const bytes = this.read(2);
      const uint16 = (bytes[0] & 255) * 256 + (bytes[1] & 255);
      this.index += 2;
      return uint16;
    }
    unpack_uint32() {
      const bytes = this.read(4);
      const uint32 = ((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3];
      this.index += 4;
      return uint32;
    }
    unpack_uint64() {
      const bytes = this.read(8);
      const uint64 = ((((((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) * 256 + bytes[4]) * 256 + bytes[5]) * 256 + bytes[6]) * 256 + bytes[7];
      this.index += 8;
      return uint64;
    }
    unpack_int8() {
      const uint8 = this.unpack_uint8();
      return uint8 < 128 ? uint8 : uint8 - 256;
    }
    unpack_int16() {
      const uint16 = this.unpack_uint16();
      return uint16 < 32768 ? uint16 : uint16 - 65536;
    }
    unpack_int32() {
      const uint32 = this.unpack_uint32();
      return uint32 < 2 ** 31 ? uint32 : uint32 - 2 ** 32;
    }
    unpack_int64() {
      const uint64 = this.unpack_uint64();
      return uint64 < 2 ** 63 ? uint64 : uint64 - 2 ** 64;
    }
    unpack_raw(size) {
      if (this.length < this.index + size)
        throw new Error(`BinaryPackFailure: index is out of range ${this.index} ${size} ${this.length}`);
      const buf = this.dataBuffer.slice(this.index, this.index + size);
      this.index += size;
      return buf;
    }
    unpack_string(size) {
      const bytes = this.read(size);
      let i = 0;
      let str = "";
      let c;
      let code;
      while (i < size) {
        c = bytes[i];
        if (c < 160) {
          code = c;
          i++;
        } else if ((c ^ 192) < 32) {
          code = (c & 31) << 6 | bytes[i + 1] & 63;
          i += 2;
        } else if ((c ^ 224) < 16) {
          code = (c & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63;
          i += 3;
        } else {
          code = (c & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63;
          i += 4;
        }
        str += String.fromCodePoint(code);
      }
      this.index += size;
      return str;
    }
    unpack_array(size) {
      const objects = new Array(size);
      for (let i = 0;i < size; i++)
        objects[i] = this.unpack();
      return objects;
    }
    unpack_map(size) {
      const map = {};
      for (let i = 0;i < size; i++) {
        const key = this.unpack();
        map[key] = this.unpack();
      }
      return map;
    }
    unpack_float() {
      const uint32 = this.unpack_uint32();
      const sign = uint32 >> 31;
      const exp = (uint32 >> 23 & 255) - 127;
      const fraction = uint32 & 8388607 | 8388608;
      return (sign === 0 ? 1 : -1) * fraction * 2 ** (exp - 23);
    }
    unpack_double() {
      const h32 = this.unpack_uint32();
      const l32 = this.unpack_uint32();
      const sign = h32 >> 31;
      const exp = (h32 >> 20 & 2047) - 1023;
      const hfrac = h32 & 1048575 | 1048576;
      const frac = hfrac * 2 ** (exp - 20) + l32 * 2 ** (exp - 52);
      return (sign === 0 ? 1 : -1) * frac;
    }
    read(length) {
      const j = this.index;
      if (j + length <= this.length)
        return this.dataView.subarray(j, j + length);
      else
        throw new Error("BinaryPackFailure: read index out of range");
    }
  }

  class $305e16fc3067229c$export$b9ec4b114aa40074 {
    getBuffer() {
      return this._bufferBuilder.toArrayBuffer();
    }
    pack(value) {
      if (typeof value === "string")
        this.pack_string(value);
      else if (typeof value === "number") {
        if (Math.floor(value) === value)
          this.pack_integer(value);
        else
          this.pack_double(value);
      } else if (typeof value === "boolean") {
        if (value === true)
          this._bufferBuilder.append(195);
        else if (value === false)
          this._bufferBuilder.append(194);
      } else if (value === undefined)
        this._bufferBuilder.append(192);
      else if (typeof value === "object") {
        if (value === null)
          this._bufferBuilder.append(192);
        else {
          const constructor = value.constructor;
          if (value instanceof Array) {
            const res = this.pack_array(value);
            if (res instanceof Promise)
              return res.then(() => this._bufferBuilder.flush());
          } else if (value instanceof ArrayBuffer)
            this.pack_bin(new Uint8Array(value));
          else if ("BYTES_PER_ELEMENT" in value) {
            const v = value;
            this.pack_bin(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
          } else if (value instanceof Date)
            this.pack_string(value.toString());
          else if (value instanceof Blob)
            return value.arrayBuffer().then((buffer) => {
              this.pack_bin(new Uint8Array(buffer));
              this._bufferBuilder.flush();
            });
          else if (constructor == Object || constructor.toString().startsWith("class")) {
            const res = this.pack_object(value);
            if (res instanceof Promise)
              return res.then(() => this._bufferBuilder.flush());
          } else
            throw new Error(`Type "${constructor.toString()}" not yet supported`);
        }
      } else
        throw new Error(`Type "${typeof value}" not yet supported`);
      this._bufferBuilder.flush();
    }
    pack_bin(blob) {
      const length = blob.length;
      if (length <= 15)
        this.pack_uint8(160 + length);
      else if (length <= 65535) {
        this._bufferBuilder.append(218);
        this.pack_uint16(length);
      } else if (length <= 4294967295) {
        this._bufferBuilder.append(219);
        this.pack_uint32(length);
      } else
        throw new Error("Invalid length");
      this._bufferBuilder.append_buffer(blob);
    }
    pack_string(str) {
      const encoded = this._textEncoder.encode(str);
      const length = encoded.length;
      if (length <= 15)
        this.pack_uint8(176 + length);
      else if (length <= 65535) {
        this._bufferBuilder.append(216);
        this.pack_uint16(length);
      } else if (length <= 4294967295) {
        this._bufferBuilder.append(217);
        this.pack_uint32(length);
      } else
        throw new Error("Invalid length");
      this._bufferBuilder.append_buffer(encoded);
    }
    pack_array(ary) {
      const length = ary.length;
      if (length <= 15)
        this.pack_uint8(144 + length);
      else if (length <= 65535) {
        this._bufferBuilder.append(220);
        this.pack_uint16(length);
      } else if (length <= 4294967295) {
        this._bufferBuilder.append(221);
        this.pack_uint32(length);
      } else
        throw new Error("Invalid length");
      const packNext = (index) => {
        if (index < length) {
          const res = this.pack(ary[index]);
          if (res instanceof Promise)
            return res.then(() => packNext(index + 1));
          return packNext(index + 1);
        }
      };
      return packNext(0);
    }
    pack_integer(num) {
      if (num >= -32 && num <= 127)
        this._bufferBuilder.append(num & 255);
      else if (num >= 0 && num <= 255) {
        this._bufferBuilder.append(204);
        this.pack_uint8(num);
      } else if (num >= -128 && num <= 127) {
        this._bufferBuilder.append(208);
        this.pack_int8(num);
      } else if (num >= 0 && num <= 65535) {
        this._bufferBuilder.append(205);
        this.pack_uint16(num);
      } else if (num >= -32768 && num <= 32767) {
        this._bufferBuilder.append(209);
        this.pack_int16(num);
      } else if (num >= 0 && num <= 4294967295) {
        this._bufferBuilder.append(206);
        this.pack_uint32(num);
      } else if (num >= -2147483648 && num <= 2147483647) {
        this._bufferBuilder.append(210);
        this.pack_int32(num);
      } else if (num >= -9223372036854776000 && num <= 9223372036854776000) {
        this._bufferBuilder.append(211);
        this.pack_int64(num);
      } else if (num >= 0 && num <= 18446744073709552000) {
        this._bufferBuilder.append(207);
        this.pack_uint64(num);
      } else
        throw new Error("Invalid integer");
    }
    pack_double(num) {
      let sign = 0;
      if (num < 0) {
        sign = 1;
        num = -num;
      }
      const exp = Math.floor(Math.log(num) / Math.LN2);
      const frac0 = num / 2 ** exp - 1;
      const frac1 = Math.floor(frac0 * 2 ** 52);
      const b32 = 2 ** 32;
      const h32 = sign << 31 | exp + 1023 << 20 | frac1 / b32 & 1048575;
      const l32 = frac1 % b32;
      this._bufferBuilder.append(203);
      this.pack_int32(h32);
      this.pack_int32(l32);
    }
    pack_object(obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      if (length <= 15)
        this.pack_uint8(128 + length);
      else if (length <= 65535) {
        this._bufferBuilder.append(222);
        this.pack_uint16(length);
      } else if (length <= 4294967295) {
        this._bufferBuilder.append(223);
        this.pack_uint32(length);
      } else
        throw new Error("Invalid length");
      const packNext = (index) => {
        if (index < keys.length) {
          const prop = keys[index];
          if (obj.hasOwnProperty(prop)) {
            this.pack(prop);
            const res = this.pack(obj[prop]);
            if (res instanceof Promise)
              return res.then(() => packNext(index + 1));
          }
          return packNext(index + 1);
        }
      };
      return packNext(0);
    }
    pack_uint8(num) {
      this._bufferBuilder.append(num);
    }
    pack_uint16(num) {
      this._bufferBuilder.append(num >> 8);
      this._bufferBuilder.append(num & 255);
    }
    pack_uint32(num) {
      const n = num & 4294967295;
      this._bufferBuilder.append((n & 4278190080) >>> 24);
      this._bufferBuilder.append((n & 16711680) >>> 16);
      this._bufferBuilder.append((n & 65280) >>> 8);
      this._bufferBuilder.append(n & 255);
    }
    pack_uint64(num) {
      const high = num / 2 ** 32;
      const low = num % 2 ** 32;
      this._bufferBuilder.append((high & 4278190080) >>> 24);
      this._bufferBuilder.append((high & 16711680) >>> 16);
      this._bufferBuilder.append((high & 65280) >>> 8);
      this._bufferBuilder.append(high & 255);
      this._bufferBuilder.append((low & 4278190080) >>> 24);
      this._bufferBuilder.append((low & 16711680) >>> 16);
      this._bufferBuilder.append((low & 65280) >>> 8);
      this._bufferBuilder.append(low & 255);
    }
    pack_int8(num) {
      this._bufferBuilder.append(num & 255);
    }
    pack_int16(num) {
      this._bufferBuilder.append((num & 65280) >> 8);
      this._bufferBuilder.append(num & 255);
    }
    pack_int32(num) {
      this._bufferBuilder.append(num >>> 24 & 255);
      this._bufferBuilder.append((num & 16711680) >>> 16);
      this._bufferBuilder.append((num & 65280) >>> 8);
      this._bufferBuilder.append(num & 255);
    }
    pack_int64(num) {
      const high = Math.floor(num / 2 ** 32);
      const low = num % 2 ** 32;
      this._bufferBuilder.append((high & 4278190080) >>> 24);
      this._bufferBuilder.append((high & 16711680) >>> 16);
      this._bufferBuilder.append((high & 65280) >>> 8);
      this._bufferBuilder.append(high & 255);
      this._bufferBuilder.append((low & 4278190080) >>> 24);
      this._bufferBuilder.append((low & 16711680) >>> 16);
      this._bufferBuilder.append((low & 65280) >>> 8);
      this._bufferBuilder.append(low & 255);
    }
    constructor() {
      this._bufferBuilder = new (0, $df5e3223d81bc678$export$93654d4f2d6cd524);
      this._textEncoder = new TextEncoder;
    }
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/utils.js
var require_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.compactObject = compactObject;
  exports.deprecated = deprecated;
  exports.detectBrowser = detectBrowser;
  exports.disableLog = disableLog;
  exports.disableWarnings = disableWarnings;
  exports.extractVersion = extractVersion;
  exports.filterStats = filterStats;
  exports.log = log;
  exports.walkStats = walkStats;
  exports.wrapPeerConnectionEvent = wrapPeerConnectionEvent;
  function _defineProperty(e, r, t) {
    return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  var logDisabled_ = true;
  var deprecationWarnings_ = true;
  function extractVersion(uastring, expr, pos) {
    var match = uastring.match(expr);
    return match && match.length >= pos && parseFloat(match[pos], 10);
  }
  function wrapPeerConnectionEvent(window2, eventNameToWrap, wrapper) {
    if (!window2.RTCPeerConnection) {
      return;
    }
    var proto = window2.RTCPeerConnection.prototype;
    var nativeAddEventListener = proto.addEventListener;
    proto.addEventListener = function(nativeEventName, cb) {
      if (nativeEventName !== eventNameToWrap) {
        return nativeAddEventListener.apply(this, arguments);
      }
      var wrappedCallback = function wrappedCallback2(e) {
        var modifiedEvent = wrapper(e);
        if (modifiedEvent) {
          if (cb.handleEvent) {
            cb.handleEvent(modifiedEvent);
          } else {
            cb(modifiedEvent);
          }
        }
      };
      this._eventMap = this._eventMap || {};
      if (!this._eventMap[eventNameToWrap]) {
        this._eventMap[eventNameToWrap] = new Map;
      }
      this._eventMap[eventNameToWrap].set(cb, wrappedCallback);
      return nativeAddEventListener.apply(this, [nativeEventName, wrappedCallback]);
    };
    var nativeRemoveEventListener = proto.removeEventListener;
    proto.removeEventListener = function(nativeEventName, cb) {
      if (nativeEventName !== eventNameToWrap || !this._eventMap || !this._eventMap[eventNameToWrap]) {
        return nativeRemoveEventListener.apply(this, arguments);
      }
      if (!this._eventMap[eventNameToWrap].has(cb)) {
        return nativeRemoveEventListener.apply(this, arguments);
      }
      var unwrappedCb = this._eventMap[eventNameToWrap].get(cb);
      this._eventMap[eventNameToWrap]["delete"](cb);
      if (this._eventMap[eventNameToWrap].size === 0) {
        delete this._eventMap[eventNameToWrap];
      }
      if (Object.keys(this._eventMap).length === 0) {
        delete this._eventMap;
      }
      return nativeRemoveEventListener.apply(this, [nativeEventName, unwrappedCb]);
    };
    Object.defineProperty(proto, "on" + eventNameToWrap, {
      get: function get() {
        return this["_on" + eventNameToWrap];
      },
      set: function set(cb) {
        if (this["_on" + eventNameToWrap]) {
          this.removeEventListener(eventNameToWrap, this["_on" + eventNameToWrap]);
          delete this["_on" + eventNameToWrap];
        }
        if (cb) {
          this.addEventListener(eventNameToWrap, this["_on" + eventNameToWrap] = cb);
        }
      },
      enumerable: true,
      configurable: true
    });
  }
  function disableLog(bool) {
    if (typeof bool !== "boolean") {
      return new Error("Argument type: " + _typeof(bool) + ". Please use a boolean.");
    }
    logDisabled_ = bool;
    return bool ? "adapter.js logging disabled" : "adapter.js logging enabled";
  }
  function disableWarnings(bool) {
    if (typeof bool !== "boolean") {
      return new Error("Argument type: " + _typeof(bool) + ". Please use a boolean.");
    }
    deprecationWarnings_ = !bool;
    return "adapter.js deprecation warnings " + (bool ? "disabled" : "enabled");
  }
  function log() {
    if ((typeof window === "undefined" ? "undefined" : _typeof(window)) === "object") {
      if (logDisabled_) {
        return;
      }
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log.apply(console, arguments);
      }
    }
  }
  function deprecated(oldMethod, newMethod) {
    if (!deprecationWarnings_) {
      return;
    }
    console.warn(oldMethod + " is deprecated, please use " + newMethod + " instead.");
  }
  function detectBrowser(window2) {
    var result = {
      browser: null,
      version: null
    };
    if (typeof window2 === "undefined" || !window2.navigator || !window2.navigator.userAgent) {
      result.browser = "Not a browser.";
      return result;
    }
    var navigator2 = window2.navigator;
    if (navigator2.userAgentData && navigator2.userAgentData.brands) {
      var chromium = navigator2.userAgentData.brands.find(function(brand) {
        return brand.brand === "Chromium";
      });
      if (chromium) {
        return {
          browser: "chrome",
          version: parseInt(chromium.version, 10)
        };
      }
    }
    if (navigator2.mozGetUserMedia) {
      result.browser = "firefox";
      result.version = parseInt(extractVersion(navigator2.userAgent, /Firefox\/(\d+)\./, 1));
    } else if (navigator2.webkitGetUserMedia || window2.isSecureContext === false && window2.webkitRTCPeerConnection) {
      result.browser = "chrome";
      result.version = parseInt(extractVersion(navigator2.userAgent, /Chrom(e|ium)\/(\d+)\./, 2));
    } else if (window2.RTCPeerConnection && navigator2.userAgent.match(/AppleWebKit\/(\d+)\./)) {
      result.browser = "safari";
      result.version = parseInt(extractVersion(navigator2.userAgent, /AppleWebKit\/(\d+)\./, 1));
      result.supportsUnifiedPlan = window2.RTCRtpTransceiver && "currentDirection" in window2.RTCRtpTransceiver.prototype;
      result._safariVersion = extractVersion(navigator2.userAgent, /Version\/(\d+(\.?\d+))/, 1);
    } else {
      result.browser = "Not a supported browser.";
      return result;
    }
    return result;
  }
  function isObject(val) {
    return Object.prototype.toString.call(val) === "[object Object]";
  }
  function compactObject(data) {
    if (!isObject(data)) {
      return data;
    }
    return Object.keys(data).reduce(function(accumulator, key) {
      var isObj = isObject(data[key]);
      var value = isObj ? compactObject(data[key]) : data[key];
      var isEmptyObject = isObj && !Object.keys(value).length;
      if (value === undefined || isEmptyObject) {
        return accumulator;
      }
      return Object.assign(accumulator, _defineProperty({}, key, value));
    }, {});
  }
  function walkStats(stats, base, resultSet) {
    if (!base || resultSet.has(base.id)) {
      return;
    }
    resultSet.set(base.id, base);
    Object.keys(base).forEach(function(name) {
      if (name.endsWith("Id")) {
        walkStats(stats, stats.get(base[name]), resultSet);
      } else if (name.endsWith("Ids")) {
        base[name].forEach(function(id) {
          walkStats(stats, stats.get(id), resultSet);
        });
      }
    });
  }
  function filterStats(result, track, outbound) {
    var streamStatsType = outbound ? "outbound-rtp" : "inbound-rtp";
    var filteredResult = new Map;
    if (track === null) {
      return filteredResult;
    }
    var trackStats = [];
    result.forEach(function(value) {
      if (value.type === "track" && value.trackIdentifier === track.id) {
        trackStats.push(value);
      }
    });
    trackStats.forEach(function(trackStat) {
      result.forEach(function(stats) {
        if (stats.type === streamStatsType && stats.trackId === trackStat.id) {
          walkStats(result, stats, filteredResult);
        }
      });
    });
    return filteredResult;
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/chrome/getusermedia.js
var require_getusermedia = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.shimGetUserMedia = shimGetUserMedia;
  var utils = _interopRequireWildcard(require_utils());
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  var logging = utils.log;
  function shimGetUserMedia(window2, browserDetails) {
    var navigator2 = window2 && window2.navigator;
    if (!navigator2.mediaDevices) {
      return;
    }
    var constraintsToChrome_ = function constraintsToChrome_2(c) {
      if (_typeof(c) !== "object" || c.mandatory || c.optional) {
        return c;
      }
      var cc = {};
      Object.keys(c).forEach(function(key) {
        if (key === "require" || key === "advanced" || key === "mediaSource") {
          return;
        }
        var r = _typeof(c[key]) === "object" ? c[key] : {
          ideal: c[key]
        };
        if (r.exact !== undefined && typeof r.exact === "number") {
          r.min = r.max = r.exact;
        }
        var oldname_ = function oldname_2(prefix, name) {
          if (prefix) {
            return prefix + name.charAt(0).toUpperCase() + name.slice(1);
          }
          return name === "deviceId" ? "sourceId" : name;
        };
        if (r.ideal !== undefined) {
          cc.optional = cc.optional || [];
          var oc = {};
          if (typeof r.ideal === "number") {
            oc[oldname_("min", key)] = r.ideal;
            cc.optional.push(oc);
            oc = {};
            oc[oldname_("max", key)] = r.ideal;
            cc.optional.push(oc);
          } else {
            oc[oldname_("", key)] = r.ideal;
            cc.optional.push(oc);
          }
        }
        if (r.exact !== undefined && typeof r.exact !== "number") {
          cc.mandatory = cc.mandatory || {};
          cc.mandatory[oldname_("", key)] = r.exact;
        } else {
          ["min", "max"].forEach(function(mix) {
            if (r[mix] !== undefined) {
              cc.mandatory = cc.mandatory || {};
              cc.mandatory[oldname_(mix, key)] = r[mix];
            }
          });
        }
      });
      if (c.advanced) {
        cc.optional = (cc.optional || []).concat(c.advanced);
      }
      return cc;
    };
    var shimConstraints_ = function shimConstraints_2(constraints, func) {
      if (browserDetails.version >= 61) {
        return func(constraints);
      }
      constraints = JSON.parse(JSON.stringify(constraints));
      if (constraints && _typeof(constraints.audio) === "object") {
        var remap = function remap2(obj, a, b) {
          if (a in obj && !(b in obj)) {
            obj[b] = obj[a];
            delete obj[a];
          }
        };
        constraints = JSON.parse(JSON.stringify(constraints));
        remap(constraints.audio, "autoGainControl", "googAutoGainControl");
        remap(constraints.audio, "noiseSuppression", "googNoiseSuppression");
        constraints.audio = constraintsToChrome_(constraints.audio);
      }
      if (constraints && _typeof(constraints.video) === "object") {
        var face = constraints.video.facingMode;
        face = face && (_typeof(face) === "object" ? face : {
          ideal: face
        });
        var getSupportedFacingModeLies = browserDetails.version < 66;
        if (face && (face.exact === "user" || face.exact === "environment" || face.ideal === "user" || face.ideal === "environment") && !(navigator2.mediaDevices.getSupportedConstraints && navigator2.mediaDevices.getSupportedConstraints().facingMode && !getSupportedFacingModeLies)) {
          delete constraints.video.facingMode;
          var matches;
          if (face.exact === "environment" || face.ideal === "environment") {
            matches = ["back", "rear"];
          } else if (face.exact === "user" || face.ideal === "user") {
            matches = ["front"];
          }
          if (matches) {
            return navigator2.mediaDevices.enumerateDevices().then(function(devices) {
              devices = devices.filter(function(d) {
                return d.kind === "videoinput";
              });
              var dev = devices.find(function(d) {
                return matches.some(function(match) {
                  return d.label.toLowerCase().includes(match);
                });
              });
              if (!dev && devices.length && matches.includes("back")) {
                dev = devices[devices.length - 1];
              }
              if (dev) {
                constraints.video.deviceId = face.exact ? {
                  exact: dev.deviceId
                } : {
                  ideal: dev.deviceId
                };
              }
              constraints.video = constraintsToChrome_(constraints.video);
              logging("chrome: " + JSON.stringify(constraints));
              return func(constraints);
            });
          }
        }
        constraints.video = constraintsToChrome_(constraints.video);
      }
      logging("chrome: " + JSON.stringify(constraints));
      return func(constraints);
    };
    var shimError_ = function shimError_2(e) {
      if (browserDetails.version >= 64) {
        return e;
      }
      return {
        name: {
          PermissionDeniedError: "NotAllowedError",
          PermissionDismissedError: "NotAllowedError",
          InvalidStateError: "NotAllowedError",
          DevicesNotFoundError: "NotFoundError",
          ConstraintNotSatisfiedError: "OverconstrainedError",
          TrackStartError: "NotReadableError",
          MediaDeviceFailedDueToShutdown: "NotAllowedError",
          MediaDeviceKillSwitchOn: "NotAllowedError",
          TabCaptureError: "AbortError",
          ScreenCaptureError: "AbortError",
          DeviceCaptureError: "AbortError"
        }[e.name] || e.name,
        message: e.message,
        constraint: e.constraint || e.constraintName,
        toString: function toString() {
          return this.name + (this.message && ": ") + this.message;
        }
      };
    };
    var getUserMedia_ = function getUserMedia_2(constraints, onSuccess, onError) {
      shimConstraints_(constraints, function(c) {
        navigator2.webkitGetUserMedia(c, onSuccess, function(e) {
          if (onError) {
            onError(shimError_(e));
          }
        });
      });
    };
    navigator2.getUserMedia = getUserMedia_.bind(navigator2);
    if (navigator2.mediaDevices.getUserMedia) {
      var origGetUserMedia = navigator2.mediaDevices.getUserMedia.bind(navigator2.mediaDevices);
      navigator2.mediaDevices.getUserMedia = function(cs) {
        return shimConstraints_(cs, function(c) {
          return origGetUserMedia(c).then(function(stream) {
            if (c.audio && !stream.getAudioTracks().length || c.video && !stream.getVideoTracks().length) {
              stream.getTracks().forEach(function(track) {
                track.stop();
              });
              throw new DOMException("", "NotFoundError");
            }
            return stream;
          }, function(e) {
            return Promise.reject(shimError_(e));
          });
        });
      };
    }
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/chrome/chrome_shim.js
var require_chrome_shim = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.fixNegotiationNeeded = fixNegotiationNeeded;
  exports.shimAddTrackRemoveTrack = shimAddTrackRemoveTrack;
  exports.shimAddTrackRemoveTrackWithNative = shimAddTrackRemoveTrackWithNative;
  exports.shimGetSendersWithDtmf = shimGetSendersWithDtmf;
  Object.defineProperty(exports, "shimGetUserMedia", {
    enumerable: true,
    get: function get() {
      return _getusermedia.shimGetUserMedia;
    }
  });
  exports.shimMediaStream = shimMediaStream;
  exports.shimOnTrack = shimOnTrack;
  exports.shimPeerConnection = shimPeerConnection;
  exports.shimSenderReceiverGetStats = shimSenderReceiverGetStats;
  var utils = _interopRequireWildcard(require_utils());
  var _getusermedia = require_getusermedia();
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _defineProperty(e, r, t) {
    return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function shimMediaStream(window2) {
    window2.MediaStream = window2.MediaStream || window2.webkitMediaStream;
  }
  function shimOnTrack(window2) {
    if (_typeof(window2) === "object" && window2.RTCPeerConnection && !("ontrack" in window2.RTCPeerConnection.prototype)) {
      Object.defineProperty(window2.RTCPeerConnection.prototype, "ontrack", {
        get: function get() {
          return this._ontrack;
        },
        set: function set(f) {
          if (this._ontrack) {
            this.removeEventListener("track", this._ontrack);
          }
          this.addEventListener("track", this._ontrack = f);
        },
        enumerable: true,
        configurable: true
      });
      var origSetRemoteDescription = window2.RTCPeerConnection.prototype.setRemoteDescription;
      window2.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
        var _this = this;
        if (!this._ontrackpoly) {
          this._ontrackpoly = function(e) {
            e.stream.addEventListener("addtrack", function(te) {
              var receiver;
              if (window2.RTCPeerConnection.prototype.getReceivers) {
                receiver = _this.getReceivers().find(function(r) {
                  return r.track && r.track.id === te.track.id;
                });
              } else {
                receiver = {
                  track: te.track
                };
              }
              var event = new Event("track");
              event.track = te.track;
              event.receiver = receiver;
              event.transceiver = {
                receiver
              };
              event.streams = [e.stream];
              _this.dispatchEvent(event);
            });
            e.stream.getTracks().forEach(function(track) {
              var receiver;
              if (window2.RTCPeerConnection.prototype.getReceivers) {
                receiver = _this.getReceivers().find(function(r) {
                  return r.track && r.track.id === track.id;
                });
              } else {
                receiver = {
                  track
                };
              }
              var event = new Event("track");
              event.track = track;
              event.receiver = receiver;
              event.transceiver = {
                receiver
              };
              event.streams = [e.stream];
              _this.dispatchEvent(event);
            });
          };
          this.addEventListener("addstream", this._ontrackpoly);
        }
        return origSetRemoteDescription.apply(this, arguments);
      };
    } else {
      utils.wrapPeerConnectionEvent(window2, "track", function(e) {
        if (!e.transceiver) {
          Object.defineProperty(e, "transceiver", {
            value: {
              receiver: e.receiver
            }
          });
        }
        return e;
      });
    }
  }
  function shimGetSendersWithDtmf(window2) {
    if (_typeof(window2) === "object" && window2.RTCPeerConnection && !("getSenders" in window2.RTCPeerConnection.prototype) && "createDTMFSender" in window2.RTCPeerConnection.prototype) {
      var shimSenderWithDtmf = function shimSenderWithDtmf2(pc, track) {
        return {
          track,
          get dtmf() {
            if (this._dtmf === undefined) {
              if (track.kind === "audio") {
                this._dtmf = pc.createDTMFSender(track);
              } else {
                this._dtmf = null;
              }
            }
            return this._dtmf;
          },
          _pc: pc
        };
      };
      if (!window2.RTCPeerConnection.prototype.getSenders) {
        window2.RTCPeerConnection.prototype.getSenders = function getSenders() {
          this._senders = this._senders || [];
          return this._senders.slice();
        };
        var origAddTrack = window2.RTCPeerConnection.prototype.addTrack;
        window2.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
          var sender = origAddTrack.apply(this, arguments);
          if (!sender) {
            sender = shimSenderWithDtmf(this, track);
            this._senders.push(sender);
          }
          return sender;
        };
        var origRemoveTrack = window2.RTCPeerConnection.prototype.removeTrack;
        window2.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
          origRemoveTrack.apply(this, arguments);
          var idx = this._senders.indexOf(sender);
          if (idx !== -1) {
            this._senders.splice(idx, 1);
          }
        };
      }
      var origAddStream = window2.RTCPeerConnection.prototype.addStream;
      window2.RTCPeerConnection.prototype.addStream = function addStream(stream) {
        var _this2 = this;
        this._senders = this._senders || [];
        origAddStream.apply(this, [stream]);
        stream.getTracks().forEach(function(track) {
          _this2._senders.push(shimSenderWithDtmf(_this2, track));
        });
      };
      var origRemoveStream = window2.RTCPeerConnection.prototype.removeStream;
      window2.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
        var _this3 = this;
        this._senders = this._senders || [];
        origRemoveStream.apply(this, [stream]);
        stream.getTracks().forEach(function(track) {
          var sender = _this3._senders.find(function(s) {
            return s.track === track;
          });
          if (sender) {
            _this3._senders.splice(_this3._senders.indexOf(sender), 1);
          }
        });
      };
    } else if (_typeof(window2) === "object" && window2.RTCPeerConnection && "getSenders" in window2.RTCPeerConnection.prototype && "createDTMFSender" in window2.RTCPeerConnection.prototype && window2.RTCRtpSender && !("dtmf" in window2.RTCRtpSender.prototype)) {
      var origGetSenders = window2.RTCPeerConnection.prototype.getSenders;
      window2.RTCPeerConnection.prototype.getSenders = function getSenders() {
        var _this4 = this;
        var senders = origGetSenders.apply(this, []);
        senders.forEach(function(sender) {
          return sender._pc = _this4;
        });
        return senders;
      };
      Object.defineProperty(window2.RTCRtpSender.prototype, "dtmf", {
        get: function get() {
          if (this._dtmf === undefined) {
            if (this.track.kind === "audio") {
              this._dtmf = this._pc.createDTMFSender(this.track);
            } else {
              this._dtmf = null;
            }
          }
          return this._dtmf;
        }
      });
    }
  }
  function shimSenderReceiverGetStats(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection && window2.RTCRtpSender && window2.RTCRtpReceiver)) {
      return;
    }
    if (!("getStats" in window2.RTCRtpSender.prototype)) {
      var origGetSenders = window2.RTCPeerConnection.prototype.getSenders;
      if (origGetSenders) {
        window2.RTCPeerConnection.prototype.getSenders = function getSenders() {
          var _this5 = this;
          var senders = origGetSenders.apply(this, []);
          senders.forEach(function(sender) {
            return sender._pc = _this5;
          });
          return senders;
        };
      }
      var origAddTrack = window2.RTCPeerConnection.prototype.addTrack;
      if (origAddTrack) {
        window2.RTCPeerConnection.prototype.addTrack = function addTrack() {
          var sender = origAddTrack.apply(this, arguments);
          sender._pc = this;
          return sender;
        };
      }
      window2.RTCRtpSender.prototype.getStats = function getStats() {
        var sender = this;
        return this._pc.getStats().then(function(result) {
          return utils.filterStats(result, sender.track, true);
        });
      };
    }
    if (!("getStats" in window2.RTCRtpReceiver.prototype)) {
      var origGetReceivers = window2.RTCPeerConnection.prototype.getReceivers;
      if (origGetReceivers) {
        window2.RTCPeerConnection.prototype.getReceivers = function getReceivers() {
          var _this6 = this;
          var receivers = origGetReceivers.apply(this, []);
          receivers.forEach(function(receiver) {
            return receiver._pc = _this6;
          });
          return receivers;
        };
      }
      utils.wrapPeerConnectionEvent(window2, "track", function(e) {
        e.receiver._pc = e.srcElement;
        return e;
      });
      window2.RTCRtpReceiver.prototype.getStats = function getStats() {
        var receiver = this;
        return this._pc.getStats().then(function(result) {
          return utils.filterStats(result, receiver.track, false);
        });
      };
    }
    if (!(("getStats" in window2.RTCRtpSender.prototype) && ("getStats" in window2.RTCRtpReceiver.prototype))) {
      return;
    }
    var origGetStats = window2.RTCPeerConnection.prototype.getStats;
    window2.RTCPeerConnection.prototype.getStats = function getStats() {
      if (arguments.length > 0 && arguments[0] instanceof window2.MediaStreamTrack) {
        var track = arguments[0];
        var sender;
        var receiver;
        var err;
        this.getSenders().forEach(function(s) {
          if (s.track === track) {
            if (sender) {
              err = true;
            } else {
              sender = s;
            }
          }
        });
        this.getReceivers().forEach(function(r) {
          if (r.track === track) {
            if (receiver) {
              err = true;
            } else {
              receiver = r;
            }
          }
          return r.track === track;
        });
        if (err || sender && receiver) {
          return Promise.reject(new DOMException("There are more than one sender or receiver for the track.", "InvalidAccessError"));
        } else if (sender) {
          return sender.getStats();
        } else if (receiver) {
          return receiver.getStats();
        }
        return Promise.reject(new DOMException("There is no sender or receiver for the track.", "InvalidAccessError"));
      }
      return origGetStats.apply(this, arguments);
    };
  }
  function shimAddTrackRemoveTrackWithNative(window2) {
    window2.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
      var _this7 = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      return Object.keys(this._shimmedLocalStreams).map(function(streamId) {
        return _this7._shimmedLocalStreams[streamId][0];
      });
    };
    var origAddTrack = window2.RTCPeerConnection.prototype.addTrack;
    window2.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
      if (!stream) {
        return origAddTrack.apply(this, arguments);
      }
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      var sender = origAddTrack.apply(this, arguments);
      if (!this._shimmedLocalStreams[stream.id]) {
        this._shimmedLocalStreams[stream.id] = [stream, sender];
      } else if (this._shimmedLocalStreams[stream.id].indexOf(sender) === -1) {
        this._shimmedLocalStreams[stream.id].push(sender);
      }
      return sender;
    };
    var origAddStream = window2.RTCPeerConnection.prototype.addStream;
    window2.RTCPeerConnection.prototype.addStream = function addStream(stream) {
      var _this8 = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      stream.getTracks().forEach(function(track) {
        var alreadyExists = _this8.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException("Track already exists.", "InvalidAccessError");
        }
      });
      var existingSenders = this.getSenders();
      origAddStream.apply(this, arguments);
      var newSenders = this.getSenders().filter(function(newSender) {
        return existingSenders.indexOf(newSender) === -1;
      });
      this._shimmedLocalStreams[stream.id] = [stream].concat(newSenders);
    };
    var origRemoveStream = window2.RTCPeerConnection.prototype.removeStream;
    window2.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      delete this._shimmedLocalStreams[stream.id];
      return origRemoveStream.apply(this, arguments);
    };
    var origRemoveTrack = window2.RTCPeerConnection.prototype.removeTrack;
    window2.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
      var _this9 = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      if (sender) {
        Object.keys(this._shimmedLocalStreams).forEach(function(streamId) {
          var idx = _this9._shimmedLocalStreams[streamId].indexOf(sender);
          if (idx !== -1) {
            _this9._shimmedLocalStreams[streamId].splice(idx, 1);
          }
          if (_this9._shimmedLocalStreams[streamId].length === 1) {
            delete _this9._shimmedLocalStreams[streamId];
          }
        });
      }
      return origRemoveTrack.apply(this, arguments);
    };
  }
  function shimAddTrackRemoveTrack(window2, browserDetails) {
    if (!window2.RTCPeerConnection) {
      return;
    }
    if (window2.RTCPeerConnection.prototype.addTrack && browserDetails.version >= 65) {
      return shimAddTrackRemoveTrackWithNative(window2);
    }
    var origGetLocalStreams = window2.RTCPeerConnection.prototype.getLocalStreams;
    window2.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
      var _this10 = this;
      var nativeStreams = origGetLocalStreams.apply(this);
      this._reverseStreams = this._reverseStreams || {};
      return nativeStreams.map(function(stream) {
        return _this10._reverseStreams[stream.id];
      });
    };
    var origAddStream = window2.RTCPeerConnection.prototype.addStream;
    window2.RTCPeerConnection.prototype.addStream = function addStream(stream) {
      var _this11 = this;
      this._streams = this._streams || {};
      this._reverseStreams = this._reverseStreams || {};
      stream.getTracks().forEach(function(track) {
        var alreadyExists = _this11.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException("Track already exists.", "InvalidAccessError");
        }
      });
      if (!this._reverseStreams[stream.id]) {
        var newStream = new window2.MediaStream(stream.getTracks());
        this._streams[stream.id] = newStream;
        this._reverseStreams[newStream.id] = stream;
        stream = newStream;
      }
      origAddStream.apply(this, [stream]);
    };
    var origRemoveStream = window2.RTCPeerConnection.prototype.removeStream;
    window2.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
      this._streams = this._streams || {};
      this._reverseStreams = this._reverseStreams || {};
      origRemoveStream.apply(this, [this._streams[stream.id] || stream]);
      delete this._reverseStreams[this._streams[stream.id] ? this._streams[stream.id].id : stream.id];
      delete this._streams[stream.id];
    };
    window2.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
      var _this12 = this;
      if (this.signalingState === "closed") {
        throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.", "InvalidStateError");
      }
      var streams = [].slice.call(arguments, 1);
      if (streams.length !== 1 || !streams[0].getTracks().find(function(t) {
        return t === track;
      })) {
        throw new DOMException("The adapter.js addTrack polyfill only supports a single " + " stream which is associated with the specified track.", "NotSupportedError");
      }
      var alreadyExists = this.getSenders().find(function(s) {
        return s.track === track;
      });
      if (alreadyExists) {
        throw new DOMException("Track already exists.", "InvalidAccessError");
      }
      this._streams = this._streams || {};
      this._reverseStreams = this._reverseStreams || {};
      var oldStream = this._streams[stream.id];
      if (oldStream) {
        oldStream.addTrack(track);
        Promise.resolve().then(function() {
          _this12.dispatchEvent(new Event("negotiationneeded"));
        });
      } else {
        var newStream = new window2.MediaStream([track]);
        this._streams[stream.id] = newStream;
        this._reverseStreams[newStream.id] = stream;
        this.addStream(newStream);
      }
      return this.getSenders().find(function(s) {
        return s.track === track;
      });
    };
    function replaceInternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(internalStream.id, "g"), externalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp
      });
    }
    function replaceExternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(externalStream.id, "g"), internalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp
      });
    }
    ["createOffer", "createAnswer"].forEach(function(method) {
      var nativeMethod = window2.RTCPeerConnection.prototype[method];
      var methodObj = _defineProperty({}, method, function() {
        var _this13 = this;
        var args = arguments;
        var isLegacyCall = arguments.length && typeof arguments[0] === "function";
        if (isLegacyCall) {
          return nativeMethod.apply(this, [function(description) {
            var desc = replaceInternalStreamId(_this13, description);
            args[0].apply(null, [desc]);
          }, function(err) {
            if (args[1]) {
              args[1].apply(null, err);
            }
          }, arguments[2]]);
        }
        return nativeMethod.apply(this, arguments).then(function(description) {
          return replaceInternalStreamId(_this13, description);
        });
      });
      window2.RTCPeerConnection.prototype[method] = methodObj[method];
    });
    var origSetLocalDescription = window2.RTCPeerConnection.prototype.setLocalDescription;
    window2.RTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
      if (!arguments.length || !arguments[0].type) {
        return origSetLocalDescription.apply(this, arguments);
      }
      arguments[0] = replaceExternalStreamId(this, arguments[0]);
      return origSetLocalDescription.apply(this, arguments);
    };
    var origLocalDescription = Object.getOwnPropertyDescriptor(window2.RTCPeerConnection.prototype, "localDescription");
    Object.defineProperty(window2.RTCPeerConnection.prototype, "localDescription", {
      get: function get() {
        var description = origLocalDescription.get.apply(this);
        if (description.type === "") {
          return description;
        }
        return replaceInternalStreamId(this, description);
      }
    });
    window2.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
      var _this14 = this;
      if (this.signalingState === "closed") {
        throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.", "InvalidStateError");
      }
      if (!sender._pc) {
        throw new DOMException("Argument 1 of RTCPeerConnection.removeTrack " + "does not implement interface RTCRtpSender.", "TypeError");
      }
      var isLocal = sender._pc === this;
      if (!isLocal) {
        throw new DOMException("Sender was not created by this connection.", "InvalidAccessError");
      }
      this._streams = this._streams || {};
      var stream;
      Object.keys(this._streams).forEach(function(streamid) {
        var hasTrack = _this14._streams[streamid].getTracks().find(function(track) {
          return sender.track === track;
        });
        if (hasTrack) {
          stream = _this14._streams[streamid];
        }
      });
      if (stream) {
        if (stream.getTracks().length === 1) {
          this.removeStream(this._reverseStreams[stream.id]);
        } else {
          stream.removeTrack(sender.track);
        }
        this.dispatchEvent(new Event("negotiationneeded"));
      }
    };
  }
  function shimPeerConnection(window2, browserDetails) {
    if (!window2.RTCPeerConnection && window2.webkitRTCPeerConnection) {
      window2.RTCPeerConnection = window2.webkitRTCPeerConnection;
    }
    if (!window2.RTCPeerConnection) {
      return;
    }
    if (browserDetails.version < 53) {
      ["setLocalDescription", "setRemoteDescription", "addIceCandidate"].forEach(function(method) {
        var nativeMethod = window2.RTCPeerConnection.prototype[method];
        var methodObj = _defineProperty({}, method, function() {
          arguments[0] = new (method === "addIceCandidate" ? window2.RTCIceCandidate : window2.RTCSessionDescription)(arguments[0]);
          return nativeMethod.apply(this, arguments);
        });
        window2.RTCPeerConnection.prototype[method] = methodObj[method];
      });
    }
  }
  function fixNegotiationNeeded(window2, browserDetails) {
    utils.wrapPeerConnectionEvent(window2, "negotiationneeded", function(e) {
      var pc = e.target;
      if (browserDetails.version < 72 || pc.getConfiguration && pc.getConfiguration().sdpSemantics === "plan-b") {
        if (pc.signalingState !== "stable") {
          return;
        }
      }
      return e;
    });
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/firefox/getusermedia.js
var require_getusermedia2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.shimGetUserMedia = shimGetUserMedia;
  var utils = _interopRequireWildcard(require_utils());
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function shimGetUserMedia(window2, browserDetails) {
    var navigator2 = window2 && window2.navigator;
    var MediaStreamTrack = window2 && window2.MediaStreamTrack;
    navigator2.getUserMedia = function(constraints, onSuccess, onError) {
      utils.deprecated("navigator.getUserMedia", "navigator.mediaDevices.getUserMedia");
      navigator2.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
    };
    if (!(browserDetails.version > 55 && ("autoGainControl" in navigator2.mediaDevices.getSupportedConstraints()))) {
      var remap = function remap2(obj, a, b) {
        if (a in obj && !(b in obj)) {
          obj[b] = obj[a];
          delete obj[a];
        }
      };
      var nativeGetUserMedia = navigator2.mediaDevices.getUserMedia.bind(navigator2.mediaDevices);
      navigator2.mediaDevices.getUserMedia = function(c) {
        if (_typeof(c) === "object" && _typeof(c.audio) === "object") {
          c = JSON.parse(JSON.stringify(c));
          remap(c.audio, "autoGainControl", "mozAutoGainControl");
          remap(c.audio, "noiseSuppression", "mozNoiseSuppression");
        }
        return nativeGetUserMedia(c);
      };
      if (MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
        var nativeGetSettings = MediaStreamTrack.prototype.getSettings;
        MediaStreamTrack.prototype.getSettings = function() {
          var obj = nativeGetSettings.apply(this, arguments);
          remap(obj, "mozAutoGainControl", "autoGainControl");
          remap(obj, "mozNoiseSuppression", "noiseSuppression");
          return obj;
        };
      }
      if (MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints) {
        var nativeApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
        MediaStreamTrack.prototype.applyConstraints = function(c) {
          if (this.kind === "audio" && _typeof(c) === "object") {
            c = JSON.parse(JSON.stringify(c));
            remap(c, "autoGainControl", "mozAutoGainControl");
            remap(c, "noiseSuppression", "mozNoiseSuppression");
          }
          return nativeApplyConstraints.apply(this, [c]);
        };
      }
    }
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/firefox/getdisplaymedia.js
var require_getdisplaymedia = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.shimGetDisplayMedia = shimGetDisplayMedia;
  function shimGetDisplayMedia(window2, preferredMediaSource) {
    if (window2.navigator.mediaDevices && "getDisplayMedia" in window2.navigator.mediaDevices) {
      return;
    }
    if (!window2.navigator.mediaDevices) {
      return;
    }
    window2.navigator.mediaDevices.getDisplayMedia = function getDisplayMedia(constraints) {
      if (!(constraints && constraints.video)) {
        var err = new DOMException("getDisplayMedia without video " + "constraints is undefined");
        err.name = "NotFoundError";
        err.code = 8;
        return Promise.reject(err);
      }
      if (constraints.video === true) {
        constraints.video = {
          mediaSource: preferredMediaSource
        };
      } else {
        constraints.video.mediaSource = preferredMediaSource;
      }
      return window2.navigator.mediaDevices.getUserMedia(constraints);
    };
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/firefox/firefox_shim.js
var require_firefox_shim = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.shimAddTransceiver = shimAddTransceiver;
  exports.shimCreateAnswer = shimCreateAnswer;
  exports.shimCreateOffer = shimCreateOffer;
  Object.defineProperty(exports, "shimGetDisplayMedia", {
    enumerable: true,
    get: function get() {
      return _getdisplaymedia.shimGetDisplayMedia;
    }
  });
  exports.shimGetParameters = shimGetParameters;
  Object.defineProperty(exports, "shimGetUserMedia", {
    enumerable: true,
    get: function get() {
      return _getusermedia.shimGetUserMedia;
    }
  });
  exports.shimOnTrack = shimOnTrack;
  exports.shimPeerConnection = shimPeerConnection;
  exports.shimRTCDataChannel = shimRTCDataChannel;
  exports.shimReceiverGetStats = shimReceiverGetStats;
  exports.shimRemoveStream = shimRemoveStream;
  exports.shimSenderGetStats = shimSenderGetStats;
  var utils = _interopRequireWildcard(require_utils());
  var _getusermedia = require_getusermedia2();
  var _getdisplaymedia = require_getdisplaymedia();
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _toConsumableArray(r) {
    return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
  }
  function _nonIterableSpread() {
    throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
  }
  function _unsupportedIterableToArray(r, a) {
    if (r) {
      if (typeof r == "string")
        return _arrayLikeToArray(r, a);
      var t = {}.toString.call(r).slice(8, -1);
      return t === "Object" && r.constructor && (t = r.constructor.name), t === "Map" || t === "Set" ? Array.from(r) : t === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : undefined;
    }
  }
  function _iterableToArray(r) {
    if (typeof Symbol != "undefined" && r[Symbol.iterator] != null || r["@@iterator"] != null)
      return Array.from(r);
  }
  function _arrayWithoutHoles(r) {
    if (Array.isArray(r))
      return _arrayLikeToArray(r);
  }
  function _arrayLikeToArray(r, a) {
    (a == null || a > r.length) && (a = r.length);
    for (var e = 0, n = Array(a);e < a; e++)
      n[e] = r[e];
    return n;
  }
  function _defineProperty(e, r, t) {
    return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return _typeof(i) == "symbol" ? i : i + "";
  }
  function _toPrimitive(t, r) {
    if (_typeof(t) != "object" || !t)
      return t;
    var e = t[Symbol.toPrimitive];
    if (e !== undefined) {
      var i = e.call(t, r || "default");
      if (_typeof(i) != "object")
        return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (r === "string" ? String : Number)(t);
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function shimOnTrack(window2) {
    if (_typeof(window2) === "object" && window2.RTCTrackEvent && "receiver" in window2.RTCTrackEvent.prototype && !("transceiver" in window2.RTCTrackEvent.prototype)) {
      Object.defineProperty(window2.RTCTrackEvent.prototype, "transceiver", {
        get: function get() {
          return {
            receiver: this.receiver
          };
        }
      });
    }
  }
  function shimPeerConnection(window2, browserDetails) {
    if (_typeof(window2) !== "object" || !(window2.RTCPeerConnection || window2.mozRTCPeerConnection)) {
      return;
    }
    if (!window2.RTCPeerConnection && window2.mozRTCPeerConnection) {
      window2.RTCPeerConnection = window2.mozRTCPeerConnection;
    }
    if (browserDetails.version < 53) {
      ["setLocalDescription", "setRemoteDescription", "addIceCandidate"].forEach(function(method) {
        var nativeMethod = window2.RTCPeerConnection.prototype[method];
        var methodObj = _defineProperty({}, method, function() {
          arguments[0] = new (method === "addIceCandidate" ? window2.RTCIceCandidate : window2.RTCSessionDescription)(arguments[0]);
          return nativeMethod.apply(this, arguments);
        });
        window2.RTCPeerConnection.prototype[method] = methodObj[method];
      });
    }
    var modernStatsTypes = {
      inboundrtp: "inbound-rtp",
      outboundrtp: "outbound-rtp",
      candidatepair: "candidate-pair",
      localcandidate: "local-candidate",
      remotecandidate: "remote-candidate"
    };
    var nativeGetStats = window2.RTCPeerConnection.prototype.getStats;
    window2.RTCPeerConnection.prototype.getStats = function getStats() {
      var _arguments = Array.prototype.slice.call(arguments), selector = _arguments[0], onSucc = _arguments[1], onErr = _arguments[2];
      return nativeGetStats.apply(this, [selector || null]).then(function(stats) {
        if (browserDetails.version < 53 && !onSucc) {
          try {
            stats.forEach(function(stat) {
              stat.type = modernStatsTypes[stat.type] || stat.type;
            });
          } catch (e) {
            if (e.name !== "TypeError") {
              throw e;
            }
            stats.forEach(function(stat, i) {
              stats.set(i, Object.assign({}, stat, {
                type: modernStatsTypes[stat.type] || stat.type
              }));
            });
          }
        }
        return stats;
      }).then(onSucc, onErr);
    };
  }
  function shimSenderGetStats(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection && window2.RTCRtpSender)) {
      return;
    }
    if (window2.RTCRtpSender && "getStats" in window2.RTCRtpSender.prototype) {
      return;
    }
    var origGetSenders = window2.RTCPeerConnection.prototype.getSenders;
    if (origGetSenders) {
      window2.RTCPeerConnection.prototype.getSenders = function getSenders() {
        var _this = this;
        var senders = origGetSenders.apply(this, []);
        senders.forEach(function(sender) {
          return sender._pc = _this;
        });
        return senders;
      };
    }
    var origAddTrack = window2.RTCPeerConnection.prototype.addTrack;
    if (origAddTrack) {
      window2.RTCPeerConnection.prototype.addTrack = function addTrack() {
        var sender = origAddTrack.apply(this, arguments);
        sender._pc = this;
        return sender;
      };
    }
    window2.RTCRtpSender.prototype.getStats = function getStats() {
      return this.track ? this._pc.getStats(this.track) : Promise.resolve(new Map);
    };
  }
  function shimReceiverGetStats(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection && window2.RTCRtpSender)) {
      return;
    }
    if (window2.RTCRtpSender && "getStats" in window2.RTCRtpReceiver.prototype) {
      return;
    }
    var origGetReceivers = window2.RTCPeerConnection.prototype.getReceivers;
    if (origGetReceivers) {
      window2.RTCPeerConnection.prototype.getReceivers = function getReceivers() {
        var _this2 = this;
        var receivers = origGetReceivers.apply(this, []);
        receivers.forEach(function(receiver) {
          return receiver._pc = _this2;
        });
        return receivers;
      };
    }
    utils.wrapPeerConnectionEvent(window2, "track", function(e) {
      e.receiver._pc = e.srcElement;
      return e;
    });
    window2.RTCRtpReceiver.prototype.getStats = function getStats() {
      return this._pc.getStats(this.track);
    };
  }
  function shimRemoveStream(window2) {
    if (!window2.RTCPeerConnection || "removeStream" in window2.RTCPeerConnection.prototype) {
      return;
    }
    window2.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
      var _this3 = this;
      utils.deprecated("removeStream", "removeTrack");
      this.getSenders().forEach(function(sender) {
        if (sender.track && stream.getTracks().includes(sender.track)) {
          _this3.removeTrack(sender);
        }
      });
    };
  }
  function shimRTCDataChannel(window2) {
    if (window2.DataChannel && !window2.RTCDataChannel) {
      window2.RTCDataChannel = window2.DataChannel;
    }
  }
  function shimAddTransceiver(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection)) {
      return;
    }
    var origAddTransceiver = window2.RTCPeerConnection.prototype.addTransceiver;
    if (origAddTransceiver) {
      window2.RTCPeerConnection.prototype.addTransceiver = function addTransceiver() {
        this.setParametersPromises = [];
        var sendEncodings = arguments[1] && arguments[1].sendEncodings;
        if (sendEncodings === undefined) {
          sendEncodings = [];
        }
        sendEncodings = _toConsumableArray(sendEncodings);
        var shouldPerformCheck = sendEncodings.length > 0;
        if (shouldPerformCheck) {
          sendEncodings.forEach(function(encodingParam) {
            if ("rid" in encodingParam) {
              var ridRegex = /^[a-z0-9]{0,16}$/i;
              if (!ridRegex.test(encodingParam.rid)) {
                throw new TypeError("Invalid RID value provided.");
              }
            }
            if ("scaleResolutionDownBy" in encodingParam) {
              if (!(parseFloat(encodingParam.scaleResolutionDownBy) >= 1)) {
                throw new RangeError("scale_resolution_down_by must be >= 1.0");
              }
            }
            if ("maxFramerate" in encodingParam) {
              if (!(parseFloat(encodingParam.maxFramerate) >= 0)) {
                throw new RangeError("max_framerate must be >= 0.0");
              }
            }
          });
        }
        var transceiver = origAddTransceiver.apply(this, arguments);
        if (shouldPerformCheck) {
          var sender = transceiver.sender;
          var params = sender.getParameters();
          if (!("encodings" in params) || params.encodings.length === 1 && Object.keys(params.encodings[0]).length === 0) {
            params.encodings = sendEncodings;
            sender.sendEncodings = sendEncodings;
            this.setParametersPromises.push(sender.setParameters(params).then(function() {
              delete sender.sendEncodings;
            })["catch"](function() {
              delete sender.sendEncodings;
            }));
          }
        }
        return transceiver;
      };
    }
  }
  function shimGetParameters(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCRtpSender)) {
      return;
    }
    var origGetParameters = window2.RTCRtpSender.prototype.getParameters;
    if (origGetParameters) {
      window2.RTCRtpSender.prototype.getParameters = function getParameters() {
        var params = origGetParameters.apply(this, arguments);
        if (!("encodings" in params)) {
          params.encodings = [].concat(this.sendEncodings || [{}]);
        }
        return params;
      };
    }
  }
  function shimCreateOffer(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection)) {
      return;
    }
    var origCreateOffer = window2.RTCPeerConnection.prototype.createOffer;
    window2.RTCPeerConnection.prototype.createOffer = function createOffer() {
      var _arguments2 = arguments, _this4 = this;
      if (this.setParametersPromises && this.setParametersPromises.length) {
        return Promise.all(this.setParametersPromises).then(function() {
          return origCreateOffer.apply(_this4, _arguments2);
        })["finally"](function() {
          _this4.setParametersPromises = [];
        });
      }
      return origCreateOffer.apply(this, arguments);
    };
  }
  function shimCreateAnswer(window2) {
    if (!(_typeof(window2) === "object" && window2.RTCPeerConnection)) {
      return;
    }
    var origCreateAnswer = window2.RTCPeerConnection.prototype.createAnswer;
    window2.RTCPeerConnection.prototype.createAnswer = function createAnswer() {
      var _arguments3 = arguments, _this5 = this;
      if (this.setParametersPromises && this.setParametersPromises.length) {
        return Promise.all(this.setParametersPromises).then(function() {
          return origCreateAnswer.apply(_this5, _arguments3);
        })["finally"](function() {
          _this5.setParametersPromises = [];
        });
      }
      return origCreateAnswer.apply(this, arguments);
    };
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/safari/safari_shim.js
var require_safari_shim = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.shimAudioContext = shimAudioContext;
  exports.shimCallbacksAPI = shimCallbacksAPI;
  exports.shimConstraints = shimConstraints;
  exports.shimCreateOfferLegacy = shimCreateOfferLegacy;
  exports.shimGetUserMedia = shimGetUserMedia;
  exports.shimLocalStreamsAPI = shimLocalStreamsAPI;
  exports.shimRTCIceServerUrls = shimRTCIceServerUrls;
  exports.shimRemoteStreamsAPI = shimRemoteStreamsAPI;
  exports.shimTrackEventTransceiver = shimTrackEventTransceiver;
  var utils = _interopRequireWildcard(require_utils());
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function shimLocalStreamsAPI(window2) {
    if (_typeof(window2) !== "object" || !window2.RTCPeerConnection) {
      return;
    }
    if (!("getLocalStreams" in window2.RTCPeerConnection.prototype)) {
      window2.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        return this._localStreams;
      };
    }
    if (!("addStream" in window2.RTCPeerConnection.prototype)) {
      var _addTrack = window2.RTCPeerConnection.prototype.addTrack;
      window2.RTCPeerConnection.prototype.addStream = function addStream(stream) {
        var _this = this;
        if (!this._localStreams) {
          this._localStreams = [];
        }
        if (!this._localStreams.includes(stream)) {
          this._localStreams.push(stream);
        }
        stream.getAudioTracks().forEach(function(track) {
          return _addTrack.call(_this, track, stream);
        });
        stream.getVideoTracks().forEach(function(track) {
          return _addTrack.call(_this, track, stream);
        });
      };
      window2.RTCPeerConnection.prototype.addTrack = function addTrack(track) {
        var _this2 = this;
        for (var _len = arguments.length, streams = new Array(_len > 1 ? _len - 1 : 0), _key = 1;_key < _len; _key++) {
          streams[_key - 1] = arguments[_key];
        }
        if (streams) {
          streams.forEach(function(stream) {
            if (!_this2._localStreams) {
              _this2._localStreams = [stream];
            } else if (!_this2._localStreams.includes(stream)) {
              _this2._localStreams.push(stream);
            }
          });
        }
        return _addTrack.apply(this, arguments);
      };
    }
    if (!("removeStream" in window2.RTCPeerConnection.prototype)) {
      window2.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
        var _this3 = this;
        if (!this._localStreams) {
          this._localStreams = [];
        }
        var index = this._localStreams.indexOf(stream);
        if (index === -1) {
          return;
        }
        this._localStreams.splice(index, 1);
        var tracks = stream.getTracks();
        this.getSenders().forEach(function(sender) {
          if (tracks.includes(sender.track)) {
            _this3.removeTrack(sender);
          }
        });
      };
    }
  }
  function shimRemoteStreamsAPI(window2) {
    if (_typeof(window2) !== "object" || !window2.RTCPeerConnection) {
      return;
    }
    if (!("getRemoteStreams" in window2.RTCPeerConnection.prototype)) {
      window2.RTCPeerConnection.prototype.getRemoteStreams = function getRemoteStreams() {
        return this._remoteStreams ? this._remoteStreams : [];
      };
    }
    if (!("onaddstream" in window2.RTCPeerConnection.prototype)) {
      Object.defineProperty(window2.RTCPeerConnection.prototype, "onaddstream", {
        get: function get() {
          return this._onaddstream;
        },
        set: function set(f) {
          var _this4 = this;
          if (this._onaddstream) {
            this.removeEventListener("addstream", this._onaddstream);
            this.removeEventListener("track", this._onaddstreampoly);
          }
          this.addEventListener("addstream", this._onaddstream = f);
          this.addEventListener("track", this._onaddstreampoly = function(e) {
            e.streams.forEach(function(stream) {
              if (!_this4._remoteStreams) {
                _this4._remoteStreams = [];
              }
              if (_this4._remoteStreams.includes(stream)) {
                return;
              }
              _this4._remoteStreams.push(stream);
              var event = new Event("addstream");
              event.stream = stream;
              _this4.dispatchEvent(event);
            });
          });
        }
      });
      var origSetRemoteDescription = window2.RTCPeerConnection.prototype.setRemoteDescription;
      window2.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
        var pc = this;
        if (!this._onaddstreampoly) {
          this.addEventListener("track", this._onaddstreampoly = function(e) {
            e.streams.forEach(function(stream) {
              if (!pc._remoteStreams) {
                pc._remoteStreams = [];
              }
              if (pc._remoteStreams.indexOf(stream) >= 0) {
                return;
              }
              pc._remoteStreams.push(stream);
              var event = new Event("addstream");
              event.stream = stream;
              pc.dispatchEvent(event);
            });
          });
        }
        return origSetRemoteDescription.apply(pc, arguments);
      };
    }
  }
  function shimCallbacksAPI(window2) {
    if (_typeof(window2) !== "object" || !window2.RTCPeerConnection) {
      return;
    }
    var prototype = window2.RTCPeerConnection.prototype;
    var origCreateOffer = prototype.createOffer;
    var origCreateAnswer = prototype.createAnswer;
    var setLocalDescription = prototype.setLocalDescription;
    var setRemoteDescription = prototype.setRemoteDescription;
    var addIceCandidate = prototype.addIceCandidate;
    prototype.createOffer = function createOffer(successCallback, failureCallback) {
      var options = arguments.length >= 2 ? arguments[2] : arguments[0];
      var promise = origCreateOffer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.createAnswer = function createAnswer(successCallback, failureCallback) {
      var options = arguments.length >= 2 ? arguments[2] : arguments[0];
      var promise = origCreateAnswer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    var withCallback = function withCallback2(description, successCallback, failureCallback) {
      var promise = setLocalDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setLocalDescription = withCallback;
    withCallback = function withCallback2(description, successCallback, failureCallback) {
      var promise = setRemoteDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setRemoteDescription = withCallback;
    withCallback = function withCallback2(candidate, successCallback, failureCallback) {
      var promise = addIceCandidate.apply(this, [candidate]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.addIceCandidate = withCallback;
  }
  function shimGetUserMedia(window2) {
    var navigator2 = window2 && window2.navigator;
    if (navigator2.mediaDevices && navigator2.mediaDevices.getUserMedia) {
      var mediaDevices = navigator2.mediaDevices;
      var _getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      navigator2.mediaDevices.getUserMedia = function(constraints) {
        return _getUserMedia(shimConstraints(constraints));
      };
    }
    if (!navigator2.getUserMedia && navigator2.mediaDevices && navigator2.mediaDevices.getUserMedia) {
      navigator2.getUserMedia = function getUserMedia(constraints, cb, errcb) {
        navigator2.mediaDevices.getUserMedia(constraints).then(cb, errcb);
      }.bind(navigator2);
    }
  }
  function shimConstraints(constraints) {
    if (constraints && constraints.video !== undefined) {
      return Object.assign({}, constraints, {
        video: utils.compactObject(constraints.video)
      });
    }
    return constraints;
  }
  function shimRTCIceServerUrls(window2) {
    if (!window2.RTCPeerConnection) {
      return;
    }
    var OrigPeerConnection = window2.RTCPeerConnection;
    window2.RTCPeerConnection = function RTCPeerConnection2(pcConfig, pcConstraints) {
      if (pcConfig && pcConfig.iceServers) {
        var newIceServers = [];
        for (var i = 0;i < pcConfig.iceServers.length; i++) {
          var server = pcConfig.iceServers[i];
          if (server.urls === undefined && server.url) {
            utils.deprecated("RTCIceServer.url", "RTCIceServer.urls");
            server = JSON.parse(JSON.stringify(server));
            server.urls = server.url;
            delete server.url;
            newIceServers.push(server);
          } else {
            newIceServers.push(pcConfig.iceServers[i]);
          }
        }
        pcConfig.iceServers = newIceServers;
      }
      return new OrigPeerConnection(pcConfig, pcConstraints);
    };
    window2.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
    if ("generateCertificate" in OrigPeerConnection) {
      Object.defineProperty(window2.RTCPeerConnection, "generateCertificate", {
        get: function get() {
          return OrigPeerConnection.generateCertificate;
        }
      });
    }
  }
  function shimTrackEventTransceiver(window2) {
    if (_typeof(window2) === "object" && window2.RTCTrackEvent && "receiver" in window2.RTCTrackEvent.prototype && !("transceiver" in window2.RTCTrackEvent.prototype)) {
      Object.defineProperty(window2.RTCTrackEvent.prototype, "transceiver", {
        get: function get() {
          return {
            receiver: this.receiver
          };
        }
      });
    }
  }
  function shimCreateOfferLegacy(window2) {
    var origCreateOffer = window2.RTCPeerConnection.prototype.createOffer;
    window2.RTCPeerConnection.prototype.createOffer = function createOffer(offerOptions) {
      if (offerOptions) {
        if (typeof offerOptions.offerToReceiveAudio !== "undefined") {
          offerOptions.offerToReceiveAudio = !!offerOptions.offerToReceiveAudio;
        }
        var audioTransceiver = this.getTransceivers().find(function(transceiver) {
          return transceiver.receiver.track.kind === "audio";
        });
        if (offerOptions.offerToReceiveAudio === false && audioTransceiver) {
          if (audioTransceiver.direction === "sendrecv") {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("sendonly");
            } else {
              audioTransceiver.direction = "sendonly";
            }
          } else if (audioTransceiver.direction === "recvonly") {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("inactive");
            } else {
              audioTransceiver.direction = "inactive";
            }
          }
        } else if (offerOptions.offerToReceiveAudio === true && !audioTransceiver) {
          this.addTransceiver("audio", {
            direction: "recvonly"
          });
        }
        if (typeof offerOptions.offerToReceiveVideo !== "undefined") {
          offerOptions.offerToReceiveVideo = !!offerOptions.offerToReceiveVideo;
        }
        var videoTransceiver = this.getTransceivers().find(function(transceiver) {
          return transceiver.receiver.track.kind === "video";
        });
        if (offerOptions.offerToReceiveVideo === false && videoTransceiver) {
          if (videoTransceiver.direction === "sendrecv") {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("sendonly");
            } else {
              videoTransceiver.direction = "sendonly";
            }
          } else if (videoTransceiver.direction === "recvonly") {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("inactive");
            } else {
              videoTransceiver.direction = "inactive";
            }
          }
        } else if (offerOptions.offerToReceiveVideo === true && !videoTransceiver) {
          this.addTransceiver("video", {
            direction: "recvonly"
          });
        }
      }
      return origCreateOffer.apply(this, arguments);
    };
  }
  function shimAudioContext(window2) {
    if (_typeof(window2) !== "object" || window2.AudioContext) {
      return;
    }
    window2.AudioContext = window2.webkitAudioContext;
  }
});

// ../node_modules/.bun/sdp@3.2.1/node_modules/sdp/dist/sdp.js
var require_sdp = __commonJS((exports, module) => {
  var SDPUtils = {};
  SDPUtils.generateIdentifier = function() {
    return Math.random().toString(36).substring(2, 12);
  };
  SDPUtils.localCName = SDPUtils.generateIdentifier();
  SDPUtils.splitLines = function(blob) {
    return blob.trim().split(`
`).map((line) => line.trim());
  };
  SDPUtils.splitSections = function(blob) {
    const parts = blob.split(`
m=`);
    return parts.map((part, index) => (index > 0 ? "m=" + part : part).trim() + `\r
`);
  };
  SDPUtils.getDescription = function(blob) {
    const sections = SDPUtils.splitSections(blob);
    return sections && sections[0];
  };
  SDPUtils.getMediaSections = function(blob) {
    const sections = SDPUtils.splitSections(blob);
    sections.shift();
    return sections;
  };
  SDPUtils.matchPrefix = function(blob, prefix) {
    return SDPUtils.splitLines(blob).filter((line) => line.indexOf(prefix) === 0);
  };
  SDPUtils.parseCandidate = function(line) {
    let parts;
    if (line.indexOf("a=candidate:") === 0) {
      parts = line.substring(12).split(" ");
    } else {
      parts = line.substring(10).split(" ");
    }
    const candidate = {
      foundation: parts[0],
      component: { 1: "rtp", 2: "rtcp" }[parts[1]] || parts[1],
      protocol: parts[2].toLowerCase(),
      priority: parseInt(parts[3], 10),
      ip: parts[4],
      address: parts[4],
      port: parseInt(parts[5], 10),
      type: parts[7]
    };
    for (let i = 8;i < parts.length; i += 2) {
      switch (parts[i]) {
        case "raddr":
          candidate.relatedAddress = parts[i + 1];
          break;
        case "rport":
          candidate.relatedPort = parseInt(parts[i + 1], 10);
          break;
        case "tcptype":
          candidate.tcpType = parts[i + 1];
          break;
        case "ufrag":
          candidate.ufrag = parts[i + 1];
          candidate.usernameFragment = parts[i + 1];
          break;
        default:
          if (candidate[parts[i]] === undefined) {
            candidate[parts[i]] = parts[i + 1];
          }
          break;
      }
    }
    return candidate;
  };
  SDPUtils.writeCandidate = function(candidate) {
    const sdp = [];
    sdp.push(candidate.foundation);
    const component = candidate.component;
    if (component === "rtp") {
      sdp.push(1);
    } else if (component === "rtcp") {
      sdp.push(2);
    } else {
      sdp.push(component);
    }
    sdp.push(candidate.protocol.toUpperCase());
    sdp.push(candidate.priority);
    sdp.push(candidate.address || candidate.ip);
    sdp.push(candidate.port);
    const type = candidate.type;
    sdp.push("typ");
    sdp.push(type);
    if (type !== "host" && candidate.relatedAddress && candidate.relatedPort) {
      sdp.push("raddr");
      sdp.push(candidate.relatedAddress);
      sdp.push("rport");
      sdp.push(candidate.relatedPort);
    }
    if (candidate.tcpType && candidate.protocol.toLowerCase() === "tcp") {
      sdp.push("tcptype");
      sdp.push(candidate.tcpType);
    }
    if (candidate.usernameFragment || candidate.ufrag) {
      sdp.push("ufrag");
      sdp.push(candidate.usernameFragment || candidate.ufrag);
    }
    return "candidate:" + sdp.join(" ");
  };
  SDPUtils.parseIceOptions = function(line) {
    return line.substring(14).split(" ");
  };
  SDPUtils.parseRtpMap = function(line) {
    let parts = line.substring(9).split(" ");
    const parsed = {
      payloadType: parseInt(parts.shift(), 10)
    };
    parts = parts[0].split("/");
    parsed.name = parts[0];
    parsed.clockRate = parseInt(parts[1], 10);
    parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
    parsed.numChannels = parsed.channels;
    return parsed;
  };
  SDPUtils.writeRtpMap = function(codec) {
    let pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
      pt = codec.preferredPayloadType;
    }
    const channels = codec.channels || codec.numChannels || 1;
    return "a=rtpmap:" + pt + " " + codec.name + "/" + codec.clockRate + (channels !== 1 ? "/" + channels : "") + `\r
`;
  };
  SDPUtils.parseExtmap = function(line) {
    const parts = line.substring(9).split(" ");
    return {
      id: parseInt(parts[0], 10),
      direction: parts[0].indexOf("/") > 0 ? parts[0].split("/")[1] : "sendrecv",
      uri: parts[1],
      attributes: parts.slice(2).join(" ")
    };
  };
  SDPUtils.writeExtmap = function(headerExtension) {
    return "a=extmap:" + (headerExtension.id || headerExtension.preferredId) + (headerExtension.direction && headerExtension.direction !== "sendrecv" ? "/" + headerExtension.direction : "") + " " + headerExtension.uri + (headerExtension.attributes ? " " + headerExtension.attributes : "") + `\r
`;
  };
  SDPUtils.parseFmtp = function(line) {
    const parsed = {};
    let kv;
    const parts = line.substring(line.indexOf(" ") + 1).split(";");
    for (let j = 0;j < parts.length; j++) {
      kv = parts[j].trim().split("=");
      parsed[kv[0].trim()] = kv[1];
    }
    return parsed;
  };
  SDPUtils.writeFmtp = function(codec) {
    let line = "";
    let pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
      pt = codec.preferredPayloadType;
    }
    if (codec.parameters && Object.keys(codec.parameters).length) {
      const params = [];
      Object.keys(codec.parameters).forEach((param) => {
        if (codec.parameters[param] !== undefined) {
          params.push(param + "=" + codec.parameters[param]);
        } else {
          params.push(param);
        }
      });
      line += "a=fmtp:" + pt + " " + params.join(";") + `\r
`;
    }
    return line;
  };
  SDPUtils.parseRtcpFb = function(line) {
    const parts = line.substring(line.indexOf(" ") + 1).split(" ");
    return {
      type: parts.shift(),
      parameter: parts.join(" ")
    };
  };
  SDPUtils.writeRtcpFb = function(codec) {
    let lines = "";
    let pt = codec.payloadType;
    if (codec.preferredPayloadType !== undefined) {
      pt = codec.preferredPayloadType;
    }
    if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
      codec.rtcpFeedback.forEach((fb) => {
        lines += "a=rtcp-fb:" + pt + " " + fb.type + (fb.parameter && fb.parameter.length ? " " + fb.parameter : "") + `\r
`;
      });
    }
    return lines;
  };
  SDPUtils.parseSsrcMedia = function(line) {
    const sp = line.indexOf(" ");
    const parts = {
      ssrc: parseInt(line.substring(7, sp), 10)
    };
    const colon = line.indexOf(":", sp);
    if (colon > -1) {
      parts.attribute = line.substring(sp + 1, colon);
      parts.value = line.substring(colon + 1);
    } else {
      parts.attribute = line.substring(sp + 1);
    }
    return parts;
  };
  SDPUtils.parseSsrcGroup = function(line) {
    const parts = line.substring(13).split(" ");
    return {
      semantics: parts.shift(),
      ssrcs: parts.map((ssrc) => parseInt(ssrc, 10))
    };
  };
  SDPUtils.getMid = function(mediaSection) {
    const mid = SDPUtils.matchPrefix(mediaSection, "a=mid:")[0];
    if (mid) {
      return mid.substring(6);
    }
  };
  SDPUtils.parseFingerprint = function(line) {
    const parts = line.substring(14).split(" ");
    return {
      algorithm: parts[0].toLowerCase(),
      value: parts[1].toUpperCase()
    };
  };
  SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
    const lines = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=fingerprint:");
    return {
      role: "auto",
      fingerprints: lines.map(SDPUtils.parseFingerprint)
    };
  };
  SDPUtils.writeDtlsParameters = function(params, setupType) {
    let sdp = "a=setup:" + setupType + `\r
`;
    params.fingerprints.forEach((fp) => {
      sdp += "a=fingerprint:" + fp.algorithm + " " + fp.value + `\r
`;
    });
    return sdp;
  };
  SDPUtils.parseCryptoLine = function(line) {
    const parts = line.substring(9).split(" ");
    return {
      tag: parseInt(parts[0], 10),
      cryptoSuite: parts[1],
      keyParams: parts[2],
      sessionParams: parts.slice(3)
    };
  };
  SDPUtils.writeCryptoLine = function(parameters) {
    return "a=crypto:" + parameters.tag + " " + parameters.cryptoSuite + " " + (typeof parameters.keyParams === "object" ? SDPUtils.writeCryptoKeyParams(parameters.keyParams) : parameters.keyParams) + (parameters.sessionParams ? " " + parameters.sessionParams.join(" ") : "") + `\r
`;
  };
  SDPUtils.parseCryptoKeyParams = function(keyParams) {
    if (keyParams.indexOf("inline:") !== 0) {
      return null;
    }
    const parts = keyParams.substring(7).split("|");
    return {
      keyMethod: "inline",
      keySalt: parts[0],
      lifeTime: parts[1],
      mkiValue: parts[2] ? parts[2].split(":")[0] : undefined,
      mkiLength: parts[2] ? parts[2].split(":")[1] : undefined
    };
  };
  SDPUtils.writeCryptoKeyParams = function(keyParams) {
    return keyParams.keyMethod + ":" + keyParams.keySalt + (keyParams.lifeTime ? "|" + keyParams.lifeTime : "") + (keyParams.mkiValue && keyParams.mkiLength ? "|" + keyParams.mkiValue + ":" + keyParams.mkiLength : "");
  };
  SDPUtils.getCryptoParameters = function(mediaSection, sessionpart) {
    const lines = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=crypto:");
    return lines.map(SDPUtils.parseCryptoLine);
  };
  SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
    const ufrag = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=ice-ufrag:")[0];
    const pwd = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=ice-pwd:")[0];
    if (!(ufrag && pwd)) {
      return null;
    }
    return {
      usernameFragment: ufrag.substring(12),
      password: pwd.substring(10)
    };
  };
  SDPUtils.writeIceParameters = function(params) {
    let sdp = "a=ice-ufrag:" + params.usernameFragment + `\r
` + "a=ice-pwd:" + params.password + `\r
`;
    if (params.iceLite) {
      sdp += `a=ice-lite\r
`;
    }
    return sdp;
  };
  SDPUtils.parseRtpParameters = function(mediaSection) {
    const description = {
      codecs: [],
      headerExtensions: [],
      fecMechanisms: [],
      rtcp: []
    };
    const lines = SDPUtils.splitLines(mediaSection);
    const mline = lines[0].split(" ");
    description.profile = mline[2];
    for (let i = 3;i < mline.length; i++) {
      const pt = mline[i];
      const rtpmapline = SDPUtils.matchPrefix(mediaSection, "a=rtpmap:" + pt + " ")[0];
      if (rtpmapline) {
        const codec = SDPUtils.parseRtpMap(rtpmapline);
        const fmtps = SDPUtils.matchPrefix(mediaSection, "a=fmtp:" + pt + " ");
        codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
        codec.rtcpFeedback = SDPUtils.matchPrefix(mediaSection, "a=rtcp-fb:" + pt + " ").map(SDPUtils.parseRtcpFb);
        description.codecs.push(codec);
        switch (codec.name.toUpperCase()) {
          case "RED":
          case "ULPFEC":
            description.fecMechanisms.push(codec.name.toUpperCase());
            break;
          default:
            break;
        }
      }
    }
    SDPUtils.matchPrefix(mediaSection, "a=extmap:").forEach((line) => {
      description.headerExtensions.push(SDPUtils.parseExtmap(line));
    });
    const wildcardRtcpFb = SDPUtils.matchPrefix(mediaSection, "a=rtcp-fb:* ").map(SDPUtils.parseRtcpFb);
    description.codecs.forEach((codec) => {
      wildcardRtcpFb.forEach((fb) => {
        const duplicate = codec.rtcpFeedback.find((existingFeedback) => {
          return existingFeedback.type === fb.type && existingFeedback.parameter === fb.parameter;
        });
        if (!duplicate) {
          codec.rtcpFeedback.push(fb);
        }
      });
    });
    return description;
  };
  SDPUtils.writeRtpDescription = function(kind, caps) {
    let sdp = "";
    sdp += "m=" + kind + " ";
    sdp += caps.codecs.length > 0 ? "9" : "0";
    sdp += " " + (caps.profile || "UDP/TLS/RTP/SAVPF") + " ";
    sdp += caps.codecs.map((codec) => {
      if (codec.preferredPayloadType !== undefined) {
        return codec.preferredPayloadType;
      }
      return codec.payloadType;
    }).join(" ") + `\r
`;
    sdp += `c=IN IP4 0.0.0.0\r
`;
    sdp += `a=rtcp:9 IN IP4 0.0.0.0\r
`;
    caps.codecs.forEach((codec) => {
      sdp += SDPUtils.writeRtpMap(codec);
      sdp += SDPUtils.writeFmtp(codec);
      sdp += SDPUtils.writeRtcpFb(codec);
    });
    let maxptime = 0;
    caps.codecs.forEach((codec) => {
      if (codec.maxptime > maxptime) {
        maxptime = codec.maxptime;
      }
    });
    if (maxptime > 0) {
      sdp += "a=maxptime:" + maxptime + `\r
`;
    }
    if (caps.headerExtensions) {
      caps.headerExtensions.forEach((extension) => {
        sdp += SDPUtils.writeExtmap(extension);
      });
    }
    return sdp;
  };
  SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
    const encodingParameters = [];
    const description = SDPUtils.parseRtpParameters(mediaSection);
    const hasRed = description.fecMechanisms.indexOf("RED") !== -1;
    const hasUlpfec = description.fecMechanisms.indexOf("ULPFEC") !== -1;
    const ssrcs = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((parts) => parts.attribute === "cname");
    const primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
    let secondarySsrc;
    const flows = SDPUtils.matchPrefix(mediaSection, "a=ssrc-group:FID").map((line) => {
      const parts = line.substring(17).split(" ");
      return parts.map((part) => parseInt(part, 10));
    });
    if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
      secondarySsrc = flows[0][1];
    }
    description.codecs.forEach((codec) => {
      if (codec.name.toUpperCase() === "RTX" && codec.parameters.apt) {
        let encParam = {
          ssrc: primarySsrc,
          codecPayloadType: parseInt(codec.parameters.apt, 10)
        };
        if (primarySsrc && secondarySsrc) {
          encParam.rtx = { ssrc: secondarySsrc };
        }
        encodingParameters.push(encParam);
        if (hasRed) {
          encParam = JSON.parse(JSON.stringify(encParam));
          encParam.fec = {
            ssrc: primarySsrc,
            mechanism: hasUlpfec ? "red+ulpfec" : "red"
          };
          encodingParameters.push(encParam);
        }
      }
    });
    if (encodingParameters.length === 0 && primarySsrc) {
      encodingParameters.push({
        ssrc: primarySsrc
      });
    }
    let bandwidth = SDPUtils.matchPrefix(mediaSection, "b=");
    if (bandwidth.length) {
      if (bandwidth[0].indexOf("b=TIAS:") === 0) {
        bandwidth = parseInt(bandwidth[0].substring(7), 10);
      } else if (bandwidth[0].indexOf("b=AS:") === 0) {
        bandwidth = parseInt(bandwidth[0].substring(5), 10) * 1000 * 0.95 - 50 * 40 * 8;
      } else {
        bandwidth = undefined;
      }
      encodingParameters.forEach((params) => {
        params.maxBitrate = bandwidth;
      });
    }
    return encodingParameters;
  };
  SDPUtils.parseRtcpParameters = function(mediaSection) {
    const rtcpParameters = {};
    const remoteSsrc = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((obj) => obj.attribute === "cname")[0];
    if (remoteSsrc) {
      rtcpParameters.cname = remoteSsrc.value;
      rtcpParameters.ssrc = remoteSsrc.ssrc;
    }
    const rsize = SDPUtils.matchPrefix(mediaSection, "a=rtcp-rsize");
    rtcpParameters.reducedSize = rsize.length > 0;
    rtcpParameters.compound = rsize.length === 0;
    const mux = SDPUtils.matchPrefix(mediaSection, "a=rtcp-mux");
    rtcpParameters.mux = mux.length > 0;
    return rtcpParameters;
  };
  SDPUtils.writeRtcpParameters = function(rtcpParameters) {
    let sdp = "";
    if (rtcpParameters.reducedSize) {
      sdp += `a=rtcp-rsize\r
`;
    }
    if (rtcpParameters.mux) {
      sdp += `a=rtcp-mux\r
`;
    }
    if (rtcpParameters.ssrc !== undefined && rtcpParameters.cname) {
      sdp += "a=ssrc:" + rtcpParameters.ssrc + " cname:" + rtcpParameters.cname + `\r
`;
    }
    return sdp;
  };
  SDPUtils.parseMsid = function(mediaSection) {
    let parts;
    const spec = SDPUtils.matchPrefix(mediaSection, "a=msid:");
    if (spec.length === 1) {
      parts = spec[0].substring(7).split(" ");
      return { stream: parts[0], track: parts[1] };
    }
    const planB = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((msidParts) => msidParts.attribute === "msid");
    if (planB.length > 0) {
      parts = planB[0].value.split(" ");
      return { stream: parts[0], track: parts[1] };
    }
  };
  SDPUtils.parseSctpDescription = function(mediaSection) {
    const mline = SDPUtils.parseMLine(mediaSection);
    const maxSizeLine = SDPUtils.matchPrefix(mediaSection, "a=max-message-size:");
    let maxMessageSize;
    if (maxSizeLine.length > 0) {
      maxMessageSize = parseInt(maxSizeLine[0].substring(19), 10);
    }
    if (isNaN(maxMessageSize)) {
      maxMessageSize = 65536;
    }
    const sctpPort = SDPUtils.matchPrefix(mediaSection, "a=sctp-port:");
    if (sctpPort.length > 0) {
      return {
        port: parseInt(sctpPort[0].substring(12), 10),
        protocol: mline.fmt,
        maxMessageSize
      };
    }
    const sctpMapLines = SDPUtils.matchPrefix(mediaSection, "a=sctpmap:");
    if (sctpMapLines.length > 0) {
      const parts = sctpMapLines[0].substring(10).split(" ");
      return {
        port: parseInt(parts[0], 10),
        protocol: parts[1],
        maxMessageSize
      };
    }
  };
  SDPUtils.writeSctpDescription = function(media, sctp) {
    let output = [];
    if (media.protocol !== "DTLS/SCTP") {
      output = ["m=" + media.kind + " 9 " + media.protocol + " " + sctp.protocol + `\r
`, `c=IN IP4 0.0.0.0\r
`, "a=sctp-port:" + sctp.port + `\r
`];
    } else {
      output = ["m=" + media.kind + " 9 " + media.protocol + " " + sctp.port + `\r
`, `c=IN IP4 0.0.0.0\r
`, "a=sctpmap:" + sctp.port + " " + sctp.protocol + ` 65535\r
`];
    }
    if (sctp.maxMessageSize !== undefined) {
      output.push("a=max-message-size:" + sctp.maxMessageSize + `\r
`);
    }
    return output.join("");
  };
  SDPUtils.generateSessionId = function() {
    return Math.random().toString().substr(2, 22);
  };
  SDPUtils.writeSessionBoilerplate = function(sessId, sessVer, sessUser) {
    let sessionId;
    const version = sessVer !== undefined ? sessVer : 2;
    if (sessId) {
      sessionId = sessId;
    } else {
      sessionId = SDPUtils.generateSessionId();
    }
    const user = sessUser || "thisisadapterortc";
    return `v=0\r
` + "o=" + user + " " + sessionId + " " + version + ` IN IP4 127.0.0.1\r
` + `s=-\r
` + `t=0 0\r
`;
  };
  SDPUtils.getDirection = function(mediaSection, sessionpart) {
    const lines = SDPUtils.splitLines(mediaSection);
    for (let i = 0;i < lines.length; i++) {
      switch (lines[i]) {
        case "a=sendrecv":
        case "a=sendonly":
        case "a=recvonly":
        case "a=inactive":
          return lines[i].substring(2);
        default:
      }
    }
    if (sessionpart) {
      return SDPUtils.getDirection(sessionpart);
    }
    return "sendrecv";
  };
  SDPUtils.getKind = function(mediaSection) {
    const lines = SDPUtils.splitLines(mediaSection);
    const mline = lines[0].split(" ");
    return mline[0].substring(2);
  };
  SDPUtils.isRejected = function(mediaSection) {
    return mediaSection.split(" ", 2)[1] === "0";
  };
  SDPUtils.parseMLine = function(mediaSection) {
    const lines = SDPUtils.splitLines(mediaSection);
    const parts = lines[0].substring(2).split(" ");
    return {
      kind: parts[0],
      port: parseInt(parts[1], 10),
      protocol: parts[2],
      fmt: parts.slice(3).join(" ")
    };
  };
  SDPUtils.parseOLine = function(mediaSection) {
    const line = SDPUtils.matchPrefix(mediaSection, "o=")[0];
    const parts = line.substring(2).split(" ");
    return {
      username: parts[0],
      sessionId: parts[1],
      sessionVersion: parseInt(parts[2], 10),
      netType: parts[3],
      addressType: parts[4],
      address: parts[5]
    };
  };
  SDPUtils.isValidSDP = function(blob) {
    if (typeof blob !== "string" || blob.length === 0) {
      return false;
    }
    const lines = SDPUtils.splitLines(blob);
    for (let i = 0;i < lines.length; i++) {
      if (lines[i].length < 2 || lines[i].charAt(1) !== "=") {
        return false;
      }
    }
    return true;
  };
  if (typeof module === "object") {
    module.exports = SDPUtils;
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/common_shim.js
var require_common_shim = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.removeExtmapAllowMixed = removeExtmapAllowMixed;
  exports.shimAddIceCandidateNullOrEmpty = shimAddIceCandidateNullOrEmpty;
  exports.shimConnectionState = shimConnectionState;
  exports.shimMaxMessageSize = shimMaxMessageSize;
  exports.shimParameterlessSetLocalDescription = shimParameterlessSetLocalDescription;
  exports.shimRTCIceCandidate = shimRTCIceCandidate;
  exports.shimRTCIceCandidateRelayProtocol = shimRTCIceCandidateRelayProtocol;
  exports.shimSendThrowTypeError = shimSendThrowTypeError;
  var _sdp = _interopRequireDefault(require_sdp());
  var utils = _interopRequireWildcard(require_utils());
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function _interopRequireDefault(e) {
    return e && e.__esModule ? e : { default: e };
  }
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  function shimRTCIceCandidate(window2) {
    if (!window2.RTCIceCandidate || window2.RTCIceCandidate && "foundation" in window2.RTCIceCandidate.prototype) {
      return;
    }
    var NativeRTCIceCandidate = window2.RTCIceCandidate;
    window2.RTCIceCandidate = function RTCIceCandidate(args) {
      if (_typeof(args) === "object" && args.candidate && args.candidate.indexOf("a=") === 0) {
        args = JSON.parse(JSON.stringify(args));
        args.candidate = args.candidate.substring(2);
      }
      if (args.candidate && args.candidate.length) {
        var nativeCandidate = new NativeRTCIceCandidate(args);
        var parsedCandidate = _sdp["default"].parseCandidate(args.candidate);
        for (var key in parsedCandidate) {
          if (!(key in nativeCandidate)) {
            Object.defineProperty(nativeCandidate, key, {
              value: parsedCandidate[key]
            });
          }
        }
        nativeCandidate.toJSON = function toJSON() {
          return {
            candidate: nativeCandidate.candidate,
            sdpMid: nativeCandidate.sdpMid,
            sdpMLineIndex: nativeCandidate.sdpMLineIndex,
            usernameFragment: nativeCandidate.usernameFragment
          };
        };
        return nativeCandidate;
      }
      return new NativeRTCIceCandidate(args);
    };
    window2.RTCIceCandidate.prototype = NativeRTCIceCandidate.prototype;
    utils.wrapPeerConnectionEvent(window2, "icecandidate", function(e) {
      if (e.candidate) {
        Object.defineProperty(e, "candidate", {
          value: new window2.RTCIceCandidate(e.candidate),
          writable: "false"
        });
      }
      return e;
    });
  }
  function shimRTCIceCandidateRelayProtocol(window2) {
    if (!window2.RTCIceCandidate || window2.RTCIceCandidate && "relayProtocol" in window2.RTCIceCandidate.prototype) {
      return;
    }
    utils.wrapPeerConnectionEvent(window2, "icecandidate", function(e) {
      if (e.candidate) {
        var parsedCandidate = _sdp["default"].parseCandidate(e.candidate.candidate);
        if (parsedCandidate.type === "relay") {
          e.candidate.relayProtocol = {
            0: "tls",
            1: "tcp",
            2: "udp"
          }[parsedCandidate.priority >> 24];
        }
      }
      return e;
    });
  }
  function shimMaxMessageSize(window2, browserDetails) {
    if (!window2.RTCPeerConnection) {
      return;
    }
    if (!("sctp" in window2.RTCPeerConnection.prototype)) {
      Object.defineProperty(window2.RTCPeerConnection.prototype, "sctp", {
        get: function get() {
          return typeof this._sctp === "undefined" ? null : this._sctp;
        }
      });
    }
    var sctpInDescription = function sctpInDescription2(description) {
      if (!description || !description.sdp) {
        return false;
      }
      var sections = _sdp["default"].splitSections(description.sdp);
      sections.shift();
      return sections.some(function(mediaSection) {
        var mLine = _sdp["default"].parseMLine(mediaSection);
        return mLine && mLine.kind === "application" && mLine.protocol.indexOf("SCTP") !== -1;
      });
    };
    var getRemoteFirefoxVersion = function getRemoteFirefoxVersion2(description) {
      var match = description.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);
      if (match === null || match.length < 2) {
        return -1;
      }
      var version = parseInt(match[1], 10);
      return version !== version ? -1 : version;
    };
    var getCanSendMaxMessageSize = function getCanSendMaxMessageSize2(remoteIsFirefox) {
      var canSendMaxMessageSize = 65536;
      if (browserDetails.browser === "firefox") {
        if (browserDetails.version < 57) {
          if (remoteIsFirefox === -1) {
            canSendMaxMessageSize = 16384;
          } else {
            canSendMaxMessageSize = 2147483637;
          }
        } else if (browserDetails.version < 60) {
          canSendMaxMessageSize = browserDetails.version === 57 ? 65535 : 65536;
        } else {
          canSendMaxMessageSize = 2147483637;
        }
      }
      return canSendMaxMessageSize;
    };
    var getMaxMessageSize = function getMaxMessageSize2(description, remoteIsFirefox) {
      var maxMessageSize = 65536;
      if (browserDetails.browser === "firefox" && browserDetails.version === 57) {
        maxMessageSize = 65535;
      }
      var match = _sdp["default"].matchPrefix(description.sdp, "a=max-message-size:");
      if (match.length > 0) {
        maxMessageSize = parseInt(match[0].substring(19), 10);
      } else if (browserDetails.browser === "firefox" && remoteIsFirefox !== -1) {
        maxMessageSize = 2147483637;
      }
      return maxMessageSize;
    };
    var origSetRemoteDescription = window2.RTCPeerConnection.prototype.setRemoteDescription;
    window2.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
      this._sctp = null;
      if (browserDetails.browser === "chrome" && browserDetails.version >= 76) {
        var _this$getConfiguratio = this.getConfiguration(), sdpSemantics = _this$getConfiguratio.sdpSemantics;
        if (sdpSemantics === "plan-b") {
          Object.defineProperty(this, "sctp", {
            get: function get() {
              return typeof this._sctp === "undefined" ? null : this._sctp;
            },
            enumerable: true,
            configurable: true
          });
        }
      }
      if (sctpInDescription(arguments[0])) {
        var isFirefox = getRemoteFirefoxVersion(arguments[0]);
        var canSendMMS = getCanSendMaxMessageSize(isFirefox);
        var remoteMMS = getMaxMessageSize(arguments[0], isFirefox);
        var maxMessageSize;
        if (canSendMMS === 0 && remoteMMS === 0) {
          maxMessageSize = Number.POSITIVE_INFINITY;
        } else if (canSendMMS === 0 || remoteMMS === 0) {
          maxMessageSize = Math.max(canSendMMS, remoteMMS);
        } else {
          maxMessageSize = Math.min(canSendMMS, remoteMMS);
        }
        var sctp = {};
        Object.defineProperty(sctp, "maxMessageSize", {
          get: function get() {
            return maxMessageSize;
          }
        });
        this._sctp = sctp;
      }
      return origSetRemoteDescription.apply(this, arguments);
    };
  }
  function shimSendThrowTypeError(window2) {
    if (!(window2.RTCPeerConnection && ("createDataChannel" in window2.RTCPeerConnection.prototype))) {
      return;
    }
    function wrapDcSend(dc, pc) {
      var origDataChannelSend = dc.send;
      dc.send = function send() {
        var data = arguments[0];
        var length = data.length || data.size || data.byteLength;
        if (dc.readyState === "open" && pc.sctp && length > pc.sctp.maxMessageSize) {
          throw new TypeError("Message too large (can send a maximum of " + pc.sctp.maxMessageSize + " bytes)");
        }
        return origDataChannelSend.apply(dc, arguments);
      };
    }
    var origCreateDataChannel = window2.RTCPeerConnection.prototype.createDataChannel;
    window2.RTCPeerConnection.prototype.createDataChannel = function createDataChannel() {
      var dataChannel = origCreateDataChannel.apply(this, arguments);
      wrapDcSend(dataChannel, this);
      return dataChannel;
    };
    utils.wrapPeerConnectionEvent(window2, "datachannel", function(e) {
      wrapDcSend(e.channel, e.target);
      return e;
    });
  }
  function shimConnectionState(window2) {
    if (!window2.RTCPeerConnection || "connectionState" in window2.RTCPeerConnection.prototype) {
      return;
    }
    var proto = window2.RTCPeerConnection.prototype;
    Object.defineProperty(proto, "connectionState", {
      get: function get() {
        return {
          completed: "connected",
          checking: "connecting"
        }[this.iceConnectionState] || this.iceConnectionState;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(proto, "onconnectionstatechange", {
      get: function get() {
        return this._onconnectionstatechange || null;
      },
      set: function set(cb) {
        if (this._onconnectionstatechange) {
          this.removeEventListener("connectionstatechange", this._onconnectionstatechange);
          delete this._onconnectionstatechange;
        }
        if (cb) {
          this.addEventListener("connectionstatechange", this._onconnectionstatechange = cb);
        }
      },
      enumerable: true,
      configurable: true
    });
    ["setLocalDescription", "setRemoteDescription"].forEach(function(method) {
      var origMethod = proto[method];
      proto[method] = function() {
        if (!this._connectionstatechangepoly) {
          this._connectionstatechangepoly = function(e) {
            var pc = e.target;
            if (pc._lastConnectionState !== pc.connectionState) {
              pc._lastConnectionState = pc.connectionState;
              var newEvent = new Event("connectionstatechange", e);
              pc.dispatchEvent(newEvent);
            }
            return e;
          };
          this.addEventListener("iceconnectionstatechange", this._connectionstatechangepoly);
        }
        return origMethod.apply(this, arguments);
      };
    });
  }
  function removeExtmapAllowMixed(window2, browserDetails) {
    if (!window2.RTCPeerConnection) {
      return;
    }
    if (browserDetails.browser === "chrome" && browserDetails.version >= 71) {
      return;
    }
    if (browserDetails.browser === "safari" && browserDetails._safariVersion >= 13.1) {
      return;
    }
    var nativeSRD = window2.RTCPeerConnection.prototype.setRemoteDescription;
    window2.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription(desc) {
      if (desc && desc.sdp && desc.sdp.indexOf(`
a=extmap-allow-mixed`) !== -1) {
        var sdp = desc.sdp.split(`
`).filter(function(line) {
          return line.trim() !== "a=extmap-allow-mixed";
        }).join(`
`);
        if (window2.RTCSessionDescription && desc instanceof window2.RTCSessionDescription) {
          arguments[0] = new window2.RTCSessionDescription({
            type: desc.type,
            sdp
          });
        } else {
          desc.sdp = sdp;
        }
      }
      return nativeSRD.apply(this, arguments);
    };
  }
  function shimAddIceCandidateNullOrEmpty(window2, browserDetails) {
    if (!(window2.RTCPeerConnection && window2.RTCPeerConnection.prototype)) {
      return;
    }
    var nativeAddIceCandidate = window2.RTCPeerConnection.prototype.addIceCandidate;
    if (!nativeAddIceCandidate || nativeAddIceCandidate.length === 0) {
      return;
    }
    window2.RTCPeerConnection.prototype.addIceCandidate = function addIceCandidate() {
      if (!arguments[0]) {
        if (arguments[1]) {
          arguments[1].apply(null);
        }
        return Promise.resolve();
      }
      if ((browserDetails.browser === "chrome" && browserDetails.version < 78 || browserDetails.browser === "firefox" && browserDetails.version < 68 || browserDetails.browser === "safari") && arguments[0] && arguments[0].candidate === "") {
        return Promise.resolve();
      }
      return nativeAddIceCandidate.apply(this, arguments);
    };
  }
  function shimParameterlessSetLocalDescription(window2, browserDetails) {
    if (!(window2.RTCPeerConnection && window2.RTCPeerConnection.prototype)) {
      return;
    }
    var nativeSetLocalDescription = window2.RTCPeerConnection.prototype.setLocalDescription;
    if (!nativeSetLocalDescription || nativeSetLocalDescription.length === 0) {
      return;
    }
    window2.RTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
      var _this = this;
      var desc = arguments[0] || {};
      if (_typeof(desc) !== "object" || desc.type && desc.sdp) {
        return nativeSetLocalDescription.apply(this, arguments);
      }
      desc = {
        type: desc.type,
        sdp: desc.sdp
      };
      if (!desc.type) {
        switch (this.signalingState) {
          case "stable":
          case "have-local-offer":
          case "have-remote-pranswer":
            desc.type = "offer";
            break;
          default:
            desc.type = "answer";
            break;
        }
      }
      if (desc.sdp || desc.type !== "offer" && desc.type !== "answer") {
        return nativeSetLocalDescription.apply(this, [desc]);
      }
      var func = desc.type === "offer" ? this.createOffer : this.createAnswer;
      return func.apply(this).then(function(d) {
        return nativeSetLocalDescription.apply(_this, [d]);
      });
    };
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/adapter_factory.js
var require_adapter_factory = __commonJS((exports) => {
  function _typeof(o) {
    "@babel/helpers - typeof";
    return _typeof = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(o2) {
      return typeof o2;
    } : function(o2) {
      return o2 && typeof Symbol == "function" && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
    }, _typeof(o);
  }
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.adapterFactory = adapterFactory;
  var utils = _interopRequireWildcard(require_utils());
  var chromeShim = _interopRequireWildcard(require_chrome_shim());
  var firefoxShim = _interopRequireWildcard(require_firefox_shim());
  var safariShim = _interopRequireWildcard(require_safari_shim());
  var commonShim = _interopRequireWildcard(require_common_shim());
  var sdp = _interopRequireWildcard(require_sdp());
  function _getRequireWildcardCache(e) {
    if (typeof WeakMap != "function")
      return null;
    var r = new WeakMap, t = new WeakMap;
    return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
      return e2 ? t : r;
    })(e);
  }
  function _interopRequireWildcard(e, r) {
    if (!r && e && e.__esModule)
      return e;
    if (e === null || _typeof(e) != "object" && typeof e != "function")
      return { default: e };
    var t = _getRequireWildcardCache(r);
    if (t && t.has(e))
      return t.get(e);
    var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var u in e)
      if (u !== "default" && {}.hasOwnProperty.call(e, u)) {
        var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
        i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
      }
    return n["default"] = e, t && t.set(e, n), n;
  }
  function adapterFactory() {
    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {}, window2 = _ref.window;
    var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {
      shimChrome: true,
      shimFirefox: true,
      shimSafari: true
    };
    var logging = utils.log;
    var browserDetails = utils.detectBrowser(window2);
    var adapter = {
      browserDetails,
      commonShim,
      extractVersion: utils.extractVersion,
      disableLog: utils.disableLog,
      disableWarnings: utils.disableWarnings,
      sdp
    };
    switch (browserDetails.browser) {
      case "chrome":
        if (!chromeShim || !chromeShim.shimPeerConnection || !options.shimChrome) {
          logging("Chrome shim is not included in this adapter release.");
          return adapter;
        }
        if (browserDetails.version === null) {
          logging("Chrome shim can not determine version, not shimming.");
          return adapter;
        }
        logging("adapter.js shimming chrome.");
        adapter.browserShim = chromeShim;
        commonShim.shimAddIceCandidateNullOrEmpty(window2, browserDetails);
        commonShim.shimParameterlessSetLocalDescription(window2, browserDetails);
        chromeShim.shimGetUserMedia(window2, browserDetails);
        chromeShim.shimMediaStream(window2, browserDetails);
        chromeShim.shimPeerConnection(window2, browserDetails);
        chromeShim.shimOnTrack(window2, browserDetails);
        chromeShim.shimAddTrackRemoveTrack(window2, browserDetails);
        chromeShim.shimGetSendersWithDtmf(window2, browserDetails);
        chromeShim.shimSenderReceiverGetStats(window2, browserDetails);
        chromeShim.fixNegotiationNeeded(window2, browserDetails);
        commonShim.shimRTCIceCandidate(window2, browserDetails);
        commonShim.shimRTCIceCandidateRelayProtocol(window2, browserDetails);
        commonShim.shimConnectionState(window2, browserDetails);
        commonShim.shimMaxMessageSize(window2, browserDetails);
        commonShim.shimSendThrowTypeError(window2, browserDetails);
        commonShim.removeExtmapAllowMixed(window2, browserDetails);
        break;
      case "firefox":
        if (!firefoxShim || !firefoxShim.shimPeerConnection || !options.shimFirefox) {
          logging("Firefox shim is not included in this adapter release.");
          return adapter;
        }
        logging("adapter.js shimming firefox.");
        adapter.browserShim = firefoxShim;
        commonShim.shimAddIceCandidateNullOrEmpty(window2, browserDetails);
        commonShim.shimParameterlessSetLocalDescription(window2, browserDetails);
        firefoxShim.shimGetUserMedia(window2, browserDetails);
        firefoxShim.shimPeerConnection(window2, browserDetails);
        firefoxShim.shimOnTrack(window2, browserDetails);
        firefoxShim.shimRemoveStream(window2, browserDetails);
        firefoxShim.shimSenderGetStats(window2, browserDetails);
        firefoxShim.shimReceiverGetStats(window2, browserDetails);
        firefoxShim.shimRTCDataChannel(window2, browserDetails);
        firefoxShim.shimAddTransceiver(window2, browserDetails);
        firefoxShim.shimGetParameters(window2, browserDetails);
        firefoxShim.shimCreateOffer(window2, browserDetails);
        firefoxShim.shimCreateAnswer(window2, browserDetails);
        commonShim.shimRTCIceCandidate(window2, browserDetails);
        commonShim.shimConnectionState(window2, browserDetails);
        commonShim.shimMaxMessageSize(window2, browserDetails);
        commonShim.shimSendThrowTypeError(window2, browserDetails);
        break;
      case "safari":
        if (!safariShim || !options.shimSafari) {
          logging("Safari shim is not included in this adapter release.");
          return adapter;
        }
        logging("adapter.js shimming safari.");
        adapter.browserShim = safariShim;
        commonShim.shimAddIceCandidateNullOrEmpty(window2, browserDetails);
        commonShim.shimParameterlessSetLocalDescription(window2, browserDetails);
        safariShim.shimRTCIceServerUrls(window2, browserDetails);
        safariShim.shimCreateOfferLegacy(window2, browserDetails);
        safariShim.shimCallbacksAPI(window2, browserDetails);
        safariShim.shimLocalStreamsAPI(window2, browserDetails);
        safariShim.shimRemoteStreamsAPI(window2, browserDetails);
        safariShim.shimTrackEventTransceiver(window2, browserDetails);
        safariShim.shimGetUserMedia(window2, browserDetails);
        safariShim.shimAudioContext(window2, browserDetails);
        commonShim.shimRTCIceCandidate(window2, browserDetails);
        commonShim.shimRTCIceCandidateRelayProtocol(window2, browserDetails);
        commonShim.shimMaxMessageSize(window2, browserDetails);
        commonShim.shimSendThrowTypeError(window2, browserDetails);
        commonShim.removeExtmapAllowMixed(window2, browserDetails);
        break;
      default:
        logging("Unsupported browser!");
        break;
    }
    return adapter;
  }
});

// ../node_modules/.bun/webrtc-adapter@9.0.3/node_modules/webrtc-adapter/dist/adapter_core.js
var require_adapter_core = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = undefined;
  var _adapter_factory = require_adapter_factory();
  var adapter = (0, _adapter_factory.adapterFactory)({
    window: typeof window === "undefined" ? undefined : window
  });
  var _default = exports.default = adapter;
});

// ../node_modules/.bun/eventemitter3@4.0.7/node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS((exports, module) => {
  var has = Object.prototype.hasOwnProperty;
  var prefix = "~";
  function Events() {}
  if (Object.create) {
    Events.prototype = Object.create(null);
    if (!new Events().__proto__)
      prefix = false;
  }
  function EE(fn, context, once) {
    this.fn = fn;
    this.context = context;
    this.once = once || false;
  }
  function addListener(emitter, event, fn, context, once) {
    if (typeof fn !== "function") {
      throw new TypeError("The listener must be a function");
    }
    var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
    if (!emitter._events[evt])
      emitter._events[evt] = listener, emitter._eventsCount++;
    else if (!emitter._events[evt].fn)
      emitter._events[evt].push(listener);
    else
      emitter._events[evt] = [emitter._events[evt], listener];
    return emitter;
  }
  function clearEvent(emitter, evt) {
    if (--emitter._eventsCount === 0)
      emitter._events = new Events;
    else
      delete emitter._events[evt];
  }
  function EventEmitter() {
    this._events = new Events;
    this._eventsCount = 0;
  }
  EventEmitter.prototype.eventNames = function eventNames() {
    var names = [], events, name;
    if (this._eventsCount === 0)
      return names;
    for (name in events = this._events) {
      if (has.call(events, name))
        names.push(prefix ? name.slice(1) : name);
    }
    if (Object.getOwnPropertySymbols) {
      return names.concat(Object.getOwnPropertySymbols(events));
    }
    return names;
  };
  EventEmitter.prototype.listeners = function listeners(event) {
    var evt = prefix ? prefix + event : event, handlers = this._events[evt];
    if (!handlers)
      return [];
    if (handlers.fn)
      return [handlers.fn];
    for (var i = 0, l = handlers.length, ee = new Array(l);i < l; i++) {
      ee[i] = handlers[i].fn;
    }
    return ee;
  };
  EventEmitter.prototype.listenerCount = function listenerCount(event) {
    var evt = prefix ? prefix + event : event, listeners = this._events[evt];
    if (!listeners)
      return 0;
    if (listeners.fn)
      return 1;
    return listeners.length;
  };
  EventEmitter.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
    var evt = prefix ? prefix + event : event;
    if (!this._events[evt])
      return false;
    var listeners = this._events[evt], len = arguments.length, args, i;
    if (listeners.fn) {
      if (listeners.once)
        this.removeListener(event, listeners.fn, undefined, true);
      switch (len) {
        case 1:
          return listeners.fn.call(listeners.context), true;
        case 2:
          return listeners.fn.call(listeners.context, a1), true;
        case 3:
          return listeners.fn.call(listeners.context, a1, a2), true;
        case 4:
          return listeners.fn.call(listeners.context, a1, a2, a3), true;
        case 5:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
        case 6:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
      }
      for (i = 1, args = new Array(len - 1);i < len; i++) {
        args[i - 1] = arguments[i];
      }
      listeners.fn.apply(listeners.context, args);
    } else {
      var length = listeners.length, j;
      for (i = 0;i < length; i++) {
        if (listeners[i].once)
          this.removeListener(event, listeners[i].fn, undefined, true);
        switch (len) {
          case 1:
            listeners[i].fn.call(listeners[i].context);
            break;
          case 2:
            listeners[i].fn.call(listeners[i].context, a1);
            break;
          case 3:
            listeners[i].fn.call(listeners[i].context, a1, a2);
            break;
          case 4:
            listeners[i].fn.call(listeners[i].context, a1, a2, a3);
            break;
          default:
            if (!args)
              for (j = 1, args = new Array(len - 1);j < len; j++) {
                args[j - 1] = arguments[j];
              }
            listeners[i].fn.apply(listeners[i].context, args);
        }
      }
    }
    return true;
  };
  EventEmitter.prototype.on = function on(event, fn, context) {
    return addListener(this, event, fn, context, false);
  };
  EventEmitter.prototype.once = function once(event, fn, context) {
    return addListener(this, event, fn, context, true);
  };
  EventEmitter.prototype.removeListener = function removeListener(event, fn, context, once) {
    var evt = prefix ? prefix + event : event;
    if (!this._events[evt])
      return this;
    if (!fn) {
      clearEvent(this, evt);
      return this;
    }
    var listeners = this._events[evt];
    if (listeners.fn) {
      if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
        clearEvent(this, evt);
      }
    } else {
      for (var i = 0, events = [], length = listeners.length;i < length; i++) {
        if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
          events.push(listeners[i]);
        }
      }
      if (events.length)
        this._events[evt] = events.length === 1 ? events[0] : events;
      else
        clearEvent(this, evt);
    }
    return this;
  };
  EventEmitter.prototype.removeAllListeners = function removeAllListeners(event) {
    var evt;
    if (event) {
      evt = prefix ? prefix + event : event;
      if (this._events[evt])
        clearEvent(this, evt);
    } else {
      this._events = new Events;
      this._eventsCount = 0;
    }
    return this;
  };
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
  EventEmitter.prototype.addListener = EventEmitter.prototype.on;
  EventEmitter.prefixed = prefix;
  EventEmitter.EventEmitter = EventEmitter;
  if (typeof module !== "undefined") {
    module.exports = EventEmitter;
  }
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/utils/int.js
var require_int = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getUint64 = exports.getInt64 = exports.setInt64 = exports.setUint64 = exports.UINT32_MAX = undefined;
  exports.UINT32_MAX = 4294967295;
  function setUint64(view, offset, value) {
    const high = value / 4294967296;
    const low = value;
    view.setUint32(offset, high);
    view.setUint32(offset + 4, low);
  }
  exports.setUint64 = setUint64;
  function setInt64(view, offset, value) {
    const high = Math.floor(value / 4294967296);
    const low = value;
    view.setUint32(offset, high);
    view.setUint32(offset + 4, low);
  }
  exports.setInt64 = setInt64;
  function getInt64(view, offset) {
    const high = view.getInt32(offset);
    const low = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }
  exports.getInt64 = getInt64;
  function getUint64(view, offset) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }
  exports.getUint64 = getUint64;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/utils/utf8.js
var require_utf8 = __commonJS((exports) => {
  var _a2;
  var _b2;
  var _c;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.utf8DecodeTD = exports.TEXT_DECODER_THRESHOLD = exports.utf8DecodeJs = exports.utf8EncodeTE = exports.TEXT_ENCODER_THRESHOLD = exports.utf8EncodeJs = exports.utf8Count = undefined;
  var int_1 = require_int();
  var TEXT_ENCODING_AVAILABLE = (typeof process === "undefined" || ((_a2 = process === null || process === undefined ? undefined : process.env) === null || _a2 === undefined ? undefined : _a2["TEXT_ENCODING"]) !== "never") && typeof TextEncoder !== "undefined" && typeof TextDecoder !== "undefined";
  function utf8Count(str) {
    const strLength = str.length;
    let byteLength = 0;
    let pos = 0;
    while (pos < strLength) {
      let value = str.charCodeAt(pos++);
      if ((value & 4294967168) === 0) {
        byteLength++;
        continue;
      } else if ((value & 4294965248) === 0) {
        byteLength += 2;
      } else {
        if (value >= 55296 && value <= 56319) {
          if (pos < strLength) {
            const extra = str.charCodeAt(pos);
            if ((extra & 64512) === 56320) {
              ++pos;
              value = ((value & 1023) << 10) + (extra & 1023) + 65536;
            }
          }
        }
        if ((value & 4294901760) === 0) {
          byteLength += 3;
        } else {
          byteLength += 4;
        }
      }
    }
    return byteLength;
  }
  exports.utf8Count = utf8Count;
  function utf8EncodeJs(str, output, outputOffset) {
    const strLength = str.length;
    let offset = outputOffset;
    let pos = 0;
    while (pos < strLength) {
      let value = str.charCodeAt(pos++);
      if ((value & 4294967168) === 0) {
        output[offset++] = value;
        continue;
      } else if ((value & 4294965248) === 0) {
        output[offset++] = value >> 6 & 31 | 192;
      } else {
        if (value >= 55296 && value <= 56319) {
          if (pos < strLength) {
            const extra = str.charCodeAt(pos);
            if ((extra & 64512) === 56320) {
              ++pos;
              value = ((value & 1023) << 10) + (extra & 1023) + 65536;
            }
          }
        }
        if ((value & 4294901760) === 0) {
          output[offset++] = value >> 12 & 15 | 224;
          output[offset++] = value >> 6 & 63 | 128;
        } else {
          output[offset++] = value >> 18 & 7 | 240;
          output[offset++] = value >> 12 & 63 | 128;
          output[offset++] = value >> 6 & 63 | 128;
        }
      }
      output[offset++] = value & 63 | 128;
    }
  }
  exports.utf8EncodeJs = utf8EncodeJs;
  var sharedTextEncoder = TEXT_ENCODING_AVAILABLE ? new TextEncoder : undefined;
  exports.TEXT_ENCODER_THRESHOLD = !TEXT_ENCODING_AVAILABLE ? int_1.UINT32_MAX : typeof process !== "undefined" && ((_b2 = process === null || process === undefined ? undefined : process.env) === null || _b2 === undefined ? undefined : _b2["TEXT_ENCODING"]) !== "force" ? 200 : 0;
  function utf8EncodeTEencode(str, output, outputOffset) {
    output.set(sharedTextEncoder.encode(str), outputOffset);
  }
  function utf8EncodeTEencodeInto(str, output, outputOffset) {
    sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
  }
  exports.utf8EncodeTE = (sharedTextEncoder === null || sharedTextEncoder === undefined ? undefined : sharedTextEncoder.encodeInto) ? utf8EncodeTEencodeInto : utf8EncodeTEencode;
  var CHUNK_SIZE2 = 4096;
  function utf8DecodeJs(bytes, inputOffset, byteLength) {
    let offset = inputOffset;
    const end = offset + byteLength;
    const units = [];
    let result = "";
    while (offset < end) {
      const byte1 = bytes[offset++];
      if ((byte1 & 128) === 0) {
        units.push(byte1);
      } else if ((byte1 & 224) === 192) {
        const byte2 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 6 | byte2);
      } else if ((byte1 & 240) === 224) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
      } else if ((byte1 & 248) === 240) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        const byte4 = bytes[offset++] & 63;
        let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
        if (unit > 65535) {
          unit -= 65536;
          units.push(unit >>> 10 & 1023 | 55296);
          unit = 56320 | unit & 1023;
        }
        units.push(unit);
      } else {
        units.push(byte1);
      }
      if (units.length >= CHUNK_SIZE2) {
        result += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    if (units.length > 0) {
      result += String.fromCharCode(...units);
    }
    return result;
  }
  exports.utf8DecodeJs = utf8DecodeJs;
  var sharedTextDecoder = TEXT_ENCODING_AVAILABLE ? new TextDecoder : null;
  exports.TEXT_DECODER_THRESHOLD = !TEXT_ENCODING_AVAILABLE ? int_1.UINT32_MAX : typeof process !== "undefined" && ((_c = process === null || process === undefined ? undefined : process.env) === null || _c === undefined ? undefined : _c["TEXT_DECODER"]) !== "force" ? 200 : 0;
  function utf8DecodeTD(bytes, inputOffset, byteLength) {
    const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
    return sharedTextDecoder.decode(stringBytes);
  }
  exports.utf8DecodeTD = utf8DecodeTD;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/ExtData.js
var require_ExtData = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ExtData = undefined;

  class ExtData {
    constructor(type, data) {
      this.type = type;
      this.data = data;
    }
  }
  exports.ExtData = ExtData;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/DecodeError.js
var require_DecodeError = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DecodeError = undefined;

  class DecodeError extends Error {
    constructor(message) {
      super(message);
      const proto = Object.create(DecodeError.prototype);
      Object.setPrototypeOf(this, proto);
      Object.defineProperty(this, "name", {
        configurable: true,
        enumerable: false,
        value: DecodeError.name
      });
    }
  }
  exports.DecodeError = DecodeError;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/timestamp.js
var require_timestamp = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.timestampExtension = exports.decodeTimestampExtension = exports.decodeTimestampToTimeSpec = exports.encodeTimestampExtension = exports.encodeDateToTimeSpec = exports.encodeTimeSpecToTimestamp = exports.EXT_TIMESTAMP = undefined;
  var DecodeError_1 = require_DecodeError();
  var int_1 = require_int();
  exports.EXT_TIMESTAMP = -1;
  var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
  var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
  function encodeTimeSpecToTimestamp({ sec, nsec }) {
    if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
      if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
        const rv = new Uint8Array(4);
        const view = new DataView(rv.buffer);
        view.setUint32(0, sec);
        return rv;
      } else {
        const secHigh = sec / 4294967296;
        const secLow = sec & 4294967295;
        const rv = new Uint8Array(8);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec << 2 | secHigh & 3);
        view.setUint32(4, secLow);
        return rv;
      }
    } else {
      const rv = new Uint8Array(12);
      const view = new DataView(rv.buffer);
      view.setUint32(0, nsec);
      (0, int_1.setInt64)(view, 4, sec);
      return rv;
    }
  }
  exports.encodeTimeSpecToTimestamp = encodeTimeSpecToTimestamp;
  function encodeDateToTimeSpec(date) {
    const msec = date.getTime();
    const sec = Math.floor(msec / 1000);
    const nsec = (msec - sec * 1000) * 1e6;
    const nsecInSec = Math.floor(nsec / 1e9);
    return {
      sec: sec + nsecInSec,
      nsec: nsec - nsecInSec * 1e9
    };
  }
  exports.encodeDateToTimeSpec = encodeDateToTimeSpec;
  function encodeTimestampExtension(object) {
    if (object instanceof Date) {
      const timeSpec = encodeDateToTimeSpec(object);
      return encodeTimeSpecToTimestamp(timeSpec);
    } else {
      return null;
    }
  }
  exports.encodeTimestampExtension = encodeTimestampExtension;
  function decodeTimestampToTimeSpec(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (data.byteLength) {
      case 4: {
        const sec = view.getUint32(0);
        const nsec = 0;
        return { sec, nsec };
      }
      case 8: {
        const nsec30AndSecHigh2 = view.getUint32(0);
        const secLow32 = view.getUint32(4);
        const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
        const nsec = nsec30AndSecHigh2 >>> 2;
        return { sec, nsec };
      }
      case 12: {
        const sec = (0, int_1.getInt64)(view, 4);
        const nsec = view.getUint32(0);
        return { sec, nsec };
      }
      default:
        throw new DecodeError_1.DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
    }
  }
  exports.decodeTimestampToTimeSpec = decodeTimestampToTimeSpec;
  function decodeTimestampExtension(data) {
    const timeSpec = decodeTimestampToTimeSpec(data);
    return new Date(timeSpec.sec * 1000 + timeSpec.nsec / 1e6);
  }
  exports.decodeTimestampExtension = decodeTimestampExtension;
  exports.timestampExtension = {
    type: exports.EXT_TIMESTAMP,
    encode: encodeTimestampExtension,
    decode: decodeTimestampExtension
  };
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/ExtensionCodec.js
var require_ExtensionCodec = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ExtensionCodec = undefined;
  var ExtData_1 = require_ExtData();
  var timestamp_1 = require_timestamp();

  class ExtensionCodec {
    constructor() {
      this.builtInEncoders = [];
      this.builtInDecoders = [];
      this.encoders = [];
      this.decoders = [];
      this.register(timestamp_1.timestampExtension);
    }
    register({ type, encode, decode }) {
      if (type >= 0) {
        this.encoders[type] = encode;
        this.decoders[type] = decode;
      } else {
        const index = 1 + type;
        this.builtInEncoders[index] = encode;
        this.builtInDecoders[index] = decode;
      }
    }
    tryToEncode(object, context) {
      for (let i = 0;i < this.builtInEncoders.length; i++) {
        const encodeExt = this.builtInEncoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = -1 - i;
            return new ExtData_1.ExtData(type, data);
          }
        }
      }
      for (let i = 0;i < this.encoders.length; i++) {
        const encodeExt = this.encoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = i;
            return new ExtData_1.ExtData(type, data);
          }
        }
      }
      if (object instanceof ExtData_1.ExtData) {
        return object;
      }
      return null;
    }
    decode(data, type, context) {
      const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
      if (decodeExt) {
        return decodeExt(data, type, context);
      } else {
        return new ExtData_1.ExtData(type, data);
      }
    }
  }
  exports.ExtensionCodec = ExtensionCodec;
  ExtensionCodec.defaultCodec = new ExtensionCodec;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/utils/typedArrays.js
var require_typedArrays = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.createDataView = exports.ensureUint8Array = undefined;
  function ensureUint8Array(buffer) {
    if (buffer instanceof Uint8Array) {
      return buffer;
    } else if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    } else {
      return Uint8Array.from(buffer);
    }
  }
  exports.ensureUint8Array = ensureUint8Array;
  function createDataView(buffer) {
    if (buffer instanceof ArrayBuffer) {
      return new DataView(buffer);
    }
    const bufferView = ensureUint8Array(buffer);
    return new DataView(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
  }
  exports.createDataView = createDataView;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/Encoder.js
var require_Encoder = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Encoder = exports.DEFAULT_INITIAL_BUFFER_SIZE = exports.DEFAULT_MAX_DEPTH = undefined;
  var utf8_1 = require_utf8();
  var ExtensionCodec_1 = require_ExtensionCodec();
  var int_1 = require_int();
  var typedArrays_1 = require_typedArrays();
  exports.DEFAULT_MAX_DEPTH = 100;
  exports.DEFAULT_INITIAL_BUFFER_SIZE = 2048;

  class Encoder {
    constructor(extensionCodec = ExtensionCodec_1.ExtensionCodec.defaultCodec, context = undefined, maxDepth = exports.DEFAULT_MAX_DEPTH, initialBufferSize = exports.DEFAULT_INITIAL_BUFFER_SIZE, sortKeys = false, forceFloat32 = false, ignoreUndefined = false, forceIntegerToFloat = false) {
      this.extensionCodec = extensionCodec;
      this.context = context;
      this.maxDepth = maxDepth;
      this.initialBufferSize = initialBufferSize;
      this.sortKeys = sortKeys;
      this.forceFloat32 = forceFloat32;
      this.ignoreUndefined = ignoreUndefined;
      this.forceIntegerToFloat = forceIntegerToFloat;
      this.pos = 0;
      this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
      this.bytes = new Uint8Array(this.view.buffer);
    }
    reinitializeState() {
      this.pos = 0;
    }
    encodeSharedRef(object) {
      this.reinitializeState();
      this.doEncode(object, 1);
      return this.bytes.subarray(0, this.pos);
    }
    encode(object) {
      this.reinitializeState();
      this.doEncode(object, 1);
      return this.bytes.slice(0, this.pos);
    }
    doEncode(object, depth) {
      if (depth > this.maxDepth) {
        throw new Error(`Too deep objects in depth ${depth}`);
      }
      if (object == null) {
        this.encodeNil();
      } else if (typeof object === "boolean") {
        this.encodeBoolean(object);
      } else if (typeof object === "number") {
        this.encodeNumber(object);
      } else if (typeof object === "string") {
        this.encodeString(object);
      } else {
        this.encodeObject(object, depth);
      }
    }
    ensureBufferSizeToWrite(sizeToWrite) {
      const requiredSize = this.pos + sizeToWrite;
      if (this.view.byteLength < requiredSize) {
        this.resizeBuffer(requiredSize * 2);
      }
    }
    resizeBuffer(newSize) {
      const newBuffer = new ArrayBuffer(newSize);
      const newBytes = new Uint8Array(newBuffer);
      const newView = new DataView(newBuffer);
      newBytes.set(this.bytes);
      this.view = newView;
      this.bytes = newBytes;
    }
    encodeNil() {
      this.writeU8(192);
    }
    encodeBoolean(object) {
      if (object === false) {
        this.writeU8(194);
      } else {
        this.writeU8(195);
      }
    }
    encodeNumber(object) {
      if (Number.isSafeInteger(object) && !this.forceIntegerToFloat) {
        if (object >= 0) {
          if (object < 128) {
            this.writeU8(object);
          } else if (object < 256) {
            this.writeU8(204);
            this.writeU8(object);
          } else if (object < 65536) {
            this.writeU8(205);
            this.writeU16(object);
          } else if (object < 4294967296) {
            this.writeU8(206);
            this.writeU32(object);
          } else {
            this.writeU8(207);
            this.writeU64(object);
          }
        } else {
          if (object >= -32) {
            this.writeU8(224 | object + 32);
          } else if (object >= -128) {
            this.writeU8(208);
            this.writeI8(object);
          } else if (object >= -32768) {
            this.writeU8(209);
            this.writeI16(object);
          } else if (object >= -2147483648) {
            this.writeU8(210);
            this.writeI32(object);
          } else {
            this.writeU8(211);
            this.writeI64(object);
          }
        }
      } else {
        if (this.forceFloat32) {
          this.writeU8(202);
          this.writeF32(object);
        } else {
          this.writeU8(203);
          this.writeF64(object);
        }
      }
    }
    writeStringHeader(byteLength) {
      if (byteLength < 32) {
        this.writeU8(160 + byteLength);
      } else if (byteLength < 256) {
        this.writeU8(217);
        this.writeU8(byteLength);
      } else if (byteLength < 65536) {
        this.writeU8(218);
        this.writeU16(byteLength);
      } else if (byteLength < 4294967296) {
        this.writeU8(219);
        this.writeU32(byteLength);
      } else {
        throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
      }
    }
    encodeString(object) {
      const maxHeaderSize = 1 + 4;
      const strLength = object.length;
      if (strLength > utf8_1.TEXT_ENCODER_THRESHOLD) {
        const byteLength = (0, utf8_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_1.utf8EncodeTE)(object, this.bytes, this.pos);
        this.pos += byteLength;
      } else {
        const byteLength = (0, utf8_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_1.utf8EncodeJs)(object, this.bytes, this.pos);
        this.pos += byteLength;
      }
    }
    encodeObject(object, depth) {
      const ext = this.extensionCodec.tryToEncode(object, this.context);
      if (ext != null) {
        this.encodeExtension(ext);
      } else if (Array.isArray(object)) {
        this.encodeArray(object, depth);
      } else if (ArrayBuffer.isView(object)) {
        this.encodeBinary(object);
      } else if (typeof object === "object") {
        this.encodeMap(object, depth);
      } else {
        throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
      }
    }
    encodeBinary(object) {
      const size = object.byteLength;
      if (size < 256) {
        this.writeU8(196);
        this.writeU8(size);
      } else if (size < 65536) {
        this.writeU8(197);
        this.writeU16(size);
      } else if (size < 4294967296) {
        this.writeU8(198);
        this.writeU32(size);
      } else {
        throw new Error(`Too large binary: ${size}`);
      }
      const bytes = (0, typedArrays_1.ensureUint8Array)(object);
      this.writeU8a(bytes);
    }
    encodeArray(object, depth) {
      const size = object.length;
      if (size < 16) {
        this.writeU8(144 + size);
      } else if (size < 65536) {
        this.writeU8(220);
        this.writeU16(size);
      } else if (size < 4294967296) {
        this.writeU8(221);
        this.writeU32(size);
      } else {
        throw new Error(`Too large array: ${size}`);
      }
      for (const item of object) {
        this.doEncode(item, depth + 1);
      }
    }
    countWithoutUndefined(object, keys) {
      let count = 0;
      for (const key of keys) {
        if (object[key] !== undefined) {
          count++;
        }
      }
      return count;
    }
    encodeMap(object, depth) {
      const keys = Object.keys(object);
      if (this.sortKeys) {
        keys.sort();
      }
      const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
      if (size < 16) {
        this.writeU8(128 + size);
      } else if (size < 65536) {
        this.writeU8(222);
        this.writeU16(size);
      } else if (size < 4294967296) {
        this.writeU8(223);
        this.writeU32(size);
      } else {
        throw new Error(`Too large map object: ${size}`);
      }
      for (const key of keys) {
        const value = object[key];
        if (!(this.ignoreUndefined && value === undefined)) {
          this.encodeString(key);
          this.doEncode(value, depth + 1);
        }
      }
    }
    encodeExtension(ext) {
      const size = ext.data.length;
      if (size === 1) {
        this.writeU8(212);
      } else if (size === 2) {
        this.writeU8(213);
      } else if (size === 4) {
        this.writeU8(214);
      } else if (size === 8) {
        this.writeU8(215);
      } else if (size === 16) {
        this.writeU8(216);
      } else if (size < 256) {
        this.writeU8(199);
        this.writeU8(size);
      } else if (size < 65536) {
        this.writeU8(200);
        this.writeU16(size);
      } else if (size < 4294967296) {
        this.writeU8(201);
        this.writeU32(size);
      } else {
        throw new Error(`Too large extension object: ${size}`);
      }
      this.writeI8(ext.type);
      this.writeU8a(ext.data);
    }
    writeU8(value) {
      this.ensureBufferSizeToWrite(1);
      this.view.setUint8(this.pos, value);
      this.pos++;
    }
    writeU8a(values) {
      const size = values.length;
      this.ensureBufferSizeToWrite(size);
      this.bytes.set(values, this.pos);
      this.pos += size;
    }
    writeI8(value) {
      this.ensureBufferSizeToWrite(1);
      this.view.setInt8(this.pos, value);
      this.pos++;
    }
    writeU16(value) {
      this.ensureBufferSizeToWrite(2);
      this.view.setUint16(this.pos, value);
      this.pos += 2;
    }
    writeI16(value) {
      this.ensureBufferSizeToWrite(2);
      this.view.setInt16(this.pos, value);
      this.pos += 2;
    }
    writeU32(value) {
      this.ensureBufferSizeToWrite(4);
      this.view.setUint32(this.pos, value);
      this.pos += 4;
    }
    writeI32(value) {
      this.ensureBufferSizeToWrite(4);
      this.view.setInt32(this.pos, value);
      this.pos += 4;
    }
    writeF32(value) {
      this.ensureBufferSizeToWrite(4);
      this.view.setFloat32(this.pos, value);
      this.pos += 4;
    }
    writeF64(value) {
      this.ensureBufferSizeToWrite(8);
      this.view.setFloat64(this.pos, value);
      this.pos += 8;
    }
    writeU64(value) {
      this.ensureBufferSizeToWrite(8);
      (0, int_1.setUint64)(this.view, this.pos, value);
      this.pos += 8;
    }
    writeI64(value) {
      this.ensureBufferSizeToWrite(8);
      (0, int_1.setInt64)(this.view, this.pos, value);
      this.pos += 8;
    }
  }
  exports.Encoder = Encoder;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/encode.js
var require_encode = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.encode = undefined;
  var Encoder_1 = require_Encoder();
  var defaultEncodeOptions = {};
  function encode(value, options = defaultEncodeOptions) {
    const encoder = new Encoder_1.Encoder(options.extensionCodec, options.context, options.maxDepth, options.initialBufferSize, options.sortKeys, options.forceFloat32, options.ignoreUndefined, options.forceIntegerToFloat);
    return encoder.encodeSharedRef(value);
  }
  exports.encode = encode;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/utils/prettyByte.js
var require_prettyByte = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.prettyByte = undefined;
  function prettyByte(byte) {
    return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
  }
  exports.prettyByte = prettyByte;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/CachedKeyDecoder.js
var require_CachedKeyDecoder = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.CachedKeyDecoder = undefined;
  var utf8_1 = require_utf8();
  var DEFAULT_MAX_KEY_LENGTH = 16;
  var DEFAULT_MAX_LENGTH_PER_KEY = 16;

  class CachedKeyDecoder {
    constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
      this.maxKeyLength = maxKeyLength;
      this.maxLengthPerKey = maxLengthPerKey;
      this.hit = 0;
      this.miss = 0;
      this.caches = [];
      for (let i = 0;i < this.maxKeyLength; i++) {
        this.caches.push([]);
      }
    }
    canBeCached(byteLength) {
      return byteLength > 0 && byteLength <= this.maxKeyLength;
    }
    find(bytes, inputOffset, byteLength) {
      const records = this.caches[byteLength - 1];
      FIND_CHUNK:
        for (const record of records) {
          const recordBytes = record.bytes;
          for (let j = 0;j < byteLength; j++) {
            if (recordBytes[j] !== bytes[inputOffset + j]) {
              continue FIND_CHUNK;
            }
          }
          return record.str;
        }
      return null;
    }
    store(bytes, value) {
      const records = this.caches[bytes.length - 1];
      const record = { bytes, str: value };
      if (records.length >= this.maxLengthPerKey) {
        records[Math.random() * records.length | 0] = record;
      } else {
        records.push(record);
      }
    }
    decode(bytes, inputOffset, byteLength) {
      const cachedValue = this.find(bytes, inputOffset, byteLength);
      if (cachedValue != null) {
        this.hit++;
        return cachedValue;
      }
      this.miss++;
      const str = (0, utf8_1.utf8DecodeJs)(bytes, inputOffset, byteLength);
      const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
      this.store(slicedCopyOfBytes, str);
      return str;
    }
  }
  exports.CachedKeyDecoder = CachedKeyDecoder;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/Decoder.js
var require_Decoder = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Decoder = exports.DataViewIndexOutOfBoundsError = undefined;
  var prettyByte_1 = require_prettyByte();
  var ExtensionCodec_1 = require_ExtensionCodec();
  var int_1 = require_int();
  var utf8_1 = require_utf8();
  var typedArrays_1 = require_typedArrays();
  var CachedKeyDecoder_1 = require_CachedKeyDecoder();
  var DecodeError_1 = require_DecodeError();
  var isValidMapKeyType = (key) => {
    const keyType = typeof key;
    return keyType === "string" || keyType === "number";
  };
  var HEAD_BYTE_REQUIRED = -1;
  var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
  var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
  exports.DataViewIndexOutOfBoundsError = (() => {
    try {
      EMPTY_VIEW.getInt8(0);
    } catch (e) {
      return e.constructor;
    }
    throw new Error("never reached");
  })();
  var MORE_DATA = new exports.DataViewIndexOutOfBoundsError("Insufficient data");
  var sharedCachedKeyDecoder = new CachedKeyDecoder_1.CachedKeyDecoder;

  class Decoder {
    constructor(extensionCodec = ExtensionCodec_1.ExtensionCodec.defaultCodec, context = undefined, maxStrLength = int_1.UINT32_MAX, maxBinLength = int_1.UINT32_MAX, maxArrayLength = int_1.UINT32_MAX, maxMapLength = int_1.UINT32_MAX, maxExtLength = int_1.UINT32_MAX, keyDecoder = sharedCachedKeyDecoder) {
      this.extensionCodec = extensionCodec;
      this.context = context;
      this.maxStrLength = maxStrLength;
      this.maxBinLength = maxBinLength;
      this.maxArrayLength = maxArrayLength;
      this.maxMapLength = maxMapLength;
      this.maxExtLength = maxExtLength;
      this.keyDecoder = keyDecoder;
      this.totalPos = 0;
      this.pos = 0;
      this.view = EMPTY_VIEW;
      this.bytes = EMPTY_BYTES;
      this.headByte = HEAD_BYTE_REQUIRED;
      this.stack = [];
    }
    reinitializeState() {
      this.totalPos = 0;
      this.headByte = HEAD_BYTE_REQUIRED;
      this.stack.length = 0;
    }
    setBuffer(buffer) {
      this.bytes = (0, typedArrays_1.ensureUint8Array)(buffer);
      this.view = (0, typedArrays_1.createDataView)(this.bytes);
      this.pos = 0;
    }
    appendBuffer(buffer) {
      if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
        this.setBuffer(buffer);
      } else {
        const remainingData = this.bytes.subarray(this.pos);
        const newData = (0, typedArrays_1.ensureUint8Array)(buffer);
        const newBuffer = new Uint8Array(remainingData.length + newData.length);
        newBuffer.set(remainingData);
        newBuffer.set(newData, remainingData.length);
        this.setBuffer(newBuffer);
      }
    }
    hasRemaining(size) {
      return this.view.byteLength - this.pos >= size;
    }
    createExtraByteError(posToShow) {
      const { view, pos } = this;
      return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
    }
    decode(buffer) {
      this.reinitializeState();
      this.setBuffer(buffer);
      const object = this.doDecodeSync();
      if (this.hasRemaining(1)) {
        throw this.createExtraByteError(this.pos);
      }
      return object;
    }
    *decodeMulti(buffer) {
      this.reinitializeState();
      this.setBuffer(buffer);
      while (this.hasRemaining(1)) {
        yield this.doDecodeSync();
      }
    }
    async decodeAsync(stream) {
      let decoded = false;
      let object;
      for await (const buffer of stream) {
        if (decoded) {
          throw this.createExtraByteError(this.totalPos);
        }
        this.appendBuffer(buffer);
        try {
          object = this.doDecodeSync();
          decoded = true;
        } catch (e) {
          if (!(e instanceof exports.DataViewIndexOutOfBoundsError)) {
            throw e;
          }
        }
        this.totalPos += this.pos;
      }
      if (decoded) {
        if (this.hasRemaining(1)) {
          throw this.createExtraByteError(this.totalPos);
        }
        return object;
      }
      const { headByte, pos, totalPos } = this;
      throw new RangeError(`Insufficient data in parsing ${(0, prettyByte_1.prettyByte)(headByte)} at ${totalPos} (${pos} in the current buffer)`);
    }
    decodeArrayStream(stream) {
      return this.decodeMultiAsync(stream, true);
    }
    decodeStream(stream) {
      return this.decodeMultiAsync(stream, false);
    }
    async* decodeMultiAsync(stream, isArray) {
      let isArrayHeaderRequired = isArray;
      let arrayItemsLeft = -1;
      for await (const buffer of stream) {
        if (isArray && arrayItemsLeft === 0) {
          throw this.createExtraByteError(this.totalPos);
        }
        this.appendBuffer(buffer);
        if (isArrayHeaderRequired) {
          arrayItemsLeft = this.readArraySize();
          isArrayHeaderRequired = false;
          this.complete();
        }
        try {
          while (true) {
            yield this.doDecodeSync();
            if (--arrayItemsLeft === 0) {
              break;
            }
          }
        } catch (e) {
          if (!(e instanceof exports.DataViewIndexOutOfBoundsError)) {
            throw e;
          }
        }
        this.totalPos += this.pos;
      }
    }
    doDecodeSync() {
      DECODE:
        while (true) {
          const headByte = this.readHeadByte();
          let object;
          if (headByte >= 224) {
            object = headByte - 256;
          } else if (headByte < 192) {
            if (headByte < 128) {
              object = headByte;
            } else if (headByte < 144) {
              const size = headByte - 128;
              if (size !== 0) {
                this.pushMapState(size);
                this.complete();
                continue DECODE;
              } else {
                object = {};
              }
            } else if (headByte < 160) {
              const size = headByte - 144;
              if (size !== 0) {
                this.pushArrayState(size);
                this.complete();
                continue DECODE;
              } else {
                object = [];
              }
            } else {
              const byteLength = headByte - 160;
              object = this.decodeUtf8String(byteLength, 0);
            }
          } else if (headByte === 192) {
            object = null;
          } else if (headByte === 194) {
            object = false;
          } else if (headByte === 195) {
            object = true;
          } else if (headByte === 202) {
            object = this.readF32();
          } else if (headByte === 203) {
            object = this.readF64();
          } else if (headByte === 204) {
            object = this.readU8();
          } else if (headByte === 205) {
            object = this.readU16();
          } else if (headByte === 206) {
            object = this.readU32();
          } else if (headByte === 207) {
            object = this.readU64();
          } else if (headByte === 208) {
            object = this.readI8();
          } else if (headByte === 209) {
            object = this.readI16();
          } else if (headByte === 210) {
            object = this.readI32();
          } else if (headByte === 211) {
            object = this.readI64();
          } else if (headByte === 217) {
            const byteLength = this.lookU8();
            object = this.decodeUtf8String(byteLength, 1);
          } else if (headByte === 218) {
            const byteLength = this.lookU16();
            object = this.decodeUtf8String(byteLength, 2);
          } else if (headByte === 219) {
            const byteLength = this.lookU32();
            object = this.decodeUtf8String(byteLength, 4);
          } else if (headByte === 220) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 221) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 222) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 223) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 196) {
            const size = this.lookU8();
            object = this.decodeBinary(size, 1);
          } else if (headByte === 197) {
            const size = this.lookU16();
            object = this.decodeBinary(size, 2);
          } else if (headByte === 198) {
            const size = this.lookU32();
            object = this.decodeBinary(size, 4);
          } else if (headByte === 212) {
            object = this.decodeExtension(1, 0);
          } else if (headByte === 213) {
            object = this.decodeExtension(2, 0);
          } else if (headByte === 214) {
            object = this.decodeExtension(4, 0);
          } else if (headByte === 215) {
            object = this.decodeExtension(8, 0);
          } else if (headByte === 216) {
            object = this.decodeExtension(16, 0);
          } else if (headByte === 199) {
            const size = this.lookU8();
            object = this.decodeExtension(size, 1);
          } else if (headByte === 200) {
            const size = this.lookU16();
            object = this.decodeExtension(size, 2);
          } else if (headByte === 201) {
            const size = this.lookU32();
            object = this.decodeExtension(size, 4);
          } else {
            throw new DecodeError_1.DecodeError(`Unrecognized type byte: ${(0, prettyByte_1.prettyByte)(headByte)}`);
          }
          this.complete();
          const stack = this.stack;
          while (stack.length > 0) {
            const state = stack[stack.length - 1];
            if (state.type === 0) {
              state.array[state.position] = object;
              state.position++;
              if (state.position === state.size) {
                stack.pop();
                object = state.array;
              } else {
                continue DECODE;
              }
            } else if (state.type === 1) {
              if (!isValidMapKeyType(object)) {
                throw new DecodeError_1.DecodeError("The type of key must be string or number but " + typeof object);
              }
              if (object === "__proto__") {
                throw new DecodeError_1.DecodeError("The key __proto__ is not allowed");
              }
              state.key = object;
              state.type = 2;
              continue DECODE;
            } else {
              state.map[state.key] = object;
              state.readCount++;
              if (state.readCount === state.size) {
                stack.pop();
                object = state.map;
              } else {
                state.key = null;
                state.type = 1;
                continue DECODE;
              }
            }
          }
          return object;
        }
    }
    readHeadByte() {
      if (this.headByte === HEAD_BYTE_REQUIRED) {
        this.headByte = this.readU8();
      }
      return this.headByte;
    }
    complete() {
      this.headByte = HEAD_BYTE_REQUIRED;
    }
    readArraySize() {
      const headByte = this.readHeadByte();
      switch (headByte) {
        case 220:
          return this.readU16();
        case 221:
          return this.readU32();
        default: {
          if (headByte < 160) {
            return headByte - 144;
          } else {
            throw new DecodeError_1.DecodeError(`Unrecognized array type byte: ${(0, prettyByte_1.prettyByte)(headByte)}`);
          }
        }
      }
    }
    pushMapState(size) {
      if (size > this.maxMapLength) {
        throw new DecodeError_1.DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
      }
      this.stack.push({
        type: 1,
        size,
        key: null,
        readCount: 0,
        map: {}
      });
    }
    pushArrayState(size) {
      if (size > this.maxArrayLength) {
        throw new DecodeError_1.DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
      }
      this.stack.push({
        type: 0,
        size,
        array: new Array(size),
        position: 0
      });
    }
    decodeUtf8String(byteLength, headerOffset) {
      var _a2;
      if (byteLength > this.maxStrLength) {
        throw new DecodeError_1.DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
      }
      if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
        throw MORE_DATA;
      }
      const offset = this.pos + headerOffset;
      let object;
      if (this.stateIsMapKey() && ((_a2 = this.keyDecoder) === null || _a2 === undefined ? undefined : _a2.canBeCached(byteLength))) {
        object = this.keyDecoder.decode(this.bytes, offset, byteLength);
      } else if (byteLength > utf8_1.TEXT_DECODER_THRESHOLD) {
        object = (0, utf8_1.utf8DecodeTD)(this.bytes, offset, byteLength);
      } else {
        object = (0, utf8_1.utf8DecodeJs)(this.bytes, offset, byteLength);
      }
      this.pos += headerOffset + byteLength;
      return object;
    }
    stateIsMapKey() {
      if (this.stack.length > 0) {
        const state = this.stack[this.stack.length - 1];
        return state.type === 1;
      }
      return false;
    }
    decodeBinary(byteLength, headOffset) {
      if (byteLength > this.maxBinLength) {
        throw new DecodeError_1.DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
      }
      if (!this.hasRemaining(byteLength + headOffset)) {
        throw MORE_DATA;
      }
      const offset = this.pos + headOffset;
      const object = this.bytes.subarray(offset, offset + byteLength);
      this.pos += headOffset + byteLength;
      return object;
    }
    decodeExtension(size, headOffset) {
      if (size > this.maxExtLength) {
        throw new DecodeError_1.DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
      }
      const extType = this.view.getInt8(this.pos + headOffset);
      const data = this.decodeBinary(size, headOffset + 1);
      return this.extensionCodec.decode(data, extType, this.context);
    }
    lookU8() {
      return this.view.getUint8(this.pos);
    }
    lookU16() {
      return this.view.getUint16(this.pos);
    }
    lookU32() {
      return this.view.getUint32(this.pos);
    }
    readU8() {
      const value = this.view.getUint8(this.pos);
      this.pos++;
      return value;
    }
    readI8() {
      const value = this.view.getInt8(this.pos);
      this.pos++;
      return value;
    }
    readU16() {
      const value = this.view.getUint16(this.pos);
      this.pos += 2;
      return value;
    }
    readI16() {
      const value = this.view.getInt16(this.pos);
      this.pos += 2;
      return value;
    }
    readU32() {
      const value = this.view.getUint32(this.pos);
      this.pos += 4;
      return value;
    }
    readI32() {
      const value = this.view.getInt32(this.pos);
      this.pos += 4;
      return value;
    }
    readU64() {
      const value = (0, int_1.getUint64)(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readI64() {
      const value = (0, int_1.getInt64)(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readF32() {
      const value = this.view.getFloat32(this.pos);
      this.pos += 4;
      return value;
    }
    readF64() {
      const value = this.view.getFloat64(this.pos);
      this.pos += 8;
      return value;
    }
  }
  exports.Decoder = Decoder;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/decode.js
var require_decode = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.decodeMulti = exports.decode = exports.defaultDecodeOptions = undefined;
  var Decoder_1 = require_Decoder();
  exports.defaultDecodeOptions = {};
  function decode(buffer, options = exports.defaultDecodeOptions) {
    const decoder = new Decoder_1.Decoder(options.extensionCodec, options.context, options.maxStrLength, options.maxBinLength, options.maxArrayLength, options.maxMapLength, options.maxExtLength);
    return decoder.decode(buffer);
  }
  exports.decode = decode;
  function decodeMulti(buffer, options = exports.defaultDecodeOptions) {
    const decoder = new Decoder_1.Decoder(options.extensionCodec, options.context, options.maxStrLength, options.maxBinLength, options.maxArrayLength, options.maxMapLength, options.maxExtLength);
    return decoder.decodeMulti(buffer);
  }
  exports.decodeMulti = decodeMulti;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/utils/stream.js
var require_stream = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ensureAsyncIterable = exports.asyncIterableFromStream = exports.isAsyncIterable = undefined;
  function isAsyncIterable(object) {
    return object[Symbol.asyncIterator] != null;
  }
  exports.isAsyncIterable = isAsyncIterable;
  function assertNonNull(value) {
    if (value == null) {
      throw new Error("Assertion Failure: value must not be null nor undefined");
    }
  }
  async function* asyncIterableFromStream(stream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        assertNonNull(value);
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  exports.asyncIterableFromStream = asyncIterableFromStream;
  function ensureAsyncIterable(streamLike) {
    if (isAsyncIterable(streamLike)) {
      return streamLike;
    } else {
      return asyncIterableFromStream(streamLike);
    }
  }
  exports.ensureAsyncIterable = ensureAsyncIterable;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/decodeAsync.js
var require_decodeAsync = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.decodeStream = exports.decodeMultiStream = exports.decodeArrayStream = exports.decodeAsync = undefined;
  var Decoder_1 = require_Decoder();
  var stream_1 = require_stream();
  var decode_1 = require_decode();
  async function decodeAsync(streamLike, options = decode_1.defaultDecodeOptions) {
    const stream = (0, stream_1.ensureAsyncIterable)(streamLike);
    const decoder = new Decoder_1.Decoder(options.extensionCodec, options.context, options.maxStrLength, options.maxBinLength, options.maxArrayLength, options.maxMapLength, options.maxExtLength);
    return decoder.decodeAsync(stream);
  }
  exports.decodeAsync = decodeAsync;
  function decodeArrayStream(streamLike, options = decode_1.defaultDecodeOptions) {
    const stream = (0, stream_1.ensureAsyncIterable)(streamLike);
    const decoder = new Decoder_1.Decoder(options.extensionCodec, options.context, options.maxStrLength, options.maxBinLength, options.maxArrayLength, options.maxMapLength, options.maxExtLength);
    return decoder.decodeArrayStream(stream);
  }
  exports.decodeArrayStream = decodeArrayStream;
  function decodeMultiStream(streamLike, options = decode_1.defaultDecodeOptions) {
    const stream = (0, stream_1.ensureAsyncIterable)(streamLike);
    const decoder = new Decoder_1.Decoder(options.extensionCodec, options.context, options.maxStrLength, options.maxBinLength, options.maxArrayLength, options.maxMapLength, options.maxExtLength);
    return decoder.decodeStream(stream);
  }
  exports.decodeMultiStream = decodeMultiStream;
  function decodeStream(streamLike, options = decode_1.defaultDecodeOptions) {
    return decodeMultiStream(streamLike, options);
  }
  exports.decodeStream = decodeStream;
});

// ../node_modules/.bun/@msgpack+msgpack@2.8.0/node_modules/@msgpack/msgpack/dist/index.js
var require_dist = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.decodeTimestampExtension = exports.encodeTimestampExtension = exports.decodeTimestampToTimeSpec = exports.encodeTimeSpecToTimestamp = exports.encodeDateToTimeSpec = exports.EXT_TIMESTAMP = exports.ExtData = exports.ExtensionCodec = exports.Encoder = exports.DataViewIndexOutOfBoundsError = exports.DecodeError = exports.Decoder = exports.decodeStream = exports.decodeMultiStream = exports.decodeArrayStream = exports.decodeAsync = exports.decodeMulti = exports.decode = exports.encode = undefined;
  var encode_1 = require_encode();
  Object.defineProperty(exports, "encode", { enumerable: true, get: function() {
    return encode_1.encode;
  } });
  var decode_1 = require_decode();
  Object.defineProperty(exports, "decode", { enumerable: true, get: function() {
    return decode_1.decode;
  } });
  Object.defineProperty(exports, "decodeMulti", { enumerable: true, get: function() {
    return decode_1.decodeMulti;
  } });
  var decodeAsync_1 = require_decodeAsync();
  Object.defineProperty(exports, "decodeAsync", { enumerable: true, get: function() {
    return decodeAsync_1.decodeAsync;
  } });
  Object.defineProperty(exports, "decodeArrayStream", { enumerable: true, get: function() {
    return decodeAsync_1.decodeArrayStream;
  } });
  Object.defineProperty(exports, "decodeMultiStream", { enumerable: true, get: function() {
    return decodeAsync_1.decodeMultiStream;
  } });
  Object.defineProperty(exports, "decodeStream", { enumerable: true, get: function() {
    return decodeAsync_1.decodeStream;
  } });
  var Decoder_1 = require_Decoder();
  Object.defineProperty(exports, "Decoder", { enumerable: true, get: function() {
    return Decoder_1.Decoder;
  } });
  Object.defineProperty(exports, "DataViewIndexOutOfBoundsError", { enumerable: true, get: function() {
    return Decoder_1.DataViewIndexOutOfBoundsError;
  } });
  var DecodeError_1 = require_DecodeError();
  Object.defineProperty(exports, "DecodeError", { enumerable: true, get: function() {
    return DecodeError_1.DecodeError;
  } });
  var Encoder_1 = require_Encoder();
  Object.defineProperty(exports, "Encoder", { enumerable: true, get: function() {
    return Encoder_1.Encoder;
  } });
  var ExtensionCodec_1 = require_ExtensionCodec();
  Object.defineProperty(exports, "ExtensionCodec", { enumerable: true, get: function() {
    return ExtensionCodec_1.ExtensionCodec;
  } });
  var ExtData_1 = require_ExtData();
  Object.defineProperty(exports, "ExtData", { enumerable: true, get: function() {
    return ExtData_1.ExtData;
  } });
  var timestamp_1 = require_timestamp();
  Object.defineProperty(exports, "EXT_TIMESTAMP", { enumerable: true, get: function() {
    return timestamp_1.EXT_TIMESTAMP;
  } });
  Object.defineProperty(exports, "encodeDateToTimeSpec", { enumerable: true, get: function() {
    return timestamp_1.encodeDateToTimeSpec;
  } });
  Object.defineProperty(exports, "encodeTimeSpecToTimestamp", { enumerable: true, get: function() {
    return timestamp_1.encodeTimeSpecToTimestamp;
  } });
  Object.defineProperty(exports, "decodeTimestampToTimeSpec", { enumerable: true, get: function() {
    return timestamp_1.decodeTimestampToTimeSpec;
  } });
  Object.defineProperty(exports, "encodeTimestampExtension", { enumerable: true, get: function() {
    return timestamp_1.encodeTimestampExtension;
  } });
  Object.defineProperty(exports, "decodeTimestampExtension", { enumerable: true, get: function() {
    return timestamp_1.decodeTimestampExtension;
  } });
});

// ../node_modules/.bun/peerjs@1.5.5/node_modules/peerjs/dist/bundler.cjs
var require_bundler = __commonJS((exports, module) => {
  var $2QID2$peerjsjsbinarypack = require_binarypack();
  var $2QID2$webrtcadapter = require_adapter_core();
  var $2QID2$eventemitter3 = require_eventemitter3();
  var $2QID2$msgpackmsgpack = require_dist();
  function $parcel$defineInteropFlag(a) {
    Object.defineProperty(a, "__esModule", { value: true, configurable: true });
  }
  function $parcel$exportWildcard(dest, source) {
    Object.keys(source).forEach(function(key) {
      if (key === "default" || key === "__esModule" || Object.prototype.hasOwnProperty.call(dest, key)) {
        return;
      }
      Object.defineProperty(dest, key, {
        enumerable: true,
        get: function get() {
          return source[key];
        }
      });
    });
    return dest;
  }
  function $parcel$export(e, n, v, s) {
    Object.defineProperty(e, n, { get: v, set: s, enumerable: true, configurable: true });
  }
  function $parcel$interopDefault(a) {
    return a && a.__esModule ? a.default : a;
  }
  $parcel$defineInteropFlag(exports);
  $parcel$export(exports, "default", () => $8c8bca0fa9aa4b8b$export$2e2bcd8739ae039);
  $parcel$export(exports, "util", () => $b83e6a166cc3008f$export$7debb50ef11d5e0b);
  $parcel$export(exports, "BufferedConnection", () => $8d5124d0cf36ebe0$export$ff7c9d4c11d94e8b);
  $parcel$export(exports, "StreamConnection", () => $544799118fa637e6$export$72aa44612e2200cd);
  $parcel$export(exports, "MsgPack", () => $7e477efb76e02214$export$80f5de1a66c4d624);
  $parcel$export(exports, "Peer", () => $2ddecb16305b5a82$export$ecd1fc136c422448);
  $parcel$export(exports, "MsgPackPeer", () => $8c8805059443e9b3$export$d72c7bf8eef50853);
  $parcel$export(exports, "PeerError", () => $cf62563e7a9fbce5$export$98871882f492de82);

  class $7ce5389b504cc06c$export$f1c5f4c9cb95390b {
    constructor() {
      this.chunkedMTU = 16300;
      this._dataCount = 1;
      this.chunk = (blob) => {
        const chunks = [];
        const size = blob.byteLength;
        const total = Math.ceil(size / this.chunkedMTU);
        let index = 0;
        let start = 0;
        while (start < size) {
          const end = Math.min(size, start + this.chunkedMTU);
          const b = blob.slice(start, end);
          const chunk = {
            __peerData: this._dataCount,
            n: index,
            data: b,
            total
          };
          chunks.push(chunk);
          start = end;
          index++;
        }
        this._dataCount++;
        return chunks;
      };
    }
  }
  function $7ce5389b504cc06c$export$52c89ebcdc4f53f2(bufs) {
    let size = 0;
    for (const buf of bufs)
      size += buf.byteLength;
    const result = new Uint8Array(size);
    let offset = 0;
    for (const buf of bufs) {
      result.set(buf, offset);
      offset += buf.byteLength;
    }
    return result;
  }
  var $07e4f6a369d1179a$var$webRTCAdapter = (0, $parcel$interopDefault($2QID2$webrtcadapter)).default || (0, $parcel$interopDefault($2QID2$webrtcadapter));
  var $07e4f6a369d1179a$export$25be9502477c137d = new class {
    isWebRTCSupported() {
      return typeof RTCPeerConnection !== "undefined";
    }
    isBrowserSupported() {
      const browser = this.getBrowser();
      const version = this.getVersion();
      const validBrowser = this.supportedBrowsers.includes(browser);
      if (!validBrowser)
        return false;
      if (browser === "chrome")
        return version >= this.minChromeVersion;
      if (browser === "firefox")
        return version >= this.minFirefoxVersion;
      if (browser === "safari")
        return !this.isIOS && version >= this.minSafariVersion;
      return false;
    }
    getBrowser() {
      return $07e4f6a369d1179a$var$webRTCAdapter.browserDetails.browser;
    }
    getVersion() {
      return $07e4f6a369d1179a$var$webRTCAdapter.browserDetails.version || 0;
    }
    isUnifiedPlanSupported() {
      const browser = this.getBrowser();
      const version = $07e4f6a369d1179a$var$webRTCAdapter.browserDetails.version || 0;
      if (browser === "chrome" && version < this.minChromeVersion)
        return false;
      if (browser === "firefox" && version >= this.minFirefoxVersion)
        return true;
      if (!window.RTCRtpTransceiver || !("currentDirection" in RTCRtpTransceiver.prototype))
        return false;
      let tempPc;
      let supported = false;
      try {
        tempPc = new RTCPeerConnection;
        tempPc.addTransceiver("audio");
        supported = true;
      } catch (e) {} finally {
        if (tempPc)
          tempPc.close();
      }
      return supported;
    }
    toString() {
      return `Supports:
    browser:${this.getBrowser()}
    version:${this.getVersion()}
    isIOS:${this.isIOS}
    isWebRTCSupported:${this.isWebRTCSupported()}
    isBrowserSupported:${this.isBrowserSupported()}
    isUnifiedPlanSupported:${this.isUnifiedPlanSupported()}`;
    }
    constructor() {
      this.isIOS = typeof navigator !== "undefined" ? [
        "iPad",
        "iPhone",
        "iPod"
      ].includes(navigator.platform) : false;
      this.supportedBrowsers = [
        "firefox",
        "chrome",
        "safari"
      ];
      this.minFirefoxVersion = 59;
      this.minChromeVersion = 72;
      this.minSafariVersion = 605;
    }
  };
  var $706cd7d90eca90d6$export$f35f128fd59ea256 = (id) => {
    return !id || /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id);
  };
  var $6a375544f634961e$export$4e61f672936bec77 = () => Math.random().toString(36).slice(2);
  var $b83e6a166cc3008f$var$DEFAULT_CONFIG = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302"
      },
      {
        urls: [
          "turn:eu-0.turn.peerjs.com:3478",
          "turn:us-0.turn.peerjs.com:3478"
        ],
        username: "peerjs",
        credential: "peerjsp"
      }
    ],
    sdpSemantics: "unified-plan"
  };

  class $b83e6a166cc3008f$export$f8f26dd395d7e1bd extends (0, $7ce5389b504cc06c$export$f1c5f4c9cb95390b) {
    noop() {}
    blobToArrayBuffer(blob, cb) {
      const fr = new FileReader;
      fr.onload = function(evt) {
        if (evt.target)
          cb(evt.target.result);
      };
      fr.readAsArrayBuffer(blob);
      return fr;
    }
    binaryStringToArrayBuffer(binary) {
      const byteArray = new Uint8Array(binary.length);
      for (let i = 0;i < binary.length; i++)
        byteArray[i] = binary.charCodeAt(i) & 255;
      return byteArray.buffer;
    }
    isSecure() {
      return location.protocol === "https:";
    }
    constructor(...args) {
      super(...args), this.CLOUD_HOST = "0.peerjs.com", this.CLOUD_PORT = 443, this.chunkedBrowsers = {
        Chrome: 1,
        chrome: 1
      }, this.defaultConfig = $b83e6a166cc3008f$var$DEFAULT_CONFIG, this.browser = (0, $07e4f6a369d1179a$export$25be9502477c137d).getBrowser(), this.browserVersion = (0, $07e4f6a369d1179a$export$25be9502477c137d).getVersion(), this.pack = $2QID2$peerjsjsbinarypack.pack, this.unpack = $2QID2$peerjsjsbinarypack.unpack, this.supports = function() {
        const supported = {
          browser: (0, $07e4f6a369d1179a$export$25be9502477c137d).isBrowserSupported(),
          webRTC: (0, $07e4f6a369d1179a$export$25be9502477c137d).isWebRTCSupported(),
          audioVideo: false,
          data: false,
          binaryBlob: false,
          reliable: false
        };
        if (!supported.webRTC)
          return supported;
        let pc;
        try {
          pc = new RTCPeerConnection($b83e6a166cc3008f$var$DEFAULT_CONFIG);
          supported.audioVideo = true;
          let dc;
          try {
            dc = pc.createDataChannel("_PEERJSTEST", {
              ordered: true
            });
            supported.data = true;
            supported.reliable = !!dc.ordered;
            try {
              dc.binaryType = "blob";
              supported.binaryBlob = !(0, $07e4f6a369d1179a$export$25be9502477c137d).isIOS;
            } catch (e) {}
          } catch (e) {} finally {
            if (dc)
              dc.close();
          }
        } catch (e) {} finally {
          if (pc)
            pc.close();
        }
        return supported;
      }(), this.validateId = (0, $706cd7d90eca90d6$export$f35f128fd59ea256), this.randomToken = (0, $6a375544f634961e$export$4e61f672936bec77);
    }
  }
  var $b83e6a166cc3008f$export$7debb50ef11d5e0b = new $b83e6a166cc3008f$export$f8f26dd395d7e1bd;
  var $df9d8b89ee908b8b$var$LOG_PREFIX = "PeerJS: ";

  class $df9d8b89ee908b8b$var$Logger {
    get logLevel() {
      return this._logLevel;
    }
    set logLevel(logLevel) {
      this._logLevel = logLevel;
    }
    log(...args) {
      if (this._logLevel >= 3)
        this._print(3, ...args);
    }
    warn(...args) {
      if (this._logLevel >= 2)
        this._print(2, ...args);
    }
    error(...args) {
      if (this._logLevel >= 1)
        this._print(1, ...args);
    }
    setLogFunction(fn) {
      this._print = fn;
    }
    _print(logLevel, ...rest) {
      const copy = [
        $df9d8b89ee908b8b$var$LOG_PREFIX,
        ...rest
      ];
      for (const i in copy)
        if (copy[i] instanceof Error)
          copy[i] = "(" + copy[i].name + ") " + copy[i].message;
      if (logLevel >= 3)
        console.log(...copy);
      else if (logLevel >= 2)
        console.warn("WARNING", ...copy);
      else if (logLevel >= 1)
        console.error("ERROR", ...copy);
    }
    constructor() {
      this._logLevel = 0;
    }
  }
  var $df9d8b89ee908b8b$export$2e2bcd8739ae039 = new $df9d8b89ee908b8b$var$Logger;
  var $1a7e7edd560505fc$exports = {};
  $parcel$export($1a7e7edd560505fc$exports, "ConnectionType", () => $1a7e7edd560505fc$export$3157d57b4135e3bc);
  $parcel$export($1a7e7edd560505fc$exports, "PeerErrorType", () => $1a7e7edd560505fc$export$9547aaa2e39030ff);
  $parcel$export($1a7e7edd560505fc$exports, "BaseConnectionErrorType", () => $1a7e7edd560505fc$export$7974935686149686);
  $parcel$export($1a7e7edd560505fc$exports, "DataConnectionErrorType", () => $1a7e7edd560505fc$export$49ae800c114df41d);
  $parcel$export($1a7e7edd560505fc$exports, "SerializationType", () => $1a7e7edd560505fc$export$89f507cf986a947);
  $parcel$export($1a7e7edd560505fc$exports, "SocketEventType", () => $1a7e7edd560505fc$export$3b5c4a4b6354f023);
  $parcel$export($1a7e7edd560505fc$exports, "ServerMessageType", () => $1a7e7edd560505fc$export$adb4a1754da6f10d);
  var $1a7e7edd560505fc$export$3157d57b4135e3bc = /* @__PURE__ */ function(ConnectionType) {
    ConnectionType["Data"] = "data";
    ConnectionType["Media"] = "media";
    return ConnectionType;
  }({});
  var $1a7e7edd560505fc$export$9547aaa2e39030ff = /* @__PURE__ */ function(PeerErrorType) {
    PeerErrorType["BrowserIncompatible"] = "browser-incompatible";
    PeerErrorType["Disconnected"] = "disconnected";
    PeerErrorType["InvalidID"] = "invalid-id";
    PeerErrorType["InvalidKey"] = "invalid-key";
    PeerErrorType["Network"] = "network";
    PeerErrorType["PeerUnavailable"] = "peer-unavailable";
    PeerErrorType["SslUnavailable"] = "ssl-unavailable";
    PeerErrorType["ServerError"] = "server-error";
    PeerErrorType["SocketError"] = "socket-error";
    PeerErrorType["SocketClosed"] = "socket-closed";
    PeerErrorType["UnavailableID"] = "unavailable-id";
    PeerErrorType["WebRTC"] = "webrtc";
    return PeerErrorType;
  }({});
  var $1a7e7edd560505fc$export$7974935686149686 = /* @__PURE__ */ function(BaseConnectionErrorType) {
    BaseConnectionErrorType["NegotiationFailed"] = "negotiation-failed";
    BaseConnectionErrorType["ConnectionClosed"] = "connection-closed";
    return BaseConnectionErrorType;
  }({});
  var $1a7e7edd560505fc$export$49ae800c114df41d = /* @__PURE__ */ function(DataConnectionErrorType) {
    DataConnectionErrorType["NotOpenYet"] = "not-open-yet";
    DataConnectionErrorType["MessageToBig"] = "message-too-big";
    return DataConnectionErrorType;
  }({});
  var $1a7e7edd560505fc$export$89f507cf986a947 = /* @__PURE__ */ function(SerializationType) {
    SerializationType["Binary"] = "binary";
    SerializationType["BinaryUTF8"] = "binary-utf8";
    SerializationType["JSON"] = "json";
    SerializationType["None"] = "raw";
    return SerializationType;
  }({});
  var $1a7e7edd560505fc$export$3b5c4a4b6354f023 = /* @__PURE__ */ function(SocketEventType) {
    SocketEventType["Message"] = "message";
    SocketEventType["Disconnected"] = "disconnected";
    SocketEventType["Error"] = "error";
    SocketEventType["Close"] = "close";
    return SocketEventType;
  }({});
  var $1a7e7edd560505fc$export$adb4a1754da6f10d = /* @__PURE__ */ function(ServerMessageType) {
    ServerMessageType["Heartbeat"] = "HEARTBEAT";
    ServerMessageType["Candidate"] = "CANDIDATE";
    ServerMessageType["Offer"] = "OFFER";
    ServerMessageType["Answer"] = "ANSWER";
    ServerMessageType["Open"] = "OPEN";
    ServerMessageType["Error"] = "ERROR";
    ServerMessageType["IdTaken"] = "ID-TAKEN";
    ServerMessageType["InvalidKey"] = "INVALID-KEY";
    ServerMessageType["Leave"] = "LEAVE";
    ServerMessageType["Expire"] = "EXPIRE";
    return ServerMessageType;
  }({});
  var $3a25eea6a06ee968$export$83d89fbfd8236492 = "1.5.5";

  class $e5e868bf3ea73e5b$export$4798917dbf149b79 extends (0, $2QID2$eventemitter3.EventEmitter) {
    constructor(secure, host, port, path, key, pingInterval = 5000) {
      super(), this.pingInterval = pingInterval, this._disconnected = true, this._messagesQueue = [];
      const wsProtocol = secure ? "wss://" : "ws://";
      this._baseUrl = wsProtocol + host + ":" + port + path + "peerjs?key=" + key;
    }
    start(id, token) {
      this._id = id;
      const wsUrl = `${this._baseUrl}&id=${id}&token=${token}`;
      if (!!this._socket || !this._disconnected)
        return;
      this._socket = new WebSocket(wsUrl + "&version=" + (0, $3a25eea6a06ee968$export$83d89fbfd8236492));
      this._disconnected = false;
      this._socket.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Server message received:", data);
        } catch (e) {
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Invalid server message", event.data);
          return;
        }
        this.emit((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Message, data);
      };
      this._socket.onclose = (event) => {
        if (this._disconnected)
          return;
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Socket closed.", event);
        this._cleanup();
        this._disconnected = true;
        this.emit((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Disconnected);
      };
      this._socket.onopen = () => {
        if (this._disconnected)
          return;
        this._sendQueuedMessages();
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Socket open");
        this._scheduleHeartbeat();
      };
    }
    _scheduleHeartbeat() {
      this._wsPingTimer = setTimeout(() => {
        this._sendHeartbeat();
      }, this.pingInterval);
    }
    _sendHeartbeat() {
      if (!this._wsOpen()) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Cannot send heartbeat, because socket closed`);
        return;
      }
      const message = JSON.stringify({
        type: (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Heartbeat
      });
      this._socket.send(message);
      this._scheduleHeartbeat();
    }
    _wsOpen() {
      return !!this._socket && this._socket.readyState === 1;
    }
    _sendQueuedMessages() {
      const copiedQueue = [
        ...this._messagesQueue
      ];
      this._messagesQueue = [];
      for (const message of copiedQueue)
        this.send(message);
    }
    send(data) {
      if (this._disconnected)
        return;
      if (!this._id) {
        this._messagesQueue.push(data);
        return;
      }
      if (!data.type) {
        this.emit((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Error, "Invalid message");
        return;
      }
      if (!this._wsOpen())
        return;
      const message = JSON.stringify(data);
      this._socket.send(message);
    }
    close() {
      if (this._disconnected)
        return;
      this._cleanup();
      this._disconnected = true;
    }
    _cleanup() {
      if (this._socket) {
        this._socket.onopen = this._socket.onmessage = this._socket.onclose = null;
        this._socket.close();
        this._socket = undefined;
      }
      clearTimeout(this._wsPingTimer);
    }
  }

  class $a8347a6741c5df8a$export$89e6bb5ad64bf4a {
    constructor(connection) {
      this.connection = connection;
    }
    startConnection(options) {
      const peerConnection = this._startPeerConnection();
      this.connection.peerConnection = peerConnection;
      if (this.connection.type === (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Media && options._stream)
        this._addTracksToConnection(options._stream, peerConnection);
      if (options.originator) {
        const dataConnection = this.connection;
        const config = {
          ordered: !!options.reliable
        };
        const dataChannel = peerConnection.createDataChannel(dataConnection.label, config);
        dataConnection._initializeDataChannel(dataChannel);
        this._makeOffer();
      } else
        this.handleSDP("OFFER", options.sdp);
    }
    _startPeerConnection() {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Creating RTCPeerConnection.");
      const peerConnection = new RTCPeerConnection(this.connection.provider.options.config);
      this._setupListeners(peerConnection);
      return peerConnection;
    }
    _setupListeners(peerConnection) {
      const peerId = this.connection.peer;
      const connectionId = this.connection.connectionId;
      const connectionType = this.connection.type;
      const provider = this.connection.provider;
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Listening for ICE candidates.");
      peerConnection.onicecandidate = (evt) => {
        if (!evt.candidate || !evt.candidate.candidate)
          return;
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Received ICE candidates for ${peerId}:`, evt.candidate);
        provider.socket.send({
          type: (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Candidate,
          payload: {
            candidate: evt.candidate,
            type: connectionType,
            connectionId
          },
          dst: peerId
        });
      };
      peerConnection.oniceconnectionstatechange = () => {
        switch (peerConnection.iceConnectionState) {
          case "failed":
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("iceConnectionState is failed, closing connections to " + peerId);
            this.connection.emitError((0, $1a7e7edd560505fc$export$7974935686149686).NegotiationFailed, "Negotiation of connection to " + peerId + " failed.");
            this.connection.close();
            break;
          case "closed":
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("iceConnectionState is closed, closing connections to " + peerId);
            this.connection.emitError((0, $1a7e7edd560505fc$export$7974935686149686).ConnectionClosed, "Connection to " + peerId + " closed.");
            this.connection.close();
            break;
          case "disconnected":
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("iceConnectionState changed to disconnected on the connection with " + peerId);
            break;
          case "completed":
            peerConnection.onicecandidate = () => {};
            break;
        }
        this.connection.emit("iceStateChanged", peerConnection.iceConnectionState);
      };
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Listening for data channel");
      peerConnection.ondatachannel = (evt) => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Received data channel");
        const dataChannel = evt.channel;
        const connection = provider.getConnection(peerId, connectionId);
        connection._initializeDataChannel(dataChannel);
      };
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Listening for remote stream");
      peerConnection.ontrack = (evt) => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Received remote stream");
        const stream = evt.streams[0];
        const connection = provider.getConnection(peerId, connectionId);
        if (connection.type === (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Media) {
          const mediaConnection = connection;
          this._addStreamToMediaConnection(stream, mediaConnection);
        }
      };
    }
    cleanup() {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Cleaning up PeerConnection to " + this.connection.peer);
      const peerConnection = this.connection.peerConnection;
      if (!peerConnection)
        return;
      this.connection.peerConnection = null;
      peerConnection.onicecandidate = peerConnection.oniceconnectionstatechange = peerConnection.ondatachannel = peerConnection.ontrack = () => {};
      const peerConnectionNotClosed = peerConnection.signalingState !== "closed";
      let dataChannelNotClosed = false;
      const dataChannel = this.connection.dataChannel;
      if (dataChannel)
        dataChannelNotClosed = !!dataChannel.readyState && dataChannel.readyState !== "closed";
      if (peerConnectionNotClosed || dataChannelNotClosed)
        peerConnection.close();
    }
    async _makeOffer() {
      const peerConnection = this.connection.peerConnection;
      const provider = this.connection.provider;
      try {
        const offer = await peerConnection.createOffer(this.connection.options.constraints);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Created offer.");
        if (this.connection.options.sdpTransform && typeof this.connection.options.sdpTransform === "function")
          offer.sdp = this.connection.options.sdpTransform(offer.sdp) || offer.sdp;
        try {
          await peerConnection.setLocalDescription(offer);
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Set localDescription:", offer, `for:${this.connection.peer}`);
          let payload = {
            sdp: offer,
            type: this.connection.type,
            connectionId: this.connection.connectionId,
            metadata: this.connection.metadata
          };
          if (this.connection.type === (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Data) {
            const dataConnection = this.connection;
            payload = {
              ...payload,
              label: dataConnection.label,
              reliable: dataConnection.reliable,
              serialization: dataConnection.serialization
            };
          }
          provider.socket.send({
            type: (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Offer,
            payload,
            dst: this.connection.peer
          });
        } catch (err) {
          if (err != "OperationError: Failed to set local offer sdp: Called in wrong state: kHaveRemoteOffer") {
            provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err);
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to setLocalDescription, ", err);
          }
        }
      } catch (err_1) {
        provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err_1);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to createOffer, ", err_1);
      }
    }
    async _makeAnswer() {
      const peerConnection = this.connection.peerConnection;
      const provider = this.connection.provider;
      try {
        const answer = await peerConnection.createAnswer();
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Created answer.");
        if (this.connection.options.sdpTransform && typeof this.connection.options.sdpTransform === "function")
          answer.sdp = this.connection.options.sdpTransform(answer.sdp) || answer.sdp;
        try {
          await peerConnection.setLocalDescription(answer);
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Set localDescription:`, answer, `for:${this.connection.peer}`);
          provider.socket.send({
            type: (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Answer,
            payload: {
              sdp: answer,
              type: this.connection.type,
              connectionId: this.connection.connectionId
            },
            dst: this.connection.peer
          });
        } catch (err) {
          provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err);
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to setLocalDescription, ", err);
        }
      } catch (err_1) {
        provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err_1);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to create answer, ", err_1);
      }
    }
    async handleSDP(type, sdp) {
      sdp = new RTCSessionDescription(sdp);
      const peerConnection = this.connection.peerConnection;
      const provider = this.connection.provider;
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Setting remote description", sdp);
      const self = this;
      try {
        await peerConnection.setRemoteDescription(sdp);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Set remoteDescription:${type} for:${this.connection.peer}`);
        if (type === "OFFER")
          await self._makeAnswer();
      } catch (err) {
        provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to setRemoteDescription, ", err);
      }
    }
    async handleCandidate(ice) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`handleCandidate:`, ice);
      try {
        await this.connection.peerConnection.addIceCandidate(ice);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Added ICE candidate for:${this.connection.peer}`);
      } catch (err) {
        this.connection.provider.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).WebRTC, err);
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Failed to handleCandidate, ", err);
      }
    }
    _addTracksToConnection(stream, peerConnection) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`add tracks from stream ${stream.id} to peer connection`);
      if (!peerConnection.addTrack)
        return (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error(`Your browser does't support RTCPeerConnection#addTrack. Ignored.`);
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });
    }
    _addStreamToMediaConnection(stream, mediaConnection) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`add stream ${stream.id} to media connection ${mediaConnection.connectionId}`);
      mediaConnection.addStream(stream);
    }
  }

  class $cf62563e7a9fbce5$export$6a678e589c8a4542 extends (0, $2QID2$eventemitter3.EventEmitter) {
    emitError(type, err) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("Error:", err);
      this.emit("error", new $cf62563e7a9fbce5$export$98871882f492de82(`${type}`, err));
    }
  }

  class $cf62563e7a9fbce5$export$98871882f492de82 extends Error {
    constructor(type, err) {
      if (typeof err === "string")
        super(err);
      else {
        super();
        Object.assign(this, err);
      }
      this.type = type;
    }
  }

  class $cb834ab0363d9153$export$23a2a68283c24d80 extends (0, $cf62563e7a9fbce5$export$6a678e589c8a4542) {
    get open() {
      return this._open;
    }
    constructor(peer, provider, options) {
      super(), this.peer = peer, this.provider = provider, this.options = options, this._open = false;
      this.metadata = options.metadata;
    }
  }

  class $f3a554d4328c6b5f$export$4a84e95a2324ac29 extends (0, $cb834ab0363d9153$export$23a2a68283c24d80) {
    static #_ = this.ID_PREFIX = "mc_";
    get type() {
      return (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Media;
    }
    get localStream() {
      return this._localStream;
    }
    get remoteStream() {
      return this._remoteStream;
    }
    constructor(peerId, provider, options) {
      super(peerId, provider, options);
      this._localStream = this.options._stream;
      this.connectionId = this.options.connectionId || $f3a554d4328c6b5f$export$4a84e95a2324ac29.ID_PREFIX + (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).randomToken();
      this._negotiator = new (0, $a8347a6741c5df8a$export$89e6bb5ad64bf4a)(this);
      if (this._localStream)
        this._negotiator.startConnection({
          _stream: this._localStream,
          originator: true
        });
    }
    _initializeDataChannel(dc) {
      this.dataChannel = dc;
      this.dataChannel.onopen = () => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} dc connection success`);
        this.emit("willCloseOnRemote");
      };
      this.dataChannel.onclose = () => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} dc closed for:`, this.peer);
        this.close();
      };
    }
    addStream(remoteStream) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log("Receiving stream", remoteStream);
      this._remoteStream = remoteStream;
      super.emit("stream", remoteStream);
    }
    handleMessage(message) {
      const type = message.type;
      const payload = message.payload;
      switch (message.type) {
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Answer:
          this._negotiator.handleSDP(type, payload.sdp);
          this._open = true;
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Candidate:
          this._negotiator.handleCandidate(payload.candidate);
          break;
        default:
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn(`Unrecognized message type:${type} from peer:${this.peer}`);
          break;
      }
    }
    answer(stream, options = {}) {
      if (this._localStream) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn("Local stream already exists on this MediaConnection. Are you answering a call twice?");
        return;
      }
      this._localStream = stream;
      if (options && options.sdpTransform)
        this.options.sdpTransform = options.sdpTransform;
      this._negotiator.startConnection({
        ...this.options._payload,
        _stream: stream
      });
      const messages = this.provider._getMessages(this.connectionId);
      for (const message of messages)
        this.handleMessage(message);
      this._open = true;
    }
    close() {
      if (this._negotiator) {
        this._negotiator.cleanup();
        this._negotiator = null;
      }
      this._localStream = null;
      this._remoteStream = null;
      if (this.provider) {
        this.provider._removeConnection(this);
        this.provider = null;
      }
      if (this.options && this.options._stream)
        this.options._stream = null;
      if (!this.open)
        return;
      this._open = false;
      super.emit("close");
    }
  }

  class $684fc411629b137b$export$2c4e825dc9120f87 {
    constructor(_options) {
      this._options = _options;
    }
    _buildRequest(method) {
      const protocol = this._options.secure ? "https" : "http";
      const { host, port, path, key } = this._options;
      const url = new URL(`${protocol}://${host}:${port}${path}${key}/${method}`);
      url.searchParams.set("ts", `${Date.now()}${Math.random()}`);
      url.searchParams.set("version", (0, $3a25eea6a06ee968$export$83d89fbfd8236492));
      return fetch(url.href, {
        referrerPolicy: this._options.referrerPolicy
      });
    }
    async retrieveId() {
      try {
        const response = await this._buildRequest("id");
        if (response.status !== 200)
          throw new Error(`Error. Status:${response.status}`);
        return response.text();
      } catch (error) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("Error retrieving ID", error);
        let pathError = "";
        if (this._options.path === "/" && this._options.host !== (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_HOST)
          pathError = " If you passed in a `path` to your self-hosted PeerServer, you'll also need to pass in that same path when creating a new Peer.";
        throw new Error("Could not get an ID from the server." + pathError);
      }
    }
    async listAllPeers() {
      try {
        const response = await this._buildRequest("peers");
        if (response.status !== 200) {
          if (response.status === 401) {
            let helpfulError = "";
            if (this._options.host === (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_HOST)
              helpfulError = "It looks like you're using the cloud server. You can email team@peerjs.com to enable peer listing for your API key.";
            else
              helpfulError = "You need to enable `allow_discovery` on your self-hosted PeerServer to use this feature.";
            throw new Error("It doesn't look like you have permission to list peers IDs. " + helpfulError);
          }
          throw new Error(`Error. Status:${response.status}`);
        }
        return response.json();
      } catch (error) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("Error retrieving list peers", error);
        throw new Error("Could not get list peers from the server." + error);
      }
    }
  }

  class $f188f8cb0f63b180$export$d365f7ad9d7df9c9 extends (0, $cb834ab0363d9153$export$23a2a68283c24d80) {
    static #_ = this.ID_PREFIX = "dc_";
    static #_2 = this.MAX_BUFFERED_AMOUNT = 8388608;
    get type() {
      return (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Data;
    }
    constructor(peerId, provider, options) {
      super(peerId, provider, options);
      this.connectionId = this.options.connectionId || $f188f8cb0f63b180$export$d365f7ad9d7df9c9.ID_PREFIX + (0, $6a375544f634961e$export$4e61f672936bec77)();
      this.label = this.options.label || this.connectionId;
      this.reliable = !!this.options.reliable;
      this._negotiator = new (0, $a8347a6741c5df8a$export$89e6bb5ad64bf4a)(this);
      this._negotiator.startConnection(this.options._payload || {
        originator: true,
        reliable: this.reliable
      });
    }
    _initializeDataChannel(dc) {
      this.dataChannel = dc;
      this.dataChannel.onopen = () => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} dc connection success`);
        this._open = true;
        this.emit("open");
      };
      this.dataChannel.onmessage = (e) => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} dc onmessage:`, e.data);
      };
      this.dataChannel.onclose = () => {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} dc closed for:`, this.peer);
        this.close();
      };
    }
    close(options) {
      if (options?.flush) {
        this.send({
          __peerData: {
            type: "close"
          }
        });
        return;
      }
      if (this._negotiator) {
        this._negotiator.cleanup();
        this._negotiator = null;
      }
      if (this.provider) {
        this.provider._removeConnection(this);
        this.provider = null;
      }
      if (this.dataChannel) {
        this.dataChannel.onopen = null;
        this.dataChannel.onmessage = null;
        this.dataChannel.onclose = null;
        this.dataChannel = null;
      }
      if (!this.open)
        return;
      this._open = false;
      super.emit("close");
    }
    send(data, chunked = false) {
      if (!this.open) {
        this.emitError((0, $1a7e7edd560505fc$export$49ae800c114df41d).NotOpenYet, "Connection is not open. You should listen for the `open` event before sending messages.");
        return;
      }
      return this._send(data, chunked);
    }
    async handleMessage(message) {
      const payload = message.payload;
      switch (message.type) {
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Answer:
          await this._negotiator.handleSDP(message.type, payload.sdp);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Candidate:
          await this._negotiator.handleCandidate(payload.candidate);
          break;
        default:
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn("Unrecognized message type:", message.type, "from peer:", this.peer);
          break;
      }
    }
  }

  class $8d5124d0cf36ebe0$export$ff7c9d4c11d94e8b extends (0, $f188f8cb0f63b180$export$d365f7ad9d7df9c9) {
    get bufferSize() {
      return this._bufferSize;
    }
    _initializeDataChannel(dc) {
      super._initializeDataChannel(dc);
      this.dataChannel.binaryType = "arraybuffer";
      this.dataChannel.addEventListener("message", (e) => this._handleDataMessage(e));
    }
    _bufferedSend(msg) {
      if (this._buffering || !this._trySend(msg)) {
        this._buffer.push(msg);
        this._bufferSize = this._buffer.length;
      }
    }
    _trySend(msg) {
      if (!this.open)
        return false;
      if (this.dataChannel.bufferedAmount > (0, $f188f8cb0f63b180$export$d365f7ad9d7df9c9).MAX_BUFFERED_AMOUNT) {
        this._buffering = true;
        setTimeout(() => {
          this._buffering = false;
          this._tryBuffer();
        }, 50);
        return false;
      }
      try {
        this.dataChannel.send(msg);
      } catch (e) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error(`DC#:${this.connectionId} Error when sending:`, e);
        this._buffering = true;
        this.close();
        return false;
      }
      return true;
    }
    _tryBuffer() {
      if (!this.open)
        return;
      if (this._buffer.length === 0)
        return;
      const msg = this._buffer[0];
      if (this._trySend(msg)) {
        this._buffer.shift();
        this._bufferSize = this._buffer.length;
        this._tryBuffer();
      }
    }
    close(options) {
      if (options?.flush) {
        this.send({
          __peerData: {
            type: "close"
          }
        });
        return;
      }
      this._buffer = [];
      this._bufferSize = 0;
      super.close();
    }
    constructor(...args) {
      super(...args), this._buffer = [], this._bufferSize = 0, this._buffering = false;
    }
  }

  class $9cfea3ad93e740b9$export$f0a5a64d5bb37108 extends (0, $8d5124d0cf36ebe0$export$ff7c9d4c11d94e8b) {
    close(options) {
      super.close(options);
      this._chunkedData = {};
    }
    constructor(peerId, provider, options) {
      super(peerId, provider, options), this.chunker = new (0, $7ce5389b504cc06c$export$f1c5f4c9cb95390b), this.serialization = (0, $1a7e7edd560505fc$export$89f507cf986a947).Binary, this._chunkedData = {};
    }
    _handleDataMessage({ data }) {
      const deserializedData = (0, $2QID2$peerjsjsbinarypack.unpack)(data);
      const peerData = deserializedData["__peerData"];
      if (peerData) {
        if (peerData.type === "close") {
          this.close();
          return;
        }
        this._handleChunk(deserializedData);
        return;
      }
      this.emit("data", deserializedData);
    }
    _handleChunk(data) {
      const id = data.__peerData;
      const chunkInfo = this._chunkedData[id] || {
        data: [],
        count: 0,
        total: data.total
      };
      chunkInfo.data[data.n] = new Uint8Array(data.data);
      chunkInfo.count++;
      this._chunkedData[id] = chunkInfo;
      if (chunkInfo.total === chunkInfo.count) {
        delete this._chunkedData[id];
        const data2 = (0, $7ce5389b504cc06c$export$52c89ebcdc4f53f2)(chunkInfo.data);
        this._handleDataMessage({
          data: data2
        });
      }
    }
    _send(data, chunked) {
      const blob = (0, $2QID2$peerjsjsbinarypack.pack)(data);
      if (blob instanceof Promise)
        return this._send_blob(blob);
      if (!chunked && blob.byteLength > this.chunker.chunkedMTU) {
        this._sendChunks(blob);
        return;
      }
      this._bufferedSend(blob);
    }
    async _send_blob(blobPromise) {
      const blob = await blobPromise;
      if (blob.byteLength > this.chunker.chunkedMTU) {
        this._sendChunks(blob);
        return;
      }
      this._bufferedSend(blob);
    }
    _sendChunks(blob) {
      const blobs = this.chunker.chunk(blob);
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`DC#${this.connectionId} Try to send ${blobs.length} chunks...`);
      for (const blob2 of blobs)
        this.send(blob2, true);
    }
  }

  class $c1c7a35edd5f55d2$export$6f88fe47d32c9c94 extends (0, $8d5124d0cf36ebe0$export$ff7c9d4c11d94e8b) {
    _handleDataMessage({ data }) {
      super.emit("data", data);
    }
    _send(data, _chunked) {
      this._bufferedSend(data);
    }
    constructor(...args) {
      super(...args), this.serialization = (0, $1a7e7edd560505fc$export$89f507cf986a947).None;
    }
  }

  class $f3415bb65bf67923$export$48880ac635f47186 extends (0, $8d5124d0cf36ebe0$export$ff7c9d4c11d94e8b) {
    _handleDataMessage({ data }) {
      const deserializedData = this.parse(this.decoder.decode(data));
      const peerData = deserializedData["__peerData"];
      if (peerData && peerData.type === "close") {
        this.close();
        return;
      }
      this.emit("data", deserializedData);
    }
    _send(data, _chunked) {
      const encodedData = this.encoder.encode(this.stringify(data));
      if (encodedData.byteLength >= (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).chunkedMTU) {
        this.emitError((0, $1a7e7edd560505fc$export$49ae800c114df41d).MessageToBig, "Message too big for JSON channel");
        return;
      }
      this._bufferedSend(encodedData);
    }
    constructor(...args) {
      super(...args), this.serialization = (0, $1a7e7edd560505fc$export$89f507cf986a947).JSON, this.encoder = new TextEncoder, this.decoder = new TextDecoder, this.stringify = JSON.stringify, this.parse = JSON.parse;
    }
  }

  class $2ddecb16305b5a82$export$ecd1fc136c422448 extends (0, $cf62563e7a9fbce5$export$6a678e589c8a4542) {
    static #_ = this.DEFAULT_KEY = "peerjs";
    get id() {
      return this._id;
    }
    get options() {
      return this._options;
    }
    get open() {
      return this._open;
    }
    get socket() {
      return this._socket;
    }
    get connections() {
      const plainConnections = Object.create(null);
      for (const [k, v] of this._connections)
        plainConnections[k] = v;
      return plainConnections;
    }
    get destroyed() {
      return this._destroyed;
    }
    get disconnected() {
      return this._disconnected;
    }
    constructor(id, options) {
      super(), this._serializers = {
        raw: (0, $c1c7a35edd5f55d2$export$6f88fe47d32c9c94),
        json: (0, $f3415bb65bf67923$export$48880ac635f47186),
        binary: (0, $9cfea3ad93e740b9$export$f0a5a64d5bb37108),
        "binary-utf8": (0, $9cfea3ad93e740b9$export$f0a5a64d5bb37108),
        default: (0, $9cfea3ad93e740b9$export$f0a5a64d5bb37108)
      }, this._id = null, this._lastServerId = null, this._destroyed = false, this._disconnected = false, this._open = false, this._connections = new Map, this._lostMessages = new Map;
      let userId;
      if (id && id.constructor == Object)
        options = id;
      else if (id)
        userId = id.toString();
      options = {
        debug: 0,
        host: (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_HOST,
        port: (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_PORT,
        path: "/",
        key: $2ddecb16305b5a82$export$ecd1fc136c422448.DEFAULT_KEY,
        token: (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).randomToken(),
        config: (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).defaultConfig,
        referrerPolicy: "strict-origin-when-cross-origin",
        serializers: {},
        ...options
      };
      this._options = options;
      this._serializers = {
        ...this._serializers,
        ...this.options.serializers
      };
      if (this._options.host === "/")
        this._options.host = window.location.hostname;
      if (this._options.path) {
        if (this._options.path[0] !== "/")
          this._options.path = "/" + this._options.path;
        if (this._options.path[this._options.path.length - 1] !== "/")
          this._options.path += "/";
      }
      if (this._options.secure === undefined && this._options.host !== (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_HOST)
        this._options.secure = (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).isSecure();
      else if (this._options.host == (0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).CLOUD_HOST)
        this._options.secure = true;
      if (this._options.logFunction)
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).setLogFunction(this._options.logFunction);
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).logLevel = this._options.debug || 0;
      this._api = new (0, $684fc411629b137b$export$2c4e825dc9120f87)(options);
      this._socket = this._createServerConnection();
      if (!(0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).supports.audioVideo && !(0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).supports.data) {
        this._delayedAbort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).BrowserIncompatible, "The current browser does not support WebRTC");
        return;
      }
      if (!!userId && !(0, $b83e6a166cc3008f$export$7debb50ef11d5e0b).validateId(userId)) {
        this._delayedAbort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).InvalidID, `ID "${userId}" is invalid`);
        return;
      }
      if (userId)
        this._initialize(userId);
      else
        this._api.retrieveId().then((id2) => this._initialize(id2)).catch((error) => this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).ServerError, error));
    }
    _createServerConnection() {
      const socket = new (0, $e5e868bf3ea73e5b$export$4798917dbf149b79)(this._options.secure, this._options.host, this._options.port, this._options.path, this._options.key, this._options.pingInterval);
      socket.on((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Message, (data) => {
        this._handleMessage(data);
      });
      socket.on((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Error, (error) => {
        this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).SocketError, error);
      });
      socket.on((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Disconnected, () => {
        if (this.disconnected)
          return;
        this.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).Network, "Lost connection to server.");
        this.disconnect();
      });
      socket.on((0, $1a7e7edd560505fc$export$3b5c4a4b6354f023).Close, () => {
        if (this.disconnected)
          return;
        this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).SocketClosed, "Underlying socket is already closed.");
      });
      return socket;
    }
    _initialize(id) {
      this._id = id;
      this.socket.start(id, this._options.token);
    }
    _handleMessage(message) {
      const type = message.type;
      const payload = message.payload;
      const peerId = message.src;
      switch (type) {
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Open:
          this._lastServerId = this.id;
          this._open = true;
          this.emit("open", this.id);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Error:
          this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).ServerError, payload.msg);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).IdTaken:
          this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).UnavailableID, `ID "${this.id}" is taken`);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).InvalidKey:
          this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).InvalidKey, `API KEY "${this._options.key}" is invalid`);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Leave:
          (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Received leave message from ${peerId}`);
          this._cleanupPeer(peerId);
          this._connections.delete(peerId);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Expire:
          this.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).PeerUnavailable, `Could not connect to peer ${peerId}`);
          break;
        case (0, $1a7e7edd560505fc$export$adb4a1754da6f10d).Offer: {
          const connectionId = payload.connectionId;
          let connection = this.getConnection(peerId, connectionId);
          if (connection) {
            connection.close();
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn(`Offer received for existing Connection ID:${connectionId}`);
          }
          if (payload.type === (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Media) {
            const mediaConnection = new (0, $f3a554d4328c6b5f$export$4a84e95a2324ac29)(peerId, this, {
              connectionId,
              _payload: payload,
              metadata: payload.metadata
            });
            connection = mediaConnection;
            this._addConnection(peerId, connection);
            this.emit("call", mediaConnection);
          } else if (payload.type === (0, $1a7e7edd560505fc$export$3157d57b4135e3bc).Data) {
            const dataConnection = new this._serializers[payload.serialization](peerId, this, {
              connectionId,
              _payload: payload,
              metadata: payload.metadata,
              label: payload.label,
              serialization: payload.serialization,
              reliable: payload.reliable
            });
            connection = dataConnection;
            this._addConnection(peerId, connection);
            this.emit("connection", dataConnection);
          } else {
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn(`Received malformed connection type:${payload.type}`);
            return;
          }
          const messages = this._getMessages(connectionId);
          for (const message2 of messages)
            connection.handleMessage(message2);
          break;
        }
        default: {
          if (!payload) {
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn(`You received a malformed message from ${peerId} of type ${type}`);
            return;
          }
          const connectionId = payload.connectionId;
          const connection = this.getConnection(peerId, connectionId);
          if (connection && connection.peerConnection)
            connection.handleMessage(message);
          else if (connectionId)
            this._storeMessage(connectionId, message);
          else
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn("You received an unrecognized message:", message);
          break;
        }
      }
    }
    _storeMessage(connectionId, message) {
      if (!this._lostMessages.has(connectionId))
        this._lostMessages.set(connectionId, []);
      this._lostMessages.get(connectionId).push(message);
    }
    _getMessages(connectionId) {
      const messages = this._lostMessages.get(connectionId);
      if (messages) {
        this._lostMessages.delete(connectionId);
        return messages;
      }
      return [];
    }
    connect(peer, options = {}) {
      options = {
        serialization: "default",
        ...options
      };
      if (this.disconnected) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect, or call reconnect on this peer if you believe its ID to still be available.");
        this.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).Disconnected, "Cannot connect to new Peer after disconnecting from server.");
        return;
      }
      const dataConnection = new this._serializers[options.serialization](peer, this, options);
      this._addConnection(peer, dataConnection);
      return dataConnection;
    }
    call(peer, stream, options = {}) {
      if (this.disconnected) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect.");
        this.emitError((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).Disconnected, "Cannot connect to new Peer after disconnecting from server.");
        return;
      }
      if (!stream) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("To call a peer, you must provide a stream from your browser's `getUserMedia`.");
        return;
      }
      const mediaConnection = new (0, $f3a554d4328c6b5f$export$4a84e95a2324ac29)(peer, this, {
        ...options,
        _stream: stream
      });
      this._addConnection(peer, mediaConnection);
      return mediaConnection;
    }
    _addConnection(peerId, connection) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`add connection ${connection.type}:${connection.connectionId} to peerId:${peerId}`);
      if (!this._connections.has(peerId))
        this._connections.set(peerId, []);
      this._connections.get(peerId).push(connection);
    }
    _removeConnection(connection) {
      const connections = this._connections.get(connection.peer);
      if (connections) {
        const index = connections.indexOf(connection);
        if (index !== -1)
          connections.splice(index, 1);
      }
      this._lostMessages.delete(connection.connectionId);
    }
    getConnection(peerId, connectionId) {
      const connections = this._connections.get(peerId);
      if (!connections)
        return null;
      for (const connection of connections) {
        if (connection.connectionId === connectionId)
          return connection;
      }
      return null;
    }
    _delayedAbort(type, message) {
      setTimeout(() => {
        this._abort(type, message);
      }, 0);
    }
    _abort(type, message) {
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("Aborting!");
      this.emitError(type, message);
      if (!this._lastServerId)
        this.destroy();
      else
        this.disconnect();
    }
    destroy() {
      if (this.destroyed)
        return;
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Destroy peer with ID:${this.id}`);
      this.disconnect();
      this._cleanup();
      this._destroyed = true;
      this.emit("close");
    }
    _cleanup() {
      for (const peerId of this._connections.keys()) {
        this._cleanupPeer(peerId);
        this._connections.delete(peerId);
      }
      this.socket.removeAllListeners();
    }
    _cleanupPeer(peerId) {
      const connections = this._connections.get(peerId);
      if (!connections)
        return;
      for (const connection of connections)
        connection.close();
    }
    disconnect() {
      if (this.disconnected)
        return;
      const currentId = this.id;
      (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Disconnect peer with ID:${currentId}`);
      this._disconnected = true;
      this._open = false;
      this.socket.close();
      this._lastServerId = currentId;
      this._id = null;
      this.emit("disconnected", currentId);
    }
    reconnect() {
      if (this.disconnected && !this.destroyed) {
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).log(`Attempting reconnection to server with ID ${this._lastServerId}`);
        this._disconnected = false;
        this._initialize(this._lastServerId);
      } else if (this.destroyed)
        throw new Error("This peer cannot reconnect to the server. It has already been destroyed.");
      else if (!this.disconnected && !this.open)
        (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error("In a hurry? We're still trying to make the initial connection!");
      else
        throw new Error(`Peer ${this.id} cannot reconnect because it is not disconnected from the server!`);
    }
    listAllPeers(cb = (_) => {}) {
      this._api.listAllPeers().then((peers) => cb(peers)).catch((error) => this._abort((0, $1a7e7edd560505fc$export$9547aaa2e39030ff).ServerError, error));
    }
  }

  class $544799118fa637e6$export$72aa44612e2200cd extends (0, $f188f8cb0f63b180$export$d365f7ad9d7df9c9) {
    constructor(peerId, provider, options) {
      super(peerId, provider, {
        ...options,
        reliable: true
      }), this._CHUNK_SIZE = 32768, this._splitStream = new TransformStream({
        transform: (chunk, controller) => {
          for (let split2 = 0;split2 < chunk.length; split2 += this._CHUNK_SIZE)
            controller.enqueue(chunk.subarray(split2, split2 + this._CHUNK_SIZE));
        }
      }), this._rawSendStream = new WritableStream({
        write: async (chunk, controller) => {
          const openEvent = new Promise((resolve) => this.dataChannel.addEventListener("bufferedamountlow", resolve, {
            once: true
          }));
          await (this.dataChannel.bufferedAmount <= (0, $f188f8cb0f63b180$export$d365f7ad9d7df9c9).MAX_BUFFERED_AMOUNT - chunk.byteLength || openEvent);
          try {
            this.dataChannel.send(chunk);
          } catch (e) {
            (0, $df9d8b89ee908b8b$export$2e2bcd8739ae039).error(`DC#:${this.connectionId} Error when sending:`, e);
            controller.error(e);
            this.close();
          }
        }
      }), this.writer = this._splitStream.writable.getWriter(), this._rawReadStream = new ReadableStream({
        start: (controller) => {
          this.once("open", () => {
            this.dataChannel.addEventListener("message", (e) => {
              controller.enqueue(e.data);
            });
          });
        }
      });
      this._splitStream.readable.pipeTo(this._rawSendStream);
    }
    _initializeDataChannel(dc) {
      super._initializeDataChannel(dc);
      this.dataChannel.binaryType = "arraybuffer";
      this.dataChannel.bufferedAmountLowThreshold = (0, $f188f8cb0f63b180$export$d365f7ad9d7df9c9).MAX_BUFFERED_AMOUNT / 2;
    }
  }

  class $7e477efb76e02214$export$80f5de1a66c4d624 extends (0, $544799118fa637e6$export$72aa44612e2200cd) {
    constructor(peerId, provider, options) {
      super(peerId, provider, options), this.serialization = "MsgPack", this._encoder = new (0, $2QID2$msgpackmsgpack.Encoder);
      (async () => {
        for await (const msg of (0, $2QID2$msgpackmsgpack.decodeMultiStream)(this._rawReadStream)) {
          if (msg.__peerData?.type === "close") {
            this.close();
            return;
          }
          this.emit("data", msg);
        }
      })();
    }
    _send(data) {
      return this.writer.write(this._encoder.encode(data));
    }
  }

  class $8c8805059443e9b3$export$d72c7bf8eef50853 extends (0, $2ddecb16305b5a82$export$ecd1fc136c422448) {
    constructor(...args) {
      super(...args), this._serializers = {
        MsgPack: $7e477efb76e02214$export$80f5de1a66c4d624,
        default: (0, $7e477efb76e02214$export$80f5de1a66c4d624)
      };
    }
  }
  var $8c8bca0fa9aa4b8b$export$2e2bcd8739ae039 = (0, $2ddecb16305b5a82$export$ecd1fc136c422448);
  $parcel$exportWildcard(exports, $1a7e7edd560505fc$exports);
});

// src/peer/polyfill.ts
if (typeof RTCPeerConnection === "undefined") {
  try {
    const dc = __require("node-datachannel/polyfill");
    const globals = {
      RTCPeerConnection: dc["RTCPeerConnection"],
      RTCIceCandidate: dc["RTCIceCandidate"],
      RTCSessionDescription: dc["RTCSessionDescription"],
      RTCDataChannel: dc["RTCDataChannel"],
      RTCDataChannelEvent: dc["RTCDataChannelEvent"],
      RTCIceTransport: dc["RTCIceTransport"],
      RTCPeerConnectionIceEvent: dc["RTCPeerConnectionIceEvent"],
      MediaStream: dc["MediaStream"]
    };
    for (const [key, val] of Object.entries(globals)) {
      if (val !== undefined) {
        globalThis[key] = val;
      }
    }
  } catch (e) {
    throw new Error(`node-datachannel not available. Run: npm install node-datachannel
Original: ${e}`);
  }
}

// src/bridge.ts
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/peer.ts
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
import { mkdirSync as mkdirSync2 } from "node:fs";
import { randomUUID as randomUUID2 } from "node:crypto";

// ../decent-protocol/dist/crypto/HashChain.js
class HashChain {
  async hashMessage(message) {
    const data = this.canonicalize(message);
    const encoder = new TextEncoder;
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    return this.bufferToHex(buffer);
  }
  async verifyChain(prevMessage, currentMessage) {
    const expectedHash = await this.hashMessage(prevMessage);
    return currentMessage.prevHash === expectedHash;
  }
  async verifyFullChain(messages) {
    if (messages.length === 0) {
      return { valid: true };
    }
    if (messages[0].prevHash !== GENESIS_HASH) {
      return {
        valid: false,
        brokenAt: 0,
        reason: `First message has invalid genesis hash. Expected ${GENESIS_HASH}, got ${messages[0].prevHash}`
      };
    }
    for (let i = 1;i < messages.length; i++) {
      const expectedHash = await this.hashMessage(messages[i - 1]);
      if (messages[i].prevHash !== expectedHash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `Hash chain broken at message ${i}. Expected prevHash ${expectedHash}, got ${messages[i].prevHash}`
        };
      }
    }
    return { valid: true };
  }
  getGenesisHash() {
    return GENESIS_HASH;
  }
  canonicalize(message) {
    return JSON.stringify({
      id: message.id,
      senderId: message.senderId,
      timestamp: message.timestamp,
      content: message.content,
      type: message.type,
      prevHash: message.prevHash
    });
  }
  bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
var GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
// ../decent-protocol/dist/crypto/CryptoManager.js
class CryptoManager {
  constructor() {
    Object.defineProperty(this, "keyPair", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
  }
  setKeyPair(keyPair) {
    this.keyPair = keyPair;
  }
  async generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey({
      name: "ECDH",
      namedCurve: "P-256"
    }, true, ["deriveKey", "deriveBits"]);
    this.keyPair = keyPair;
    return keyPair;
  }
  async getKeyPair() {
    if (!this.keyPair) {
      return await this.generateKeyPair();
    }
    return this.keyPair;
  }
  async exportPublicKey(publicKey) {
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    return btoa(JSON.stringify(jwk));
  }
  async importPublicKey(publicKeyBase64) {
    const jwk = JSON.parse(atob(publicKeyBase64));
    return await crypto.subtle.importKey("jwk", jwk, {
      name: "ECDH",
      namedCurve: "P-256"
    }, true, []);
  }
  async deriveSharedSecret(peerPublicKey, privateKey, myPeerId, theirPeerId) {
    const keyPair = await this.getKeyPair();
    const privKey = privateKey || keyPair.privateKey;
    const sharedSecret = await crypto.subtle.deriveBits({
      name: "ECDH",
      public: peerPublicKey
    }, privKey, 256);
    const importedSecret = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
    let salt;
    if (myPeerId && theirPeerId) {
      const pair = [myPeerId, theirPeerId].sort().join(":");
      const hashedSalt = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair));
      salt = new Uint8Array(hashedSalt);
    } else {
      salt = new TextEncoder().encode("decent-protocol-v1");
    }
    return await crypto.subtle.deriveKey({
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("p2p-chat-aes-gcm")
    }, importedSecret, {
      name: "AES-GCM",
      length: 256
    }, false, ["encrypt", "decrypt"]);
  }
  async deriveSharedSecretFromRawBytes(rawEcdhBytes, myPeerId, theirPeerId) {
    const importedSecret = await crypto.subtle.importKey("raw", rawEcdhBytes, "HKDF", false, ["deriveKey"]);
    const pair = [myPeerId, theirPeerId].sort().join(":");
    const hashedSalt = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair));
    const salt = new Uint8Array(hashedSalt);
    return await crypto.subtle.deriveKey({
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("p2p-chat-aes-gcm")
    }, importedSecret, {
      name: "AES-GCM",
      length: 256
    }, false, ["encrypt", "decrypt"]);
  }
  async importSigningPublicKey(publicKeyBase64) {
    const jwk = JSON.parse(atob(publicKeyBase64));
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  }
  async generateSigningKeyPair() {
    return await crypto.subtle.generateKey({
      name: "ECDSA",
      namedCurve: "P-256"
    }, true, ["sign", "verify"]);
  }
  async serializeKeyPair(keyPair) {
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    return {
      publicKey: btoa(JSON.stringify(publicJwk)),
      privateKey: btoa(JSON.stringify(privateJwk))
    };
  }
  async deserializeKeyPair(serialized, algorithm, _usages) {
    const publicJwk = JSON.parse(atob(serialized.publicKey));
    const privateJwk = JSON.parse(atob(serialized.privateKey));
    const alg = algorithm === "ECDH" ? { name: "ECDH", namedCurve: "P-256" } : { name: "ECDSA", namedCurve: "P-256" };
    const publicUsages = algorithm === "ECDH" ? [] : ["verify"];
    const privateUsages = algorithm === "ECDH" ? ["deriveKey", "deriveBits"] : ["sign"];
    const publicKey = await crypto.subtle.importKey("jwk", publicJwk, alg, true, publicUsages);
    const privateKey = await crypto.subtle.importKey("jwk", privateJwk, alg, true, privateUsages);
    return { publicKey, privateKey };
  }
}
// ../decent-protocol/dist/crypto/MessageCipher.js
class MessageCipher {
  async encrypt(plaintext, sharedSecret) {
    const encoder = new TextEncoder;
    const data = encoder.encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv,
      tagLength: 128
    }, sharedSecret, data);
    const ciphertextArray = new Uint8Array(ciphertext);
    const ciphertextWithoutTag = ciphertextArray.slice(0, -16);
    const tag = ciphertextArray.slice(-16);
    return {
      ciphertext: this.arrayBufferToBase64(ciphertextWithoutTag),
      iv: this.arrayBufferToBase64(iv),
      tag: this.arrayBufferToBase64(tag)
    };
  }
  async decrypt(encrypted, sharedSecret) {
    const ciphertext = this.base64ToArrayBuffer(encrypted.ciphertext);
    const iv = this.base64ToArrayBuffer(encrypted.iv);
    const tag = this.base64ToArrayBuffer(encrypted.tag);
    const combined = new Uint8Array(ciphertext.byteLength + tag.byteLength);
    combined.set(new Uint8Array(ciphertext), 0);
    combined.set(new Uint8Array(tag), ciphertext.byteLength);
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: new Uint8Array(iv),
      tagLength: 128
    }, sharedSecret, combined);
    const decoder = new TextDecoder;
    return decoder.decode(plaintext);
  }
  async sign(data, privateKey) {
    const encoder = new TextEncoder;
    const dataBuffer = encoder.encode(data);
    const signature = await crypto.subtle.sign({
      name: "ECDSA",
      hash: "SHA-256"
    }, privateKey, dataBuffer);
    return this.arrayBufferToBase64(signature);
  }
  async verify(data, signature, publicKey) {
    const encoder = new TextEncoder;
    const dataBuffer = encoder.encode(data);
    const signatureBuffer = this.base64ToArrayBuffer(signature);
    return await crypto.subtle.verify({
      name: "ECDSA",
      hash: "SHA-256"
    }, publicKey, signatureBuffer, dataBuffer);
  }
  async createSignedMessage(data, privateKey) {
    const signature = await this.sign(data, privateKey);
    return {
      data: btoa(data),
      signature
    };
  }
  async verifySignedMessage(signedMessage, publicKey) {
    const data = atob(signedMessage.data);
    const isValid = await this.verify(data, signedMessage.signature, publicKey);
    if (!isValid) {
      return null;
    }
    return data;
  }
  arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0;i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0;i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
// ../decent-protocol/dist/messages/messageLimits.js
var MAX_MESSAGE_CHARS = 16000;
function validateMessageContentLength(content) {
  if (content.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Message too long (${content.length}/${MAX_MESSAGE_CHARS} chars)`);
  }
}
// ../decent-protocol/dist/crdt/Negentropy.js
var EMPTY_FINGERPRINT = "0".repeat(64);
var DEFAULT_MAX_ROUNDS = 24;
var ENUMERATE_THRESHOLD = 256;
var SPLIT_BUCKETS = 16;

class Negentropy {
  constructor() {
    Object.defineProperty(this, "items", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: []
    });
    Object.defineProperty(this, "entries", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: []
    });
    Object.defineProperty(this, "itemMap", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
  }
  async build(items) {
    this.items = [...items].sort((a, b) => {
      if (a.timestamp !== b.timestamp)
        return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });
    const hashes = await Promise.all(this.items.map((item) => this.hashItem(item)));
    this.entries = this.items.map((item, i) => ({
      key: this.makeKey(item),
      item,
      hash: hashes[i]
    }));
    this.itemMap = new Map(this.items.map((item) => [item.id, item]));
  }
  async createQuery() {
    if (this.entries.length === 0) {
      return { ranges: [] };
    }
    return {
      ranges: [{
        start: null,
        end: null,
        fingerprint: this.fingerprintEntries(this.entries),
        count: this.entries.length
      }]
    };
  }
  async processQuery(query) {
    const have = new Set;
    const continueWith = [];
    const enumeratedRanges = [];
    if (query.ranges.length === 0) {
      for (const entry of this.entries) {
        have.add(entry.item.id);
      }
      return { have: [...have], need: [], enumeratedRanges: [{ start: null, end: null }] };
    }
    for (const remoteRange of query.ranges) {
      const localEntries = this.getEntriesInRange(remoteRange.start, remoteRange.end);
      const localFingerprint = this.fingerprintEntries(localEntries);
      if (remoteRange.count === localEntries.length && remoteRange.fingerprint === localFingerprint) {
        continue;
      }
      const smallerSide = Math.min(remoteRange.count, localEntries.length);
      if (smallerSide <= ENUMERATE_THRESHOLD || localEntries.length <= 1 || remoteRange.count <= 1) {
        for (const entry of localEntries) {
          have.add(entry.item.id);
        }
        enumeratedRanges.push({ start: remoteRange.start, end: remoteRange.end });
        continue;
      }
      const partitions = this.partitionRange(remoteRange, localEntries);
      for (const partition of partitions) {
        const partEntries = this.getEntriesInRange(partition.start, partition.end);
        continueWith.push({
          start: partition.start,
          end: partition.end,
          count: partEntries.length,
          fingerprint: this.fingerprintEntries(partEntries)
        });
      }
    }
    return {
      have: [...have],
      need: [],
      continueWith: continueWith.length > 0 ? continueWith : undefined,
      enumeratedRanges: enumeratedRanges.length > 0 ? enumeratedRanges : undefined
    };
  }
  async reconcile(remoteProcessQuery, maxRounds = DEFAULT_MAX_ROUNDS) {
    const localIds = new Set(this.items.map((item) => item.id));
    const need = new Set;
    const remoteHave = new Set;
    const excess = new Set;
    let query = await this.createQuery();
    for (let round = 0;round < maxRounds; round++) {
      const response = await remoteProcessQuery(query);
      for (const id of response.have) {
        remoteHave.add(id);
        if (!localIds.has(id)) {
          need.add(id);
        }
      }
      if (response.enumeratedRanges) {
        for (const range of response.enumeratedRanges) {
          for (const entry of this.getEntriesInRange(range.start, range.end)) {
            if (!remoteHave.has(entry.item.id)) {
              excess.add(entry.item.id);
            }
          }
        }
      }
      if (!response.continueWith || response.continueWith.length === 0) {
        break;
      }
      const nextRanges = [];
      for (const requestedRange of response.continueWith) {
        const localEntries = this.getEntriesInRange(requestedRange.start, requestedRange.end);
        nextRanges.push({
          start: requestedRange.start,
          end: requestedRange.end,
          count: localEntries.length,
          fingerprint: this.fingerprintEntries(localEntries)
        });
      }
      query = { ranges: nextRanges };
    }
    return { need: [...need], excess: [...excess] };
  }
  getItem(id) {
    return this.itemMap.get(id);
  }
  getItems() {
    return [...this.items];
  }
  size() {
    return this.items.length;
  }
  makeKey(item) {
    return `${item.timestamp.toString().padStart(16, "0")}:${item.id}`;
  }
  getEntriesInRange(start, end) {
    if (this.entries.length === 0)
      return [];
    const startIdx = start === null ? 0 : this.lowerBound(start);
    const endIdx = end === null ? this.entries.length : this.lowerBound(end);
    if (startIdx >= endIdx)
      return [];
    return this.entries.slice(startIdx, endIdx);
  }
  lowerBound(key) {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (this.entries[mid].key < key) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
  partitionRange(range, localEntries) {
    if (localEntries.length === 0) {
      return [{ start: range.start, end: range.end }];
    }
    const segments = Math.min(SPLIT_BUCKETS, localEntries.length);
    if (segments <= 1) {
      return [{ start: range.start, end: range.end }];
    }
    const boundaries = [range.start];
    for (let i = 1;i < segments; i++) {
      const idx = Math.floor(i * localEntries.length / segments);
      boundaries.push(localEntries[idx].key);
    }
    boundaries.push(range.end);
    const ranges = [];
    for (let i = 0;i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (start !== null && end !== null && start >= end)
        continue;
      ranges.push({ start, end });
    }
    return ranges.length > 0 ? ranges : [{ start: range.start, end: range.end }];
  }
  fingerprintEntries(entries) {
    if (entries.length === 0)
      return EMPTY_FINGERPRINT;
    const xor = new Uint8Array(32);
    for (const entry of entries) {
      const hash = entry.hash;
      for (let i = 0;i < xor.length; i++) {
        xor[i] ^= hash[i];
      }
    }
    let hex = "";
    for (let i = 0;i < xor.length; i++) {
      hex += xor[i].toString(16).padStart(2, "0");
    }
    return hex;
  }
  async hashItem(item) {
    const payload = new TextEncoder().encode(`${item.id}:${item.timestamp}`);
    const digest = await crypto.subtle.digest("SHA-256", payload);
    return new Uint8Array(digest);
  }
}
// ../decent-protocol/dist/workspace/types.js
var WorkspaceRole;
(function(WorkspaceRole2) {
  WorkspaceRole2["Owner"] = "owner";
  WorkspaceRole2["Admin"] = "admin";
  WorkspaceRole2["Member"] = "member";
})(WorkspaceRole || (WorkspaceRole = {}));
var DEFAULT_WORKSPACE_PERMISSIONS = {
  whoCanCreateChannels: "everyone",
  whoCanInviteMembers: "everyone",
  revokedInviteIds: []
};

// ../decent-protocol/dist/workspace/WorkspaceManager.js
class WorkspaceManager {
  constructor() {
    Object.defineProperty(this, "workspaces", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
  }
  createWorkspace(name, myPeerId, myAlias, myPublicKey, opts) {
    const workspaceId = opts?.workspaceId || this.generateId();
    const workspace = {
      id: workspaceId,
      name,
      inviteCode: opts?.inviteCode || this.generateInviteCode(),
      createdBy: myPeerId,
      createdAt: Date.now(),
      members: [
        {
          peerId: myPeerId,
          alias: myAlias,
          publicKey: myPublicKey,
          joinedAt: Date.now(),
          role: "owner",
          allowWorkspaceDMs: true
        }
      ],
      channels: [],
      permissions: { ...DEFAULT_WORKSPACE_PERMISSIONS },
      bans: []
    };
    const general = {
      id: this.generateId(),
      workspaceId: workspace.id,
      name: "general",
      type: "channel",
      members: [myPeerId],
      accessPolicy: { mode: "public-workspace" },
      createdBy: myPeerId,
      createdAt: Date.now()
    };
    workspace.channels.push(general);
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }
  getWorkspace(id) {
    return this.workspaces.get(id);
  }
  getAllWorkspaces() {
    return Array.from(this.workspaces.values());
  }
  deleteWorkspace(id, requesterId) {
    const workspace = this.workspaces.get(id);
    if (!workspace)
      return false;
    if (!this.isOwner(id, requesterId))
      return false;
    this.workspaces.delete(id);
    return true;
  }
  removeWorkspace(id) {
    this.workspaces.delete(id);
  }
  getPermissions(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    const perms = workspace?.permissions ?? { ...DEFAULT_WORKSPACE_PERMISSIONS };
    return {
      ...perms,
      revokedInviteIds: Array.isArray(perms.revokedInviteIds) ? [...new Set(perms.revokedInviteIds)] : []
    };
  }
  updatePermissions(workspaceId, actorPeerId, permissions) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.isAdmin(workspaceId, actorPeerId)) {
      return { success: false, error: "Only admins and owners can change workspace settings" };
    }
    const next = {
      ...workspace.permissions ?? { ...DEFAULT_WORKSPACE_PERMISSIONS },
      ...permissions
    };
    if (permissions.revokedInviteIds !== undefined) {
      next.revokedInviteIds = Array.from(new Set(permissions.revokedInviteIds.map((id) => String(id || "").trim()).filter((id) => id.length > 0)));
    } else {
      next.revokedInviteIds = Array.isArray(next.revokedInviteIds) ? [...new Set(next.revokedInviteIds)] : [];
    }
    workspace.permissions = next;
    return { success: true };
  }
  updateWorkspaceInfo(workspaceId, actorPeerId, updates) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.isAdmin(workspaceId, actorPeerId)) {
      return { success: false, error: "Only admins and owners can change workspace info" };
    }
    if (updates.name !== undefined)
      workspace.name = updates.name;
    if (updates.description !== undefined)
      workspace.description = updates.description;
    return { success: true };
  }
  isOwner(workspaceId, peerId) {
    const member = this.getMember(workspaceId, peerId);
    return member?.role === "owner";
  }
  isAdmin(workspaceId, peerId) {
    const member = this.getMember(workspaceId, peerId);
    return member?.role === "owner" || member?.role === "admin";
  }
  canCreateChannel(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const member = workspace.members.find((m) => m.peerId === peerId);
    if (!member)
      return false;
    return this.isAdmin(workspaceId, peerId);
  }
  canRemoveChannel(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const member = workspace.members.find((m) => m.peerId === peerId);
    if (!member)
      return false;
    return this.isAdmin(workspaceId, peerId);
  }
  canInviteMembers(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const member = workspace.members.find((m) => m.peerId === peerId);
    if (!member)
      return false;
    const perms = workspace.permissions ?? DEFAULT_WORKSPACE_PERMISSIONS;
    if (perms.whoCanInviteMembers === "everyone")
      return true;
    return this.isAdmin(workspaceId, peerId);
  }
  isInviteRevoked(workspaceId, inviteId) {
    if (!inviteId)
      return false;
    const perms = this.getPermissions(workspaceId);
    return (perms.revokedInviteIds || []).includes(inviteId);
  }
  canRemoveMember(workspaceId, actorPeerId, targetPeerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const actor = workspace.members.find((m) => m.peerId === actorPeerId);
    const target = workspace.members.find((m) => m.peerId === targetPeerId);
    if (!actor || !target)
      return false;
    if (target.role === "owner")
      return false;
    return actor.role === "owner" || actor.role === "admin";
  }
  canPromoteMember(workspaceId, actorPeerId) {
    return this.isOwner(workspaceId, actorPeerId);
  }
  promoteMember(workspaceId, actorPeerId, targetPeerId, newRole) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    const actor = workspace.members.find((m) => m.peerId === actorPeerId);
    const target = workspace.members.find((m) => m.peerId === targetPeerId);
    if (!actor || !target)
      return { success: false, error: "Member not found" };
    if (actor.role !== "owner") {
      return { success: false, error: "Only the owner can promote members" };
    }
    if (newRole === "owner") {
      return { success: false, error: "Cannot promote to owner — use ownership transfer instead" };
    }
    if (target.role === "owner" || target.role === "admin") {
      return { success: false, error: `Member is already ${target.role}` };
    }
    target.role = newRole;
    return { success: true };
  }
  demoteMember(workspaceId, actorPeerId, targetPeerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    const actor = workspace.members.find((m) => m.peerId === actorPeerId);
    const target = workspace.members.find((m) => m.peerId === targetPeerId);
    if (!actor || !target)
      return { success: false, error: "Member not found" };
    if (actor.role !== "owner") {
      return { success: false, error: "Only the owner can demote members" };
    }
    if (target.role === "owner") {
      return { success: false, error: "Cannot demote the owner" };
    }
    if (target.role === "member") {
      return { success: false, error: "Member is already a regular member" };
    }
    target.role = "member";
    return { success: true };
  }
  addMember(workspaceId, member) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (workspace.members.find((m) => m.peerId === member.peerId)) {
      return { success: false, error: "Member already exists" };
    }
    if (this.isBanned(workspaceId, member.peerId)) {
      return { success: false, error: "Peer is banned from this workspace" };
    }
    const normalizedMember = {
      ...member,
      allowWorkspaceDMs: member.allowWorkspaceDMs !== false,
      companySim: member.companySim
    };
    workspace.members.push(normalizedMember);
    for (const channel of workspace.channels) {
      if (channel.type === "channel" && !this.isPublicWorkspaceChannel(channel) && !channel.members.includes(normalizedMember.peerId)) {
        channel.members.push(normalizedMember.peerId);
      }
    }
    return { success: true };
  }
  removeMember(workspaceId, peerId, requesterId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.canRemoveMember(workspaceId, requesterId, peerId)) {
      const target = workspace.members.find((m) => m.peerId === peerId);
      if (target?.role === "owner")
        return { success: false, error: "Cannot remove owner" };
      return { success: false, error: "Only owner or admin can remove members" };
    }
    workspace.members = workspace.members.filter((m) => m.peerId !== peerId);
    for (const channel of workspace.channels) {
      if (!this.isPublicWorkspaceChannel(channel)) {
        channel.members = channel.members.filter((id) => id !== peerId);
      }
    }
    return { success: true };
  }
  banMember(workspaceId, targetPeerId, requesterId, opts) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.canRemoveMember(workspaceId, requesterId, targetPeerId)) {
      const target = workspace.members.find((m) => m.peerId === targetPeerId);
      if (target?.role === "owner")
        return { success: false, error: "Cannot ban owner" };
      return { success: false, error: "Only owner or admin can ban members" };
    }
    workspace.bans = workspace.bans || [];
    workspace.bans = workspace.bans.filter((b) => b.peerId !== targetPeerId);
    const now = Date.now();
    const durationMs = opts?.durationMs;
    const ban = {
      peerId: targetPeerId,
      bannedBy: requesterId,
      bannedAt: now,
      ...Number.isFinite(durationMs) && durationMs > 0 ? { expiresAt: now + durationMs } : {},
      ...opts?.reason ? { reason: opts.reason } : {}
    };
    workspace.bans.push(ban);
    workspace.members = workspace.members.filter((m) => m.peerId !== targetPeerId);
    for (const channel of workspace.channels) {
      if (!this.isPublicWorkspaceChannel(channel)) {
        channel.members = channel.members.filter((id) => id !== targetPeerId);
      }
    }
    return { success: true, ban };
  }
  unbanMember(workspaceId, targetPeerId, requesterId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.isAdmin(workspaceId, requesterId)) {
      return { success: false, error: "Only owner or admin can unban members" };
    }
    workspace.bans = (workspace.bans || []).filter((b) => b.peerId !== targetPeerId);
    return { success: true };
  }
  isBanned(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const bans = workspace.bans || [];
    const now = Date.now();
    let hasActiveBan = false;
    workspace.bans = bans.filter((ban) => {
      const expired = Number.isFinite(ban.expiresAt) && ban.expiresAt <= now;
      if (expired)
        return false;
      if (ban.peerId === peerId)
        hasActiveBan = true;
      return true;
    });
    return hasActiveBan;
  }
  getMember(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.members.find((m) => m.peerId === peerId);
  }
  getMemberByIdentity(workspaceId, identityId) {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.members.find((m) => m.identityId === identityId);
  }
  createChannel(workspaceId, name, createdBy, type = "channel", members) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!workspace.members.find((m) => m.peerId === createdBy)) {
      return { success: false, error: "Not a workspace member" };
    }
    if (type === "channel" && !this.canCreateChannel(workspaceId, createdBy)) {
      return { success: false, error: "Only admins can create channels" };
    }
    if (type === "channel" && workspace.channels.find((c) => c.name === name && c.type === "channel")) {
      return { success: false, error: `Channel #${name} already exists` };
    }
    const accessPolicy = type === "dm" ? { mode: "dm", explicitMemberPeerIds: members || [createdBy] } : members ? { mode: "explicit", explicitMemberPeerIds: [...members] } : { mode: "public-workspace" };
    const channel = {
      id: this.generateId(),
      workspaceId,
      name,
      type,
      members: members || workspace.members.map((m) => m.peerId),
      accessPolicy,
      createdBy,
      createdAt: Date.now()
    };
    workspace.channels.push(channel);
    return { success: true, channel };
  }
  getChannel(workspaceId, channelId) {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.find((c) => c.id === channelId);
  }
  getChannels(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.filter((c) => c.type === "channel") || [];
  }
  removeChannel(workspaceId, channelId, removedBy) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    if (!this.canRemoveChannel(workspaceId, removedBy)) {
      return { success: false, error: "Only admins can remove channels" };
    }
    const channel = workspace.channels.find((c) => c.id === channelId);
    if (!channel)
      return { success: false, error: "Channel not found" };
    if (channel.type !== "channel") {
      return { success: false, error: "Only regular channels can be removed" };
    }
    if (channel.name === "general") {
      return { success: false, error: "Cannot remove #general channel" };
    }
    workspace.channels = workspace.channels.filter((c) => c.id !== channelId);
    return { success: true };
  }
  createDM(workspaceId, peerId1, peerId2) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return { success: false, error: "Workspace not found" };
    const existingDM = workspace.channels.find((c) => c.type === "dm" && c.members.length === 2 && c.members.includes(peerId1) && c.members.includes(peerId2));
    if (existingDM) {
      return { success: true, channel: existingDM };
    }
    const member1 = workspace.members.find((m) => m.peerId === peerId1);
    const member2 = workspace.members.find((m) => m.peerId === peerId2);
    if (!member1 || !member2)
      return { success: false, error: "Members not found in workspace" };
    return this.createChannel(workspaceId, `${member1.alias}, ${member2.alias}`, peerId1, "dm", [peerId1, peerId2]);
  }
  getDMs(workspaceId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.filter((c) => c.type === "dm" && c.members.includes(peerId)) || [];
  }
  isPublicWorkspaceChannel(channel) {
    return channel.type === "channel" && channel.accessPolicy?.mode === "public-workspace";
  }
  isMemberAllowedInChannel(workspaceId, channelId, peerId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      return false;
    const member = workspace.members.find((m) => m.peerId === peerId);
    if (!member)
      return false;
    const channel = workspace.channels.find((c) => c.id === channelId);
    if (!channel)
      return false;
    if (channel.type === "dm") {
      return channel.members.includes(peerId);
    }
    switch (channel.accessPolicy?.mode) {
      case "public-workspace":
        return true;
      case "role-gated":
        return channel.accessPolicy.roles?.includes(member.role) ?? false;
      case "explicit":
        return channel.accessPolicy.explicitMemberPeerIds?.includes(peerId) ?? channel.members.includes(peerId);
      case "group":
        return channel.accessPolicy.explicitMemberPeerIds?.includes(peerId) ?? channel.members.includes(peerId);
      default:
        return channel.members.includes(peerId);
    }
  }
  validateInviteCode(inviteCode) {
    for (const workspace of this.workspaces.values()) {
      if (workspace.inviteCode === inviteCode)
        return workspace;
    }
    return;
  }
  importWorkspace(workspace) {
    if (!workspace.permissions) {
      workspace.permissions = { ...DEFAULT_WORKSPACE_PERMISSIONS };
    } else {
      workspace.permissions = {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        ...workspace.permissions,
        revokedInviteIds: Array.isArray(workspace.permissions.revokedInviteIds) ? [...new Set(workspace.permissions.revokedInviteIds)] : []
      };
    }
    for (const member of workspace.members) {
      if (member.role !== "owner" && member.role !== "admin" && member.role !== "member") {
        member.role = "member";
      }
      if (typeof member.allowWorkspaceDMs !== "boolean") {
        member.allowWorkspaceDMs = true;
      }
    }
    workspace.bans = Array.isArray(workspace.bans) ? workspace.bans.filter((ban) => !!ban && typeof ban.peerId === "string" && typeof ban.bannedBy === "string" && typeof ban.bannedAt === "number") : [];
    this.workspaces.set(workspace.id, workspace);
  }
  exportWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId);
  }
  generateId() {
    return crypto.randomUUID();
  }
  generateInviteCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0;i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
// ../decent-protocol/dist/workspace/WorkspaceDeltaProtocol.js
class WorkspaceDeltaProtocol {
  constructor(workspaceManager) {
    Object.defineProperty(this, "workspaceManager", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "buffered", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    this.workspaceManager = workspaceManager;
  }
  buildWorkspaceShell(workspaceId) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return;
    const version = workspace.shell?.version ?? workspace.version ?? 1;
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      version,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length,
      capabilityFlags: workspace.shell?.capabilityFlags
    };
  }
  applyWorkspaceShell(target, shell, inviteCode) {
    const existing = target.getWorkspace(shell.id);
    const workspace = existing ?? {
      id: shell.id,
      name: shell.name,
      description: shell.description,
      inviteCode: inviteCode || "PAGED000",
      createdBy: shell.createdBy,
      createdAt: shell.createdAt,
      version: shell.version,
      members: [],
      channels: [],
      shell,
      permissions: undefined,
      bans: []
    };
    workspace.name = shell.name;
    workspace.description = shell.description;
    workspace.version = shell.version;
    workspace.shell = shell;
    target.importWorkspace(structuredClone(workspace));
    return target.getWorkspace(shell.id);
  }
  applyDelta(target, delta) {
    const workspace = target.getWorkspace(delta.workspaceId);
    if (!workspace)
      return { applied: false, reason: "workspace not found" };
    const currentVersion = workspace.shell?.version ?? workspace.version ?? 0;
    if (delta.baseVersion < currentVersion) {
      return { applied: false, reason: `stale delta: base ${delta.baseVersion} < current ${currentVersion}` };
    }
    if (delta.baseVersion > currentVersion) {
      this.bufferDelta(delta);
      return { applied: false, buffered: true, reason: `missing base version ${delta.baseVersion}` };
    }
    for (const op of delta.ops) {
      switch (op.op) {
        case "upsert-channel": {
          if (!op.channel)
            break;
          const idx = workspace.channels.findIndex((c) => c.id === op.channel.id);
          if (idx >= 0)
            workspace.channels[idx] = op.channel;
          else
            workspace.channels.push(op.channel);
          break;
        }
        case "remove-channel": {
          if (!op.channelId)
            break;
          workspace.channels = workspace.channels.filter((c) => c.id !== op.channelId);
          break;
        }
        case "upsert-member": {
          if (!op.member)
            break;
          const idx = workspace.members.findIndex((m) => m.peerId === op.member.peerId);
          if (idx >= 0)
            workspace.members[idx] = op.member;
          else
            workspace.members.push(op.member);
          break;
        }
        case "remove-member": {
          const peerId = op.peerId || op.member?.peerId;
          if (!peerId)
            break;
          workspace.members = workspace.members.filter((m) => m.peerId !== peerId);
          break;
        }
        case "update-shell": {
          workspace.name = op.shellPatch?.name ?? workspace.name;
          workspace.description = op.shellPatch?.description ?? workspace.description;
          workspace.shell = {
            ...workspace.shell ?? this.buildWorkspaceShell(workspace.id) ?? this.fallbackShell(workspace),
            ...op.shellPatch,
            id: workspace.id,
            name: op.shellPatch?.name ?? workspace.name,
            description: op.shellPatch?.description ?? workspace.description,
            version: delta.version,
            memberCount: workspace.members.length,
            channelCount: workspace.channels.length
          };
          break;
        }
      }
    }
    workspace.version = delta.version;
    workspace.shell = {
      ...workspace.shell ?? this.buildWorkspaceShell(workspace.id) ?? this.fallbackShell(workspace),
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      version: delta.version,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length
    };
    target.importWorkspace(structuredClone(workspace));
    this.flushBuffered(target, delta.workspaceId);
    return { applied: true };
  }
  fallbackShell(workspace) {
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      version: workspace.version ?? 1,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length
    };
  }
  bufferDelta(delta) {
    const list = this.buffered.get(delta.workspaceId) ?? [];
    list.push(delta);
    list.sort((a, b) => a.baseVersion - b.baseVersion || a.version - b.version);
    this.buffered.set(delta.workspaceId, list);
  }
  flushBuffered(target, workspaceId) {
    const list = this.buffered.get(workspaceId);
    if (!list?.length)
      return;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const workspace = target.getWorkspace(workspaceId);
      const currentVersion = workspace?.shell?.version ?? workspace?.version ?? 0;
      const idx = list.findIndex((delta) => delta.baseVersion === currentVersion);
      if (idx >= 0) {
        const [next] = list.splice(idx, 1);
        this.applyDelta(target, next);
        progressed = true;
      }
    }
    if (list.length === 0)
      this.buffered.delete(workspaceId);
  }
}

// ../decent-protocol/dist/workspace/DirectoryShardPlanner.js
class DirectoryShardPlanner {
  constructor(shardPrefixLength = 2) {
    Object.defineProperty(this, "shardPrefixLength", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: shardPrefixLength
    });
  }
  getShardPrefixForMember(member) {
    const key = (member.identityId || member.peerId || "").trim();
    const hash = this.hashToHex(key);
    return hash.slice(0, this.shardPrefixLength);
  }
  planShardRefs(workspaceId, members, replicaPeerIds, version = 1) {
    const replicaIds = [...new Set(replicaPeerIds.filter(Boolean))].sort();
    const prefixes = [...new Set(members.map((m) => this.getShardPrefixForMember(m)))].sort();
    return prefixes.map((prefix) => ({
      workspaceId,
      shardId: `${workspaceId}:${prefix}`,
      shardPrefix: prefix,
      replicaPeerIds: replicaIds,
      version
    }));
  }
  hashToHex(input) {
    let hash = 2166136261;
    for (let i = 0;i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
}

// ../decent-protocol/dist/workspace/DirectoryProtocol.js
class DirectoryProtocol {
  constructor(workspaceManager, shardPlanner = new DirectoryShardPlanner) {
    Object.defineProperty(this, "workspaceManager", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: workspaceManager
    });
    Object.defineProperty(this, "shardPlanner", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: shardPlanner
    });
  }
  getMemberPage(workspaceId, opts = {}) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return { workspaceId, pageSize: this.clampPageSize(opts.pageSize), members: [] };
    }
    const pageSize = this.clampPageSize(opts.pageSize);
    const members = workspace.members.filter((member) => !opts.shardPrefix || this.shardPlanner.getShardPrefixForMember(member) === opts.shardPrefix).map((member) => this.toMemberSummary(member)).sort((a, b) => this.memberCursor(a).localeCompare(this.memberCursor(b)));
    const cursor = opts.cursor;
    const startIndex = cursor ? (() => {
      const idx = members.findIndex((member) => this.memberCursor(member) > cursor);
      return idx >= 0 ? idx : members.length;
    })() : 0;
    const pageMembers = members.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < members.length;
    const page = {
      workspaceId,
      pageSize,
      cursor: opts.cursor,
      nextCursor: hasMore && pageMembers.length > 0 ? this.memberCursor(pageMembers[pageMembers.length - 1]) : undefined,
      shardRef: opts.shardPrefix ? this.getShardRef(workspaceId, opts.shardPrefix, workspace.members) : undefined,
      members: pageMembers
    };
    return page;
  }
  getShardPrefixForMember(peerId, workspaceId) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const member = workspace?.members.find((m) => m.peerId === peerId);
    return member ? this.shardPlanner.getShardPrefixForMember(member) : undefined;
  }
  buildMemberPageResponse(workspaceId, opts = {}) {
    return {
      type: "member-page-response",
      page: this.getMemberPage(workspaceId, opts)
    };
  }
  buildShardAdvertisement(workspaceId, members, replicaPeerIds, version = 1) {
    const normalizedReplicaPeerIds = this.normalizeReplicaPeerIds(replicaPeerIds, members.length);
    return this.shardPlanner.planShardRefs(workspaceId, members, normalizedReplicaPeerIds, version).map((shard) => ({
      type: "directory-shard-advertisement",
      shard
    }));
  }
  buildShardRepairRequest(workspaceId, shardId, requestedBy, targetReplicaPeerIds = []) {
    return {
      type: "directory-shard-repair",
      workspaceId,
      shardId,
      requestedBy,
      targetReplicaPeerIds
    };
  }
  getShardRef(workspaceId, shardPrefix, members) {
    return this.shardPlanner.planShardRefs(workspaceId, members, [], 1).find((ref) => ref.shardPrefix === shardPrefix) || {
      workspaceId,
      shardId: `${workspaceId}:${shardPrefix}`,
      shardPrefix,
      replicaPeerIds: [],
      version: 1
    };
  }
  normalizeReplicaPeerIds(replicaPeerIds, memberCount) {
    const uniqueReplicaPeerIds = [...new Set(replicaPeerIds.filter(Boolean))].sort();
    if (memberCount < DirectoryProtocol.MEDIUM_WORKSPACE_MEMBER_THRESHOLD) {
      return uniqueReplicaPeerIds;
    }
    if (uniqueReplicaPeerIds.length <= DirectoryProtocol.IMPORTANT_SHARD_MIN_REPLICAS) {
      return uniqueReplicaPeerIds;
    }
    const targetReplicaCount = Math.min(DirectoryProtocol.IMPORTANT_SHARD_PREFERRED_REPLICAS, Math.max(DirectoryProtocol.IMPORTANT_SHARD_MIN_REPLICAS, uniqueReplicaPeerIds.length));
    return uniqueReplicaPeerIds.slice(0, targetReplicaCount);
  }
  clampPageSize(pageSize) {
    if (!pageSize || pageSize <= 0)
      return 100;
    return Math.min(pageSize, 200);
  }
  toMemberSummary(member) {
    return {
      peerId: member.peerId,
      alias: member.alias,
      role: member.role,
      joinedAt: member.joinedAt,
      identityId: member.identityId,
      isBot: member.isBot,
      allowWorkspaceDMs: member.allowWorkspaceDMs,
      companySim: member.companySim
    };
  }
  memberCursor(member) {
    return `${member.identityId || member.peerId}`;
  }
}
Object.defineProperty(DirectoryProtocol, "MEDIUM_WORKSPACE_MEMBER_THRESHOLD", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 100
});
Object.defineProperty(DirectoryProtocol, "IMPORTANT_SHARD_MIN_REPLICAS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 2
});
Object.defineProperty(DirectoryProtocol, "IMPORTANT_SHARD_PREFERRED_REPLICAS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 3
});

// ../decent-protocol/dist/history/HistoryPageProtocol.js
class HistoryPageProtocol {
  constructor(messageStore, workspaceManager, now = () => Date.now()) {
    Object.defineProperty(this, "messageStore", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: messageStore
    });
    Object.defineProperty(this, "workspaceManager", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: workspaceManager
    });
    Object.defineProperty(this, "now", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: now
    });
  }
  getHistoryPage(workspaceId, channelId, options = {}) {
    const pageSize = this.clampPageSize(options.pageSize);
    const direction = options.direction ?? "older";
    const tier = options.tier ?? "recent";
    const normalized = this.messageStore.getMessages(channelId).map((message) => this.toSyncedMessage(message)).sort((a, b) => this.compareCursor(this.messageCursor(a), this.messageCursor(b)));
    const cursor = options.cursor;
    const filtered = cursor ? normalized.filter((message) => direction === "older" ? this.messageCursor(message) < cursor : this.messageCursor(message) > cursor) : normalized;
    let pageMessages;
    let hasMore = false;
    if (direction === "older") {
      const startIndex = Math.max(0, filtered.length - pageSize);
      pageMessages = filtered.slice(startIndex);
      hasMore = startIndex > 0;
    } else {
      pageMessages = filtered.slice(0, pageSize);
      hasMore = filtered.length > pageSize;
    }
    const startCursor = pageMessages[0] ? this.messageCursor(pageMessages[0]) : undefined;
    const endCursor = pageMessages[pageMessages.length - 1] ? this.messageCursor(pageMessages[pageMessages.length - 1]) : undefined;
    const nextCursor = hasMore ? direction === "older" ? startCursor : endCursor : undefined;
    const replicaHint = this.buildReplicaHints(workspaceId).find((hint) => hint.channelId === channelId);
    const selection = this.selectReplicaPeers(replicaHint, tier);
    return {
      workspaceId,
      channelId,
      pageId: this.toPageId(direction, startCursor, endCursor),
      pageSize,
      direction,
      tier,
      cursor: options.cursor,
      nextCursor,
      startCursor,
      endCursor,
      hasMore,
      generatedAt: this.now(),
      replicaPeerIds: selection.selectedReplicaPeerIds,
      recentReplicaPeerIds: selection.recentReplicaPeerIds,
      archiveReplicaPeerIds: selection.archiveReplicaPeerIds,
      selectedReplicaPeerIds: selection.selectedReplicaPeerIds,
      selectionPolicy: selection.selectionPolicy,
      messages: pageMessages
    };
  }
  buildHistoryPageResponse(workspaceId, channelId, options = {}) {
    return {
      type: "history-page-response",
      workspaceId,
      channelId,
      page: this.getHistoryPage(workspaceId, channelId, options),
      historyReplicaHints: this.buildReplicaHints(workspaceId)
    };
  }
  buildReplicaHints(workspaceId) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return [];
    const capabilityEntries = Object.entries(workspace.peerCapabilities ?? {});
    const archiveCapabilityEntries = capabilityEntries.filter(([, capabilities]) => capabilities?.archive).map(([peerId, capabilities]) => ({
      peerId,
      retentionDays: capabilities?.archive?.retentionDays
    }));
    const archivePeers = this.sortedUniquePeers(archiveCapabilityEntries.map((entry) => entry.peerId));
    const deepArchivePeers = this.sortedUniquePeers(archiveCapabilityEntries.filter((entry) => (entry.retentionDays ?? Number.POSITIVE_INFINITY) >= 30).map((entry) => entry.peerId));
    const shortArchivePeers = this.sortedUniquePeers(archiveCapabilityEntries.filter((entry) => (entry.retentionDays ?? Number.POSITIVE_INFINITY) < 30).map((entry) => entry.peerId));
    return workspace.channels.filter((channel) => channel.type === "channel").map((channel) => {
      const recentRelayPeers = this.sortedUniquePeers(capabilityEntries.filter(([, capabilities]) => this.isRelayForChannel(capabilities, channel.id)).map(([peerId]) => peerId));
      const reservedPeers = new Set([
        this.workspaceCreator(workspace),
        ...recentRelayPeers,
        ...archivePeers
      ]);
      const fallbackMembers = workspace.members.map((member) => member.peerId).filter((peerId) => !reservedPeers.has(peerId)).sort().slice(0, 3);
      const recentReplicaPeerIds = this.sortedUniquePeers([
        this.workspaceCreator(workspace),
        ...recentRelayPeers,
        ...shortArchivePeers,
        ...deepArchivePeers,
        ...fallbackMembers
      ]);
      const archivePrimaryPeers = deepArchivePeers.length > 0 ? deepArchivePeers : archivePeers;
      const archiveReplicaPeerIds = this.sortedUniquePeers([
        ...archivePrimaryPeers,
        ...recentRelayPeers.filter((peerId) => archivePeers.includes(peerId))
      ]);
      return {
        workspaceId,
        channelId: channel.id,
        recentReplicaPeerIds,
        archiveReplicaPeerIds,
        updatedAt: this.now()
      };
    });
  }
  buildReplicaHintsMessage(workspaceId) {
    return {
      type: "history-replica-hints",
      workspaceId,
      hints: this.buildReplicaHints(workspaceId)
    };
  }
  selectReplicaPeers(hint, tier) {
    const recentReplicaPeerIds = this.sortedUniquePeers(hint?.recentReplicaPeerIds ?? []);
    const archiveReplicaPeerIds = this.sortedUniquePeers(hint?.archiveReplicaPeerIds ?? []);
    if (tier === "archive") {
      if (archiveReplicaPeerIds.length > 0) {
        return {
          recentReplicaPeerIds,
          archiveReplicaPeerIds,
          selectedReplicaPeerIds: archiveReplicaPeerIds,
          selectionPolicy: "archive-primary"
        };
      }
      if (recentReplicaPeerIds.length > 0) {
        return {
          recentReplicaPeerIds,
          archiveReplicaPeerIds,
          selectedReplicaPeerIds: recentReplicaPeerIds,
          selectionPolicy: "fallback-to-recent"
        };
      }
    } else {
      if (recentReplicaPeerIds.length > 0) {
        return {
          recentReplicaPeerIds,
          archiveReplicaPeerIds,
          selectedReplicaPeerIds: recentReplicaPeerIds,
          selectionPolicy: "recent-primary"
        };
      }
      if (archiveReplicaPeerIds.length > 0) {
        return {
          recentReplicaPeerIds,
          archiveReplicaPeerIds,
          selectedReplicaPeerIds: archiveReplicaPeerIds,
          selectionPolicy: "fallback-to-archive"
        };
      }
    }
    return {
      recentReplicaPeerIds,
      archiveReplicaPeerIds,
      selectedReplicaPeerIds: undefined,
      selectionPolicy: "no-replicas"
    };
  }
  clampPageSize(pageSize) {
    if (!pageSize || pageSize <= 0)
      return HistoryPageProtocol.DEFAULT_PAGE_SIZE;
    return Math.min(pageSize, HistoryPageProtocol.MAX_PAGE_SIZE);
  }
  toSyncedMessage(message) {
    const { content, metadata, ...rest } = message;
    return {
      ...rest,
      metadata: metadata ? { ...metadata } : undefined
    };
  }
  messageCursor(message) {
    return `${String(message.timestamp).padStart(16, "0")}:${message.id}`;
  }
  compareCursor(a, b) {
    if (a === b)
      return 0;
    return a < b ? -1 : 1;
  }
  toPageId(direction, startCursor, endCursor) {
    const start = encodeURIComponent(startCursor ?? "start");
    const end = encodeURIComponent(endCursor ?? "end");
    return `${direction}:${start}:${end}`;
  }
  sortedUniquePeers(peerIds) {
    return [...new Set(peerIds.filter((peerId) => Boolean(peerId)))].sort();
  }
  workspaceCreator(workspace) {
    return workspace.createdBy;
  }
  isRelayForChannel(capabilities, channelId) {
    if (!capabilities?.relay)
      return false;
    const channels = capabilities.relay.channels;
    return !channels?.length || channels.includes(channelId);
  }
}
Object.defineProperty(HistoryPageProtocol, "DEFAULT_PAGE_SIZE", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 50
});
Object.defineProperty(HistoryPageProtocol, "MAX_PAGE_SIZE", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 200
});

// ../decent-protocol/dist/workspace/SyncProtocol.js
class SyncProtocol {
  constructor(workspaceManager, messageStore, sendFn, onEvent, myPeerId, serverDiscovery) {
    Object.defineProperty(this, "workspaceManager", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "messageStore", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "sendFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "onEvent", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "myPeerId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "serverDiscovery", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "workspaceDelta", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "directoryProtocol", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "historyPageProtocol", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "historyBootstrapPendingUntil", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    this.workspaceManager = workspaceManager;
    this.messageStore = messageStore;
    this.sendFn = sendFn;
    this.onEvent = onEvent;
    this.myPeerId = myPeerId;
    this.serverDiscovery = serverDiscovery;
    this.workspaceDelta = new WorkspaceDeltaProtocol(this.workspaceManager);
    this.directoryProtocol = new DirectoryProtocol(this.workspaceManager);
    this.historyPageProtocol = new HistoryPageProtocol(this.messageStore, this.workspaceManager);
  }
  async handleMessage(fromPeerId, msg) {
    switch (msg.type) {
      case "join-request":
        this.handleJoinRequest(fromPeerId, msg);
        break;
      case "join-accepted":
        await this.handleJoinAccepted(fromPeerId, msg);
        break;
      case "join-rejected":
        this.onEvent({ type: "join-rejected", reason: msg.reason });
        break;
      case "member-joined":
        this.handleMemberJoined(msg);
        break;
      case "member-left":
        this.handleMemberLeft(msg);
        break;
      case "channel-created":
        this.handleChannelCreated(msg);
        break;
      case "channel-removed":
        this.handleChannelRemoved(msg);
        break;
      case "workspace-deleted":
        this.handleWorkspaceDeleted(msg);
        break;
      case "channel-message":
        await this.handleChannelMessage(fromPeerId, msg);
        break;
      case "sync-request":
        this.handleSyncRequest(fromPeerId, msg);
        break;
      case "sync-response":
        await this.handleSyncResponse(fromPeerId, msg);
        break;
      case "workspace-shell-request":
        this.handleWorkspaceShellRequest(fromPeerId, msg);
        break;
      case "workspace-shell-response":
        this.handleWorkspaceShellResponse(msg);
        break;
      case "workspace-delta":
        this.handleWorkspaceDelta(fromPeerId, msg);
        break;
      case "workspace-delta-ack":
        break;
      case "member-page-request":
        this.handleMemberPageRequest(fromPeerId, msg);
        break;
      case "member-page-response":
        this.handleMemberPageResponse(msg);
        break;
      case "history-page-request":
        this.handleHistoryPageRequest(fromPeerId, msg);
        break;
      case "history-page-response":
        this.handleHistoryPageResponse(msg);
        break;
      case "history-replica-hints":
        this.handleHistoryReplicaHints(msg);
        break;
      case "directory-shard-advertisement":
        this.handleDirectoryShardAdvertisement(msg);
        break;
      case "directory-shard-repair":
        this.handleDirectoryShardRepair(fromPeerId, msg);
        break;
      case "peer-exchange":
        this.handlePeerExchange(msg);
        break;
    }
  }
  requestJoin(targetPeerId, inviteCode, myMember, inviteId, options = {}) {
    const msg = {
      type: "join-request",
      inviteCode,
      member: myMember,
      inviteId,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
      historySyncMode: options.historySyncMode,
      historyCapabilities: options.historyCapabilities ?? this.defaultHistoryCapabilities()
    };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  broadcastMemberJoined(workspaceId, member, connectedPeerIds) {
    const msg = { type: "member-joined", member };
    for (const peerId of connectedPeerIds) {
      if (peerId !== member.peerId && peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastChannelCreated(workspaceId, channel, connectedPeerIds) {
    const msg = { type: "channel-created", channel };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastWorkspaceDeleted(workspaceId, deletedBy, connectedPeerIds) {
    const msg = { type: "workspace-deleted", workspaceId, deletedBy };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastMessage(workspaceId, channelId, message, connectedPeerIds) {
    const msg = {
      type: "channel-message",
      workspaceId,
      channelId,
      message
    };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  requestSync(targetPeerId, workspaceId, options = {}) {
    const msg = {
      type: "sync-request",
      workspaceId,
      historySyncMode: options.historySyncMode,
      historyCapabilities: options.historyCapabilities ?? this.defaultHistoryCapabilities()
    };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  requestWorkspaceShell(targetPeerId, workspaceId) {
    const msg = { type: "workspace-shell-request", workspaceId };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  requestMemberPage(targetPeerId, workspaceId, options = {}) {
    const msg = {
      type: "member-page-request",
      workspaceId,
      cursor: options.cursor,
      pageSize: options.pageSize,
      shardPrefix: options.shardPrefix
    };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  requestHistoryPage(targetPeerId, workspaceId, channelId, options = {}) {
    const msg = {
      type: "history-page-request",
      workspaceId,
      channelId,
      cursor: options.cursor,
      pageSize: options.pageSize,
      direction: options.direction,
      tier: options.tier
    };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  selectHistoryPageSource(workspaceId, channelId, tier = "recent", availablePeerIds = []) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return;
    const channel = workspace.channels.find((candidate) => candidate.id === channelId);
    if (!channel)
      return;
    const availableSet = availablePeerIds.length > 0 ? new Set(availablePeerIds) : undefined;
    const refs = [...channel.historyPages ?? []];
    const latestMatchingRef = refs.reverse().find((ref) => ref.tier === tier || ref.tier === undefined);
    const fallbackHint = channel.historyReplicaHint;
    const recentCandidates = this.uniqueOrderedPeers([
      ...latestMatchingRef?.recentReplicaPeerIds ?? [],
      ...latestMatchingRef?.selectionPolicy === "fallback-to-recent" ? latestMatchingRef.selectedReplicaPeerIds ?? [] : [],
      ...fallbackHint?.recentReplicaPeerIds ?? []
    ]);
    const archiveCandidates = this.uniqueOrderedPeers([
      ...latestMatchingRef?.archiveReplicaPeerIds ?? [],
      ...latestMatchingRef?.selectionPolicy === "fallback-to-archive" ? latestMatchingRef.selectedReplicaPeerIds ?? [] : [],
      ...fallbackHint?.archiveReplicaPeerIds ?? []
    ]);
    const selectionOrder = tier === "archive" ? this.uniqueOrderedPeers([
      ...latestMatchingRef?.selectedReplicaPeerIds ?? [],
      ...archiveCandidates,
      ...recentCandidates
    ]) : this.uniqueOrderedPeers([
      ...latestMatchingRef?.selectedReplicaPeerIds ?? [],
      ...recentCandidates,
      ...archiveCandidates
    ]);
    return selectionOrder.find((peerId) => {
      if (peerId === this.myPeerId)
        return false;
      if (!availableSet)
        return true;
      return availableSet.has(peerId);
    });
  }
  handleJoinRequest(fromPeerId, msg) {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }
    const workspace = this.workspaceManager.validateInviteCode(msg.inviteCode);
    if (!workspace) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: "Invalid invite code" }
      });
      return;
    }
    if (msg.inviteId && this.workspaceManager.isInviteRevoked(workspace.id, msg.inviteId)) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: "This invite link has been revoked by an admin" }
      });
      return;
    }
    const result = this.workspaceManager.addMember(workspace.id, msg.member);
    if (!result.success) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: result.error || "Failed to join" }
      });
      return;
    }
    const historySyncMode = this.resolveHistorySyncMode(msg, workspace);
    const shouldUsePagedHistory = historySyncMode === "paged";
    const messageHistory = shouldUsePagedHistory ? {} : this.buildLegacyMessageHistory(workspace.id);
    const historyReplicaHints = shouldUsePagedHistory ? this.historyPageProtocol.buildReplicaHints(workspace.id) : undefined;
    const acceptMsg = {
      type: "join-accepted",
      workspace: this.workspaceManager.exportWorkspace(workspace.id),
      messageHistory,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
      historyReplicaHints,
      historyCapabilities: shouldUsePagedHistory ? this.defaultHistoryCapabilities() : undefined
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: acceptMsg });
    this.onEvent({ type: "member-joined", workspaceId: workspace.id, member: msg.member });
  }
  async handleJoinAccepted(fromPeerId, msg) {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }
    const inviterMembership = msg.workspace.members.find((member) => member.peerId === fromPeerId);
    if (!inviterMembership) {
      console.warn(`Ignoring join-accepted from ${fromPeerId}: sender not present in workspace membership`);
      return;
    }
    this.workspaceManager.importWorkspace(msg.workspace);
    for (const [channelId, messages] of Object.entries(msg.messageHistory || {})) {
      await this.messageStore.importMessages(channelId, messages);
    }
    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspace.id, msg.historyReplicaHints);
    }
    this.onEvent({
      type: "workspace-joined",
      workspace: msg.workspace,
      messageHistory: msg.messageHistory || {},
      historyReplicaHints: msg.historyReplicaHints
    });
    if (msg.historyReplicaHints?.length) {
      this.onEvent({
        type: "history-replica-hints",
        workspaceId: msg.workspace.id,
        hints: msg.historyReplicaHints
      });
    }
    this.maybeBootstrapRecentHistory(fromPeerId, msg.workspace.id, msg.messageHistory || {}, msg.historyCapabilities);
  }
  handleWorkspaceShellRequest(fromPeerId, msg) {
    const shell = this.workspaceDelta.buildWorkspaceShell(msg.workspaceId);
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!shell || !workspace)
      return;
    const response = {
      type: "workspace-shell-response",
      shell,
      inviteCode: workspace.inviteCode
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: response });
  }
  handleWorkspaceShellResponse(msg) {
    this.workspaceDelta.applyWorkspaceShell(this.workspaceManager, msg.shell, msg.inviteCode);
    this.onEvent({ type: "sync-complete", workspaceId: msg.shell.id });
  }
  handleWorkspaceDelta(fromPeerId, msg) {
    const result = this.workspaceDelta.applyDelta(this.workspaceManager, msg.delta);
    if (result.applied) {
      const ack = {
        type: "workspace-delta-ack",
        workspaceId: msg.delta.workspaceId,
        version: msg.delta.version,
        checkpointId: msg.delta.checkpointId
      };
      this.sendFn(fromPeerId, { type: "workspace-sync", sync: ack, workspaceId: msg.delta.workspaceId });
      this.onEvent({ type: "sync-complete", workspaceId: msg.delta.workspaceId });
    }
  }
  handleMemberPageRequest(fromPeerId, msg) {
    const response = this.directoryProtocol.buildMemberPageResponse(msg.workspaceId, {
      cursor: msg.cursor,
      pageSize: msg.pageSize,
      shardPrefix: msg.shardPrefix
    });
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: response, workspaceId: msg.workspaceId });
  }
  handleMemberPageResponse(msg) {
    this.onEvent({
      type: "member-page-received",
      workspaceId: msg.page.workspaceId,
      page: msg.page
    });
  }
  handleHistoryPageRequest(fromPeerId, msg) {
    const response = this.historyPageProtocol.buildHistoryPageResponse(msg.workspaceId, msg.channelId, {
      cursor: msg.cursor,
      pageSize: msg.pageSize,
      direction: msg.direction,
      tier: msg.tier
    });
    this.sendFn(fromPeerId, {
      type: "workspace-sync",
      sync: response,
      workspaceId: msg.workspaceId
    });
  }
  handleHistoryPageResponse(msg) {
    const normalized = msg.page.messages.map((message) => ({
      ...message,
      content: typeof message.content === "string" ? message.content : ""
    }));
    this.messageStore.bulkAdd(normalized);
    this.upsertHistoryPageRef(msg.workspaceId, msg.channelId, msg.page);
    this.clearPendingHistoryBootstrap(msg.workspaceId, msg.channelId);
    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspaceId, msg.historyReplicaHints);
    }
    this.onEvent({
      type: "history-page-received",
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      page: msg.page
    });
    if (msg.historyReplicaHints?.length) {
      this.onEvent({
        type: "history-replica-hints",
        workspaceId: msg.workspaceId,
        hints: msg.historyReplicaHints
      });
    }
  }
  handleHistoryReplicaHints(msg) {
    this.applyHistoryReplicaHints(msg.workspaceId, msg.hints);
    this.onEvent({
      type: "history-replica-hints",
      workspaceId: msg.workspaceId,
      hints: msg.hints
    });
  }
  handleDirectoryShardAdvertisement(msg) {
    const workspace = this.workspaceManager.getWorkspace(msg.shard.workspaceId);
    if (!workspace)
      return;
    const shards = [...workspace.directoryShards ?? []];
    const existingIndex = shards.findIndex((shard) => shard.shardId === msg.shard.shardId);
    if (existingIndex >= 0) {
      const existing = shards[existingIndex];
      const nextVersion = msg.shard.version ?? 0;
      const currentVersion = existing.version ?? 0;
      if (nextVersion < currentVersion)
        return;
      shards[existingIndex] = {
        ...existing,
        ...msg.shard,
        replicaPeerIds: [...new Set([...existing.replicaPeerIds ?? [], ...msg.shard.replicaPeerIds ?? []])].sort()
      };
    } else {
      shards.push({
        ...msg.shard,
        replicaPeerIds: [...new Set(msg.shard.replicaPeerIds ?? [])].sort()
      });
    }
    workspace.directoryShards = shards.sort((a, b) => a.shardId.localeCompare(b.shardId));
    this.onEvent({
      type: "directory-shards-updated",
      workspaceId: workspace.id,
      shards: workspace.directoryShards
    });
  }
  handleDirectoryShardRepair(fromPeerId, msg) {
    const shouldReply = !msg.targetReplicaPeerIds?.length || msg.targetReplicaPeerIds.includes(this.myPeerId);
    if (!shouldReply)
      return;
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!workspace)
      return;
    const shard = workspace.directoryShards?.find((entry) => entry.shardId === msg.shardId);
    if (!shard)
      return;
    this.sendFn(fromPeerId, {
      type: "workspace-sync",
      sync: { type: "directory-shard-advertisement", shard },
      workspaceId: msg.workspaceId
    });
  }
  handleMemberJoined(msg) {
    if (!msg.workspaceId) {
      console.warn("handleMemberJoined: missing workspaceId, ignoring message");
      return;
    }
    const result = this.workspaceManager.addMember(msg.workspaceId, msg.member);
    if (result.success) {
      this.onEvent({ type: "member-joined", workspaceId: msg.workspaceId, member: msg.member });
    }
  }
  handleMemberLeft(msg) {
    if (!msg.workspaceId) {
      console.warn("handleMemberLeft: missing workspaceId, ignoring message");
      return;
    }
    this.onEvent({ type: "member-left", workspaceId: msg.workspaceId, peerId: msg.peerId });
  }
  handleChannelCreated(msg) {
    const targetWsId = msg.workspaceId || msg.channel.workspaceId;
    if (!targetWsId) {
      console.warn("handleChannelCreated: missing workspaceId, ignoring message");
      return;
    }
    const ws = this.workspaceManager.getWorkspace(targetWsId);
    if (!ws)
      return;
    const existing = ws.channels.find((c) => c.id === msg.channel.id);
    if (!existing) {
      ws.channels.push(msg.channel);
      this.onEvent({ type: "channel-created", workspaceId: ws.id, channel: msg.channel });
    }
  }
  handleChannelRemoved(msg) {
    if (!msg.workspaceId) {
      console.warn("handleChannelRemoved: missing workspaceId, ignoring message");
      return;
    }
    const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!ws)
      return;
    const idx = ws.channels.findIndex((c) => c.id === msg.channelId && c.type === "channel");
    if (idx >= 0) {
      ws.channels.splice(idx, 1);
      this.onEvent({ type: "channel-removed", workspaceId: ws.id, channelId: msg.channelId });
    }
  }
  handleWorkspaceDeleted(msg) {
    const wsId = msg.workspaceId;
    if (!wsId) {
      console.warn("handleWorkspaceDeleted: missing workspaceId, ignoring message");
      return;
    }
    this.workspaceManager.removeWorkspace(wsId);
    this.onEvent({ type: "workspace-deleted", workspaceId: wsId, deletedBy: msg.deletedBy });
  }
  async handleChannelMessage(fromPeerId, msg) {
    const message = msg.message;
    const workspace = this.resolveChannelMessageWorkspace(msg.workspaceId, msg.channelId);
    if (!workspace) {
      console.warn(`Rejected channel message from ${fromPeerId}: unknown workspace/channel mapping (${msg.workspaceId ?? "none"} / ${msg.channelId})`);
      return;
    }
    const senderIsMember = workspace.members.some((member) => member.peerId === fromPeerId);
    if (!senderIsMember) {
      console.warn(`Rejected channel message from ${fromPeerId}: not a member of workspace ${workspace.id}`);
      return;
    }
    const channel = workspace.channels.find((candidate) => candidate.id === msg.channelId);
    if (!channel) {
      console.warn(`Rejected channel message from ${fromPeerId}: channel ${msg.channelId} missing in workspace ${workspace.id}`);
      return;
    }
    if (!this.workspaceManager.isMemberAllowedInChannel(workspace.id, channel.id, fromPeerId)) {
      console.warn(`Rejected channel message from ${fromPeerId}: not allowed in channel ${msg.channelId}`);
      return;
    }
    const normalizedMessage = {
      ...message,
      channelId: msg.channelId
    };
    const result = await this.messageStore.addMessage(normalizedMessage);
    if (result.success) {
      this.onEvent({ type: "message-received", channelId: msg.channelId, message: normalizedMessage });
    } else {
      console.warn("Rejected message from", fromPeerId, ":", result.error);
    }
  }
  resolveChannelMessageWorkspace(workspaceId, channelId) {
    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace)
        return;
      return workspace.channels.some((channel) => channel.id === channelId) ? workspace : undefined;
    }
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (workspace.channels.some((channel) => channel.id === channelId)) {
        return workspace;
      }
    }
    return;
  }
  handleSyncRequest(fromPeerId, msg) {
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!workspace)
      return;
    const requesterIsMember = workspace.members.some((member) => member.peerId === fromPeerId);
    if (!requesterIsMember) {
      console.warn(`Ignoring sync-request for workspace ${msg.workspaceId} from non-member ${fromPeerId}`);
      return;
    }
    const historySyncMode = this.resolveHistorySyncMode(msg, workspace);
    const usePagedHistory = historySyncMode === "paged";
    const messageHistory = usePagedHistory ? {} : this.buildLegacyMessageHistory(msg.workspaceId);
    const response = {
      type: "sync-response",
      workspace,
      messageHistory,
      historyReplicaHints: usePagedHistory ? this.historyPageProtocol.buildReplicaHints(msg.workspaceId) : undefined,
      historyCapabilities: usePagedHistory ? this.defaultHistoryCapabilities() : undefined
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: response });
  }
  async handleSyncResponse(fromPeerId, msg) {
    this.workspaceManager.importWorkspace(msg.workspace);
    for (const [channelId, messages] of Object.entries(msg.messageHistory || {})) {
      await this.messageStore.importMessages(channelId, messages);
    }
    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspace.id, msg.historyReplicaHints);
      this.onEvent({
        type: "history-replica-hints",
        workspaceId: msg.workspace.id,
        hints: msg.historyReplicaHints
      });
    }
    this.maybeBootstrapRecentHistory(fromPeerId, msg.workspace.id, msg.messageHistory || {}, msg.historyCapabilities);
    this.onEvent({ type: "sync-complete", workspaceId: msg.workspace.id });
  }
  maybeBootstrapRecentHistory(fromPeerId, workspaceId, messageHistory, historyCapabilities) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return;
    if (!this.shouldAutoBootstrapRecentHistory(workspace, messageHistory, historyCapabilities))
      return;
    const channels = workspace.channels.filter((channel) => channel.type === "channel").filter((channel) => this.messageStore.getMessages(channel.id).length === 0).slice(0, SyncProtocol.HISTORY_BOOTSTRAP_CHANNEL_LIMIT);
    for (const channel of channels) {
      if (!this.markPendingHistoryBootstrap(workspace.id, channel.id))
        continue;
      const selectedPeer = this.selectHistoryPageSource(workspace.id, channel.id, "recent");
      const targetPeerId = selectedPeer && selectedPeer !== this.myPeerId ? selectedPeer : fromPeerId !== this.myPeerId ? fromPeerId : undefined;
      if (!targetPeerId) {
        this.clearPendingHistoryBootstrap(workspace.id, channel.id);
        continue;
      }
      this.requestHistoryPage(targetPeerId, workspace.id, channel.id, {
        direction: "older",
        tier: "recent",
        pageSize: SyncProtocol.HISTORY_BOOTSTRAP_PAGE_SIZE
      });
    }
  }
  shouldAutoBootstrapRecentHistory(workspace, messageHistory, historyCapabilities) {
    if (Object.keys(messageHistory).length > 0)
      return false;
    if (historyCapabilities?.supportsPaged === false)
      return false;
    if (historyCapabilities?.supportedTiers && !historyCapabilities.supportedTiers.includes("recent"))
      return false;
    const hasReplicaHints = workspace.channels.some((channel) => (channel.historyReplicaHint?.recentReplicaPeerIds?.length ?? 0) > 0);
    if (!this.workspaceSupportsPagedHistory(workspace) && historyCapabilities?.supportsPaged !== true && !hasReplicaHints) {
      return false;
    }
    return true;
  }
  markPendingHistoryBootstrap(workspaceId, channelId) {
    const key = `${workspaceId}:${channelId}`;
    const now = Date.now();
    const pendingUntil = this.historyBootstrapPendingUntil.get(key) ?? 0;
    if (pendingUntil > now)
      return false;
    this.historyBootstrapPendingUntil.set(key, now + SyncProtocol.HISTORY_BOOTSTRAP_TTL_MS);
    return true;
  }
  clearPendingHistoryBootstrap(workspaceId, channelId) {
    this.historyBootstrapPendingUntil.delete(`${workspaceId}:${channelId}`);
  }
  resolveHistorySyncMode(msg, workspace) {
    if (msg.historySyncMode === "legacy")
      return "legacy";
    if (msg.historySyncMode === "paged")
      return "paged";
    const supportsPagedHistory = msg.historyCapabilities?.supportsPaged === true;
    if (supportsPagedHistory && this.workspaceSupportsPagedHistory(workspace)) {
      return "paged";
    }
    return "legacy";
  }
  workspaceSupportsPagedHistory(workspace) {
    return workspace.shell?.capabilityFlags?.includes(SyncProtocol.HISTORY_PAGING_CAPABILITY) === true;
  }
  defaultHistoryCapabilities() {
    return {
      supportsPaged: true,
      supportedTiers: ["recent", "archive"]
    };
  }
  applyHistoryReplicaHints(workspaceId, hints) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace || hints.length === 0)
      return;
    let changed = false;
    for (const hint of hints) {
      const channel = workspace.channels.find((entry) => entry.id === hint.channelId);
      if (!channel)
        continue;
      const prev = channel.historyReplicaHint;
      const mergedHint = {
        workspaceId: hint.workspaceId,
        channelId: hint.channelId,
        recentReplicaPeerIds: this.uniqueOrderedPeers([
          ...hint.recentReplicaPeerIds ?? [],
          ...prev?.recentReplicaPeerIds ?? []
        ]),
        archiveReplicaPeerIds: this.uniqueOrderedPeers([
          ...hint.archiveReplicaPeerIds ?? [],
          ...prev?.archiveReplicaPeerIds ?? []
        ]),
        updatedAt: Math.max(prev?.updatedAt ?? 0, hint.updatedAt ?? 0)
      };
      channel.historyReplicaHint = mergedHint;
      changed = true;
    }
    if (changed) {
      this.workspaceManager.importWorkspace(structuredClone(workspace));
    }
  }
  upsertHistoryPageRef(workspaceId, channelId, page) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return;
    const channel = workspace.channels.find((entry) => entry.id === channelId);
    if (!channel)
      return;
    const refs = [...channel.historyPages ?? []];
    const nextRef = {
      workspaceId,
      channelId,
      pageId: page.pageId,
      tier: page.tier,
      startCursor: page.startCursor,
      endCursor: page.endCursor,
      replicaPeerIds: this.uniqueOrderedPeers(page.replicaPeerIds ?? page.selectedReplicaPeerIds ?? []),
      recentReplicaPeerIds: this.uniqueOrderedPeers(page.recentReplicaPeerIds ?? []),
      archiveReplicaPeerIds: this.uniqueOrderedPeers(page.archiveReplicaPeerIds ?? []),
      selectedReplicaPeerIds: this.uniqueOrderedPeers(page.selectedReplicaPeerIds ?? page.replicaPeerIds ?? []),
      selectionPolicy: page.selectionPolicy
    };
    const existingIndex = refs.findIndex((ref) => ref.pageId === page.pageId);
    if (existingIndex >= 0) {
      refs[existingIndex] = this.mergeHistoryPageRefs(refs[existingIndex], nextRef);
    } else {
      refs.push(nextRef);
    }
    channel.historyPages = refs;
    this.workspaceManager.importWorkspace(structuredClone(workspace));
  }
  mergeHistoryPageRefs(current, incoming) {
    return {
      ...current,
      ...incoming,
      replicaPeerIds: this.uniqueOrderedPeers([...incoming.replicaPeerIds ?? [], ...current.replicaPeerIds ?? []]),
      recentReplicaPeerIds: this.uniqueOrderedPeers([
        ...incoming.recentReplicaPeerIds ?? [],
        ...current.recentReplicaPeerIds ?? []
      ]),
      archiveReplicaPeerIds: this.uniqueOrderedPeers([
        ...incoming.archiveReplicaPeerIds ?? [],
        ...current.archiveReplicaPeerIds ?? []
      ]),
      selectedReplicaPeerIds: this.uniqueOrderedPeers([
        ...incoming.selectedReplicaPeerIds ?? incoming.replicaPeerIds ?? [],
        ...current.selectedReplicaPeerIds ?? current.replicaPeerIds ?? []
      ]),
      selectionPolicy: incoming.selectionPolicy ?? current.selectionPolicy,
      tier: incoming.tier ?? current.tier,
      startCursor: incoming.startCursor ?? current.startCursor,
      endCursor: incoming.endCursor ?? current.endCursor
    };
  }
  uniqueOrderedPeers(peerIds) {
    return [...new Set(peerIds.filter((peerId) => Boolean(peerId)))];
  }
  buildLegacyMessageHistory(workspaceId) {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return {};
    const messageHistory = {};
    for (const channel of workspace.channels) {
      const messages = this.messageStore.getMessages(channel.id);
      if (messages.length > 0) {
        messageHistory[channel.id] = messages.map((message) => {
          const { content, ...safeMessage } = message;
          return safeMessage;
        });
      }
    }
    return messageHistory;
  }
  handlePeerExchange(msg) {
    if (this.serverDiscovery && msg.servers) {
      this.serverDiscovery.mergeReceivedServers(msg.servers);
    }
  }
  broadcastPeerExchange(connectedPeerIds) {
    if (!this.serverDiscovery)
      return;
    const msg = {
      type: "peer-exchange",
      servers: this.serverDiscovery.getHandshakeServers()
    };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg });
      }
    }
  }
  getServerDiscovery() {
    return this.serverDiscovery;
  }
}
Object.defineProperty(SyncProtocol, "HISTORY_PAGING_CAPABILITY", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: "history-pages-v1"
});
Object.defineProperty(SyncProtocol, "HISTORY_BOOTSTRAP_PAGE_SIZE", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 25
});
Object.defineProperty(SyncProtocol, "HISTORY_BOOTSTRAP_CHANNEL_LIMIT", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 6
});
Object.defineProperty(SyncProtocol, "HISTORY_BOOTSTRAP_TTL_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 15000
});
// ../decent-protocol/dist/workspace/PresenceProtocol.js
class PresenceProtocol {
  buildSubscribeMessage(workspaceId, channelId, options = {}) {
    return {
      type: "presence-subscribe",
      workspaceId,
      channelId,
      pageCursor: options.pageCursor,
      pageSize: this.clampPageSize(options.pageSize)
    };
  }
  buildUnsubscribeMessage(workspaceId, channelId) {
    return {
      type: "presence-unsubscribe",
      workspaceId,
      channelId
    };
  }
  buildAggregateMessage(workspaceId, aggregate) {
    return {
      type: "presence-aggregate",
      workspaceId,
      aggregate: {
        workspaceId,
        onlineCount: Math.max(0, Math.floor(aggregate.onlineCount || 0)),
        awayCount: aggregate.awayCount != null ? Math.max(0, Math.floor(aggregate.awayCount)) : undefined,
        activeChannelId: aggregate.activeChannelId,
        updatedAt: aggregate.updatedAt ?? Date.now()
      }
    };
  }
  buildPageResponseMessage(workspaceId, channelId, peers, options = {}) {
    const pageSize = this.clampPageSize(options.pageSize);
    const sorted = [...peers].sort((a, b) => a.peerId.localeCompare(b.peerId));
    const cursor = options.cursor;
    const startIndex = cursor ? (() => {
      const idx = sorted.findIndex((peer) => peer.peerId > cursor);
      return idx >= 0 ? idx : sorted.length;
    })() : 0;
    const page = sorted.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < sorted.length;
    return {
      type: "presence-page-response",
      workspaceId,
      channelId,
      pageSize,
      cursor,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].peerId : undefined,
      peers: page,
      updatedAt: options.updatedAt ?? Date.now()
    };
  }
  clampPageSize(pageSize) {
    if (!pageSize || pageSize <= 0)
      return PresenceProtocol.DEFAULT_PAGE_SIZE;
    return Math.min(pageSize, PresenceProtocol.MAX_PAGE_SIZE);
  }
}
Object.defineProperty(PresenceProtocol, "DEFAULT_PAGE_SIZE", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 50
});
Object.defineProperty(PresenceProtocol, "MAX_PAGE_SIZE", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 200
});
// ../decent-protocol/dist/messages/MessageStore.js
class MessageStore {
  constructor() {
    Object.defineProperty(this, "hashChain", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "channels", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "channelIdSets", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "threadRoots", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    this.hashChain = new HashChain;
  }
  ensureChannel(channelId) {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, []);
      this.channelIdSets.set(channelId, new Set);
    }
    return {
      msgs: this.channels.get(channelId),
      ids: this.channelIdSets.get(channelId)
    };
  }
  upperBoundTimestamp(msgs, target) {
    let lo = 0;
    let hi = msgs.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (msgs[mid].timestamp <= target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
  async createMessage(channelId, senderId, content, type = "text", threadId) {
    validateMessageContentLength(content);
    const channelMessages = this.channels.get(channelId) || [];
    const lastMessage = channelMessages[channelMessages.length - 1];
    let prevHash;
    if (lastMessage) {
      prevHash = await this.hashChain.hashMessage(this.toHashable(lastMessage));
    } else {
      prevHash = GENESIS_HASH;
    }
    const message = {
      id: this.generateId(),
      channelId,
      senderId,
      timestamp: Date.now(),
      content,
      type,
      threadId,
      prevHash,
      status: "pending"
    };
    return message;
  }
  async addMessage(message) {
    const { msgs: channelMessages, ids } = this.ensureChannel(message.channelId);
    if (ids.has(message.id)) {
      return { success: false, error: `Duplicate message ID: ${message.id}` };
    }
    try {
      validateMessageContentLength(message.content);
    } catch (err) {
      return { success: false, error: err.message };
    }
    if (channelMessages.length === 0) {
      if (message.prevHash !== GENESIS_HASH) {
        return {
          success: false,
          error: `First message in channel must have genesis prevHash. Got: ${message.prevHash}`
        };
      }
    } else {
      const lastMessage = channelMessages[channelMessages.length - 1];
      const expectedHash = await this.hashChain.hashMessage(this.toHashable(lastMessage));
      if (message.prevHash !== expectedHash) {
        return {
          success: false,
          error: `Hash chain broken! Expected prevHash ${expectedHash}, got ${message.prevHash}`
        };
      }
      if (message.timestamp <= lastMessage.timestamp) {
        return {
          success: false,
          error: `Message timestamp ${message.timestamp} is not after previous message ${lastMessage.timestamp}`
        };
      }
    }
    channelMessages.push(message);
    ids.add(message.id);
    return { success: true };
  }
  forceAdd(message) {
    const { msgs, ids } = this.ensureChannel(message.channelId);
    if (ids.has(message.id))
      return;
    const insertIdx = this.upperBoundTimestamp(msgs, message.timestamp);
    if (insertIdx === msgs.length) {
      msgs.push(message);
    } else {
      msgs.splice(insertIdx, 0, message);
    }
    ids.add(message.id);
  }
  bulkAdd(messages) {
    if (messages.length === 0)
      return 0;
    let added = 0;
    const byChannel = new Map;
    for (const msg of messages) {
      if (!byChannel.has(msg.channelId))
        byChannel.set(msg.channelId, []);
      byChannel.get(msg.channelId).push(msg);
    }
    for (const [channelId, newMsgs] of byChannel) {
      const { msgs: existing, ids: existingIds } = this.ensureChannel(channelId);
      const deduped = newMsgs.filter((m) => !existingIds.has(m.id));
      if (deduped.length === 0)
        continue;
      for (const m of deduped) {
        existing.push(m);
        existingIds.add(m.id);
      }
      existing.sort((a, b) => a.timestamp - b.timestamp);
      added += deduped.length;
    }
    return added;
  }
  getMessages(channelId) {
    return this.channels.get(channelId) || [];
  }
  getAllChannelIds() {
    return Array.from(this.channels.keys());
  }
  getThread(channelId, threadId) {
    const messages = this.channels.get(channelId) || [];
    return messages.filter((m) => m.threadId === threadId);
  }
  async verifyChannel(channelId) {
    const messages = this.channels.get(channelId) || [];
    const hashable = messages.map((m) => this.toHashable(m));
    return this.hashChain.verifyFullChain(hashable);
  }
  async importMessages(channelId, messages) {
    const normalized = messages.map((message) => ({
      ...message,
      content: typeof message.content === "string" ? message.content : ""
    }));
    const hasOmittedContent = messages.some((message) => typeof message.content !== "string");
    try {
      for (const message of normalized)
        validateMessageContentLength(message.content);
    } catch (err) {
      return { success: false, error: err.message };
    }
    if (!hasOmittedContent) {
      const hashable = normalized.map((m) => this.toHashable(m));
      const verification = await this.hashChain.verifyFullChain(hashable);
      if (!verification.valid) {
        return {
          success: false,
          error: `Tampered message history detected: ${verification.reason}`
        };
      }
    }
    this.channels.set(channelId, normalized);
    this.channelIdSets.set(channelId, new Set(normalized.map((m) => m.id)));
    return { success: true };
  }
  async getLastHash(channelId) {
    const messages = this.channels.get(channelId) || [];
    if (messages.length === 0) {
      return GENESIS_HASH;
    }
    const last = messages[messages.length - 1];
    return this.hashChain.hashMessage(this.toHashable(last));
  }
  remapChannel(oldId, newId) {
    if (oldId === newId)
      return this.channels.get(oldId) ?? [];
    const messages = this.channels.get(oldId);
    if (!messages || messages.length === 0)
      return [];
    for (const msg of messages) {
      msg.channelId = newId;
    }
    const { msgs: existing, ids: existingIds } = this.ensureChannel(newId);
    const deduped = messages.filter((m) => !existingIds.has(m.id));
    const merged = [...existing, ...deduped];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    const mergedIds = new Set(merged.map((m) => m.id));
    this.channels.set(newId, merged);
    this.channelIdSets.set(newId, mergedIds);
    this.channels.delete(oldId);
    this.channelIdSets.delete(oldId);
    return this.channels.get(newId);
  }
  trimChannel(channelId, maxSize) {
    const msgs = this.channels.get(channelId);
    if (!msgs || msgs.length <= maxSize)
      return 0;
    const evictCount = msgs.length - maxSize;
    const evicted = msgs.splice(0, evictCount);
    const ids = this.channelIdSets.get(channelId);
    if (ids) {
      for (const m of evicted)
        ids.delete(m.id);
    }
    return evictCount;
  }
  prependMessages(channelId, older) {
    if (older.length === 0)
      return 0;
    const { msgs: existing, ids: existingIds } = this.ensureChannel(channelId);
    const deduped = older.filter((m) => !existingIds.has(m.id));
    if (deduped.length === 0)
      return 0;
    existing.unshift(...deduped);
    for (const m of deduped)
      existingIds.add(m.id);
    return deduped.length;
  }
  clearChannel(channelId) {
    this.channels.delete(channelId);
    this.channelIdSets.delete(channelId);
  }
  setThreadRoot(threadId, snapshot) {
    if (!this.threadRoots.has(threadId)) {
      this.threadRoots.set(threadId, snapshot);
    }
  }
  getThreadRoot(threadId) {
    return this.threadRoots.get(threadId);
  }
  getAllThreadRoots() {
    return new Map(this.threadRoots);
  }
  validateInvariants() {
    if (import.meta.env?.DEV === false)
      return;
    if (this.channels.size !== this.channelIdSets.size) {
      throw new Error(`[MessageStore] Key parity violated: channels.size=${this.channels.size} !== channelIdSets.size=${this.channelIdSets.size}`);
    }
    for (const channelId of this.channels.keys()) {
      if (!this.channelIdSets.has(channelId)) {
        throw new Error(`[MessageStore] Key parity violated: '${channelId}' exists in channels but is missing from channelIdSets`);
      }
    }
    for (const channelId of this.channelIdSets.keys()) {
      if (!this.channels.has(channelId)) {
        throw new Error(`[MessageStore] Key parity violated: '${channelId}' exists in channelIdSets but is missing from channels`);
      }
    }
    for (const [channelId, msgs] of this.channels) {
      const ids = this.channelIdSets.get(channelId);
      if (msgs.length !== ids.size) {
        throw new Error(`[MessageStore] Size parity violated for '${channelId}': msgs.length=${msgs.length} !== ids.size=${ids.size}`);
      }
      const seen = new Set;
      for (let i = 0;i < msgs.length; i++) {
        const msg = msgs[i];
        if (seen.has(msg.id)) {
          throw new Error(`[MessageStore] Duplicate IDs violated for '${channelId}': duplicate id='${msg.id}'`);
        }
        seen.add(msg.id);
        if (!ids.has(msg.id)) {
          throw new Error(`[MessageStore] Array→Set violated for '${channelId}': msgs[${i}].id='${msg.id}' missing in channelIdSets`);
        }
        if (msg.channelId !== channelId) {
          throw new Error(`[MessageStore] ChannelId mismatch for '${channelId}': msgs[${i}].channelId='${msg.channelId}'`);
        }
        if (i > 0 && msg.timestamp < msgs[i - 1].timestamp) {
          throw new Error(`[MessageStore] Timestamp order violated for '${channelId}': msgs[${i}].timestamp=${msg.timestamp} < msgs[${i - 1}].timestamp=${msgs[i - 1].timestamp}`);
        }
      }
      for (const id of ids) {
        if (!seen.has(id)) {
          throw new Error(`[MessageStore] Set→Array violated for '${channelId}': id='${id}' missing from message array`);
        }
      }
    }
  }
  toHashable(msg) {
    return {
      id: msg.id,
      channelId: msg.channelId,
      senderId: msg.senderId,
      timestamp: msg.timestamp,
      content: msg.content,
      type: msg.type,
      prevHash: msg.prevHash
    };
  }
  generateId() {
    return crypto.randomUUID();
  }
}
// ../decent-protocol/dist/messages/OfflineQueue.js
class OfflineQueue {
  constructor(config = {}) {
    Object.defineProperty(this, "inMemoryQueue", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "config", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "saveFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "loadFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "removeFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "removeBatchFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "removeAllFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "updateFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    this.config = {
      maxRetries: config.maxRetries ?? 10,
      retryDelayMs: config.retryDelayMs ?? 5000,
      maxAgeMs: config.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000
    };
  }
  setPersistence(save, load, remove, removeAll, update, removeBatch) {
    this.saveFn = save;
    this.loadFn = load;
    this.removeFn = remove;
    this.removeAllFn = removeAll;
    this.updateFn = update;
    this.removeBatchFn = removeBatch;
  }
  async enqueue(targetPeerId, data, meta = {}) {
    const msg = {
      targetPeerId,
      data,
      createdAt: meta.createdAt ?? Date.now(),
      attempts: meta.attempts ?? 0,
      ...meta.lastAttempt !== undefined ? { lastAttempt: meta.lastAttempt } : {},
      ...meta.envelopeId ? { envelopeId: meta.envelopeId } : {},
      ...meta.opId ? { opId: meta.opId } : {},
      ...meta.workspaceId ? { workspaceId: meta.workspaceId } : {},
      ...meta.channelId ? { channelId: meta.channelId } : {},
      ...meta.threadId ? { threadId: meta.threadId } : {},
      ...meta.domain ? { domain: meta.domain } : {},
      ...meta.recipientPeerIds ? { recipientPeerIds: [...meta.recipientPeerIds] } : {},
      ...meta.replicationClass ? { replicationClass: meta.replicationClass } : {},
      ...meta.custodyOwnerPeerId ? { custodyOwnerPeerId: meta.custodyOwnerPeerId } : {},
      ...meta.contentHash ? { contentHash: meta.contentHash } : {},
      ...meta.deliveryState ? { deliveryState: meta.deliveryState } : {},
      ...meta.expiresAt !== undefined ? { expiresAt: meta.expiresAt } : {},
      ...meta.deliveredAt !== undefined ? { deliveredAt: meta.deliveredAt } : {},
      ...meta.acknowledgedAt !== undefined ? { acknowledgedAt: meta.acknowledgedAt } : {},
      ...meta.receipt ? { receipt: meta.receipt } : {},
      ...meta.metadata ? { metadata: { ...meta.metadata } } : {}
    };
    if (this.saveFn) {
      await this.saveFn(targetPeerId, data, msg);
      return;
    }
    if (!this.inMemoryQueue.has(targetPeerId)) {
      this.inMemoryQueue.set(targetPeerId, []);
    }
    this.inMemoryQueue.get(targetPeerId).push(msg);
  }
  async enqueueEnvelope(targetPeerId, envelope) {
    await this.enqueue(targetPeerId, envelope, {
      envelopeId: envelope.envelopeId,
      opId: envelope.opId,
      workspaceId: envelope.workspaceId,
      channelId: envelope.channelId,
      threadId: envelope.threadId,
      domain: envelope.domain,
      recipientPeerIds: envelope.recipientPeerIds,
      replicationClass: envelope.replicationClass,
      custodyOwnerPeerId: envelope.custodyOwnerPeerId,
      contentHash: envelope.contentHash,
      deliveryState: envelope.deliveryState,
      createdAt: envelope.createdAt,
      expiresAt: envelope.expiresAt,
      metadata: envelope.metadata
    });
  }
  async getQueued(targetPeerId) {
    if (this.loadFn) {
      const persisted = await this.loadFn(targetPeerId);
      if (persisted.length > 0) {
        return this.filterDeliverable(targetPeerId, persisted);
      }
    }
    const messages = this.inMemoryQueue.get(targetPeerId) || [];
    return this.filterDeliverable(targetPeerId, messages);
  }
  async listQueued(targetPeerId) {
    if (this.loadFn)
      return await this.loadFn(targetPeerId);
    return [...this.inMemoryQueue.get(targetPeerId) || []];
  }
  async getSyncSummary(targetPeerId) {
    const messages = await this.listQueued(targetPeerId);
    const now = Date.now();
    const byDomain = {};
    const byReplicationClass = {};
    let deliverableCount = 0;
    let backingOffCount = 0;
    let exhaustedCount = 0;
    let expiredCount = 0;
    let acknowledgedCount = 0;
    let pendingReceiptCount = 0;
    let minCreatedAt;
    let maxCreatedAt;
    let latestEnvelopeId;
    let nextRetryAt;
    let lastReceiptAt;
    for (const m of messages) {
      if (m.domain)
        byDomain[m.domain] = (byDomain[m.domain] ?? 0) + 1;
      if (m.replicationClass) {
        byReplicationClass[m.replicationClass] = (byReplicationClass[m.replicationClass] ?? 0) + 1;
      }
      minCreatedAt = minCreatedAt === undefined ? m.createdAt : Math.min(minCreatedAt, m.createdAt);
      maxCreatedAt = maxCreatedAt === undefined ? m.createdAt : Math.max(maxCreatedAt, m.createdAt);
      if (m.envelopeId) {
        if (!latestEnvelopeId || m.createdAt >= (maxCreatedAt ?? 0))
          latestEnvelopeId = m.envelopeId;
      }
      if (m.receipt?.timestamp !== undefined) {
        lastReceiptAt = lastReceiptAt === undefined ? m.receipt.timestamp : Math.max(lastReceiptAt, m.receipt.timestamp);
      }
      if (m.deliveryState === "acknowledged") {
        acknowledgedCount += 1;
        continue;
      }
      if (m.deliveryState === "delivered" && !m.receipt) {
        pendingReceiptCount += 1;
      }
      if (this.isExpired(now, m)) {
        expiredCount += 1;
        continue;
      }
      const attempts = m.attempts ?? 0;
      if (attempts >= this.config.maxRetries) {
        exhaustedCount += 1;
        continue;
      }
      const dueAt = this.getDueAt(m);
      if (now >= dueAt) {
        deliverableCount += 1;
      } else {
        backingOffCount += 1;
        nextRetryAt = nextRetryAt === undefined ? dueAt : Math.min(nextRetryAt, dueAt);
      }
    }
    return {
      recipientPeerId: targetPeerId,
      totalEnvelopes: messages.length,
      deliverableCount,
      backingOffCount,
      exhaustedCount,
      expiredCount,
      acknowledgedCount,
      byDomain,
      byReplicationClass,
      pendingReceiptCount,
      minCreatedAt,
      maxCreatedAt,
      latestEnvelopeId,
      nextRetryAt,
      lastReceiptAt
    };
  }
  async flush(targetPeerId) {
    let messages;
    if (this.removeAllFn) {
      messages = await this.removeAllFn(targetPeerId);
    } else {
      messages = this.inMemoryQueue.get(targetPeerId) || [];
      this.inMemoryQueue.delete(targetPeerId);
    }
    const now = Date.now();
    const valid = messages.filter((m) => !this.isExpired(now, m));
    return valid.map((m) => m.data);
  }
  async remove(targetPeerId, messageId) {
    if (this.removeFn) {
      await this.removeFn(messageId);
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (queue) {
      const idx = queue.findIndex((m) => m.id === messageId);
      if (idx >= 0)
        queue.splice(idx, 1);
    }
  }
  async removeBatch(targetPeerId, messageIds) {
    if (messageIds.length === 0)
      return;
    if (messageIds.length === 1) {
      await this.remove(targetPeerId, messageIds[0]);
      return;
    }
    if (this.removeBatchFn) {
      await this.removeBatchFn(messageIds);
    } else if (this.removeFn) {
      for (const id of messageIds)
        await this.removeFn(id);
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (queue) {
      const idSet = new Set(messageIds);
      const filtered = queue.filter((m) => typeof m.id !== "number" || !idSet.has(m.id));
      if (filtered.length !== queue.length) {
        this.inMemoryQueue.set(targetPeerId, filtered);
      }
    }
  }
  async markDeliveredEnvelope(targetPeerId, envelopeId, receipt) {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => m.envelopeId === envelopeId);
    if (!match || typeof match.id !== "number") {
      const queue = this.inMemoryQueue.get(targetPeerId);
      const inMemory = queue?.find((m) => m.envelopeId === envelopeId);
      if (!inMemory)
        return false;
      inMemory.deliveryState = "delivered";
      inMemory.deliveredAt = receipt?.timestamp ?? Date.now();
      if (receipt)
        inMemory.receipt = receipt;
      return true;
    }
    await this.updateFn?.(match.id, {
      deliveryState: "delivered",
      deliveredAt: receipt?.timestamp ?? Date.now(),
      ...receipt ? { receipt } : {}
    });
    return true;
  }
  async acknowledgeEnvelope(targetPeerId, envelopeId, receipt) {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => m.envelopeId === envelopeId);
    if (!match)
      return false;
    if (typeof match.id === "number" && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: "acknowledged",
        acknowledgedAt: receipt?.timestamp ?? Date.now(),
        ...receipt ? { receipt } : {}
      });
      await this.remove(targetPeerId, match.id);
      return true;
    }
    if (typeof match.id === "number") {
      await this.remove(targetPeerId, match.id);
      return true;
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue)
      return false;
    const idx = queue.findIndex((m) => m.envelopeId === envelopeId);
    if (idx < 0)
      return false;
    queue[idx].deliveryState = "acknowledged";
    queue[idx].acknowledgedAt = receipt?.timestamp ?? Date.now();
    if (receipt)
      queue[idx].receipt = receipt;
    queue.splice(idx, 1);
    return true;
  }
  async acknowledgeByMessageId(targetPeerId, messageId, receipt) {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => this.matchesMessageId(m, messageId));
    if (!match)
      return false;
    if (match.envelopeId) {
      return await this.acknowledgeEnvelope(targetPeerId, match.envelopeId, receipt);
    }
    if (typeof match.id === "number" && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: "acknowledged",
        acknowledgedAt: receipt?.timestamp ?? Date.now(),
        ...receipt ? { receipt } : {}
      });
      await this.remove(targetPeerId, match.id);
      return true;
    }
    if (typeof match.id === "number") {
      await this.remove(targetPeerId, match.id);
      return true;
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue)
      return false;
    const idx = queue.findIndex((m) => this.matchesMessageId(m, messageId));
    if (idx < 0)
      return false;
    queue.splice(idx, 1);
    return true;
  }
  async markDeliveredByMessageId(targetPeerId, messageId, receipt) {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => this.matchesMessageId(m, messageId));
    if (!match)
      return false;
    if (match.envelopeId) {
      return await this.markDeliveredEnvelope(targetPeerId, match.envelopeId, receipt);
    }
    if (typeof match.id === "number" && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: "delivered",
        deliveredAt: receipt?.timestamp ?? Date.now(),
        ...receipt ? { receipt } : {}
      });
      return true;
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue)
      return false;
    const idx = queue.findIndex((m) => this.matchesMessageId(m, messageId));
    if (idx < 0)
      return false;
    queue[idx].deliveryState = "delivered";
    queue[idx].deliveredAt = receipt?.timestamp ?? Date.now();
    if (receipt)
      queue[idx].receipt = receipt;
    return true;
  }
  async applyReceipt(targetPeerId, receipt) {
    const kind = receipt.kind;
    if (kind === "stored" || kind === "delivered") {
      if (receipt.envelopeId) {
        return await this.markDeliveredEnvelope(targetPeerId, receipt.envelopeId, receipt);
      }
      return await this.markDeliveredByMessageId(targetPeerId, receipt.opId, receipt);
    }
    if (receipt.envelopeId) {
      return await this.acknowledgeEnvelope(targetPeerId, receipt.envelopeId, receipt);
    }
    return await this.acknowledgeByMessageId(targetPeerId, receipt.opId, receipt);
  }
  getQueuedCount(targetPeerId) {
    return (this.inMemoryQueue.get(targetPeerId) || []).length;
  }
  getTotalQueued() {
    let total = 0;
    for (const queue of this.inMemoryQueue.values()) {
      total += queue.length;
    }
    return total;
  }
  getPeersWithQueue() {
    return Array.from(this.inMemoryQueue.entries()).filter(([, msgs]) => msgs.length > 0).map(([peerId]) => peerId);
  }
  async markAttempt(targetPeerId, messageId) {
    const now = Date.now();
    if (this.updateFn) {
      const persisted = await this.loadFn?.(targetPeerId) || [];
      const current = persisted.find((m) => m.id === messageId);
      const nextAttempts = (current?.attempts ?? 0) + 1;
      await this.updateFn(messageId, { attempts: nextAttempts, lastAttempt: now });
      if (nextAttempts >= this.config.maxRetries) {
        await this.removeFn?.(messageId);
      }
      return;
    }
    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue)
      return;
    const msg = queue.find((m) => m.id === messageId);
    if (!msg)
      return;
    msg.attempts = (msg.attempts || 0) + 1;
    msg.lastAttempt = now;
    if (msg.attempts >= this.config.maxRetries) {
      const idx = queue.findIndex((m) => m.id === messageId);
      if (idx >= 0)
        queue.splice(idx, 1);
    }
  }
  filterDeliverable(targetPeerId, messages) {
    const now = Date.now();
    const deliverable = [];
    for (const m of messages) {
      const attempts = m.attempts ?? 0;
      const dueAt = this.getDueAt(m);
      const expired = this.isExpired(now, m);
      const exhausted = attempts >= this.config.maxRetries;
      if (expired || exhausted) {
        if (typeof m.id === "number") {
          this.remove(targetPeerId, m.id).catch(() => {});
        }
        continue;
      }
      if (now >= dueAt) {
        deliverable.push(m);
      }
    }
    return deliverable;
  }
  getDueAt(message) {
    const attempts = message.attempts ?? 0;
    const backoffMs = Math.min(this.config.retryDelayMs * Math.pow(2, attempts), 60000);
    return (message.lastAttempt ?? 0) + backoffMs;
  }
  matchesMessageId(message, messageId) {
    if (message.opId === messageId)
      return true;
    if (message.envelopeId === messageId)
      return true;
    const data = message.data;
    if (!data || typeof data !== "object")
      return false;
    return data.messageId === messageId || data.id === messageId;
  }
  isExpired(now, message) {
    const ageMs = now - message.createdAt;
    if (ageMs >= this.config.maxAgeMs)
      return true;
    if (message.expiresAt !== undefined && now >= message.expiresAt)
      return true;
    return false;
  }
  clear() {
    this.inMemoryQueue.clear();
  }
}
// ../decent-protocol/dist/messages/CustodyStore.js
var DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class CustodyStore {
  constructor(queue = new OfflineQueue({ maxAgeMs: DEFAULT_TTL_MS })) {
    Object.defineProperty(this, "queue", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: queue
    });
    Object.defineProperty(this, "receiptLog", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "saveReceiptFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "loadReceiptsFn", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
  }
  get offlineQueue() {
    return this.queue;
  }
  setReceiptPersistence(save, load) {
    this.saveReceiptFn = save;
    this.loadReceiptsFn = load;
  }
  async storeEnvelope(input) {
    const envelope = this.normalizeEnvelope(input);
    for (const peerId of envelope.recipientPeerIds) {
      await this.queue.enqueueEnvelope(peerId, envelope);
    }
    return envelope;
  }
  async getPendingForRecipient(recipientPeerId) {
    const queued = await this.queue.getQueued(recipientPeerId);
    return queued.map((item) => item.data).filter((item) => this.isValidActiveEnvelope(item));
  }
  async listAllForRecipient(recipientPeerId) {
    const queued = await this.queue.listQueued(recipientPeerId);
    return queued.map((item) => item.data).filter((item) => this.isValidActiveEnvelope(item));
  }
  async markDelivered(recipientPeerId, envelopeId, receipt) {
    const normalized = receipt ? this.normalizeReceipt(recipientPeerId, receipt) : undefined;
    const marked = await this.queue.markDeliveredEnvelope(recipientPeerId, envelopeId, normalized);
    if (marked && normalized) {
      await this.recordReceipt(normalized);
    }
    return marked;
  }
  async acknowledge(recipientPeerId, envelopeId, receipt) {
    const normalized = receipt ? this.normalizeReceipt(recipientPeerId, receipt) : undefined;
    const acked = await this.queue.acknowledgeEnvelope(recipientPeerId, envelopeId, normalized);
    if (acked && normalized) {
      await this.recordReceipt(normalized);
    }
    return acked;
  }
  async applyReceipt(recipientPeerId, receipt) {
    const normalized = this.normalizeReceipt(recipientPeerId, receipt);
    const applied = await this.queue.applyReceipt(recipientPeerId, normalized);
    if (applied) {
      await this.recordReceipt(normalized);
    }
    return applied;
  }
  async recordReceipt(receipt) {
    const existing = this.receiptLog.get(receipt.recipientPeerId) || [];
    if (!existing.some((entry) => entry.receiptId === receipt.receiptId)) {
      existing.push(receipt);
      existing.sort((a, b) => a.timestamp - b.timestamp || a.receiptId.localeCompare(b.receiptId));
      this.receiptLog.set(receipt.recipientPeerId, existing);
    }
    await this.saveReceiptFn?.(receipt);
  }
  async getReceipts(recipientPeerId) {
    if (this.loadReceiptsFn) {
      const receipts = await this.loadReceiptsFn(recipientPeerId);
      this.receiptLog.set(recipientPeerId, [...receipts]);
      return receipts;
    }
    return [...this.receiptLog.get(recipientPeerId) || []];
  }
  async buildRecipientSummary(recipientPeerId) {
    const envelopes = await this.listAllForRecipient(recipientPeerId);
    const byDomain = {};
    let minCreatedAt;
    let maxCreatedAt;
    for (const envelope of envelopes) {
      byDomain[envelope.domain] = (byDomain[envelope.domain] ?? 0) + 1;
      minCreatedAt = minCreatedAt === undefined ? envelope.createdAt : Math.min(minCreatedAt, envelope.createdAt);
      maxCreatedAt = maxCreatedAt === undefined ? envelope.createdAt : Math.max(maxCreatedAt, envelope.createdAt);
    }
    const sorted = [...envelopes].sort((a, b) => a.createdAt - b.createdAt || a.envelopeId.localeCompare(b.envelopeId));
    return {
      recipientPeerId,
      count: envelopes.length,
      envelopeIds: sorted.map((envelope) => envelope.envelopeId),
      opIds: sorted.map((envelope) => envelope.opId),
      byDomain,
      minCreatedAt,
      maxCreatedAt,
      latestEnvelopeId: sorted.length > 0 ? sorted[sorted.length - 1].envelopeId : undefined
    };
  }
  async buildSyncSummary(recipientPeerId) {
    const queueSummary = await this.queue.getSyncSummary(recipientPeerId);
    const receipts = await this.getReceipts(recipientPeerId);
    return {
      ...queueSummary,
      pendingReceiptCount: Math.max(queueSummary.pendingReceiptCount, queueSummary.deliverableCount - receipts.length),
      lastReceiptAt: receipts.length > 0 ? receipts[receipts.length - 1].timestamp : queueSummary.lastReceiptAt
    };
  }
  async reconcileRecipientSummary(recipientPeerId, remoteSummary) {
    const localSummary = await this.buildRecipientSummary(recipientPeerId);
    const localSet = new Set(localSummary.envelopeIds);
    const remoteSet = new Set(remoteSummary.envelopeIds);
    return {
      missingEnvelopeIds: [...localSet].filter((id) => !remoteSet.has(id)),
      extraEnvelopeIds: [...remoteSet].filter((id) => !localSet.has(id))
    };
  }
  normalizeEnvelope(input) {
    const createdAt = input.createdAt ?? Date.now();
    const expiresAt = input.expiresAt ?? createdAt + (input.ttlMs ?? DEFAULT_TTL_MS);
    return {
      envelopeId: input.envelopeId ?? crypto.randomUUID(),
      opId: input.opId,
      recipientPeerIds: [...new Set(input.recipientPeerIds)],
      workspaceId: input.workspaceId,
      ...input.channelId ? { channelId: input.channelId } : {},
      ...input.threadId ? { threadId: input.threadId } : {},
      domain: input.domain ?? "channel-message",
      ciphertext: input.ciphertext,
      ...input.contentHash ? { contentHash: input.contentHash } : {},
      createdAt,
      expiresAt,
      ...input.custodyOwnerPeerId ? { custodyOwnerPeerId: input.custodyOwnerPeerId } : {},
      replicationClass: input.replicationClass ?? "standard",
      deliveryState: input.deliveryState ?? "stored",
      ...input.metadata ? { metadata: { ...input.metadata } } : {}
    };
  }
  normalizeReceipt(recipientPeerId, receipt) {
    if (receipt.recipientPeerId === recipientPeerId)
      return receipt;
    return {
      ...receipt,
      recipientPeerId,
      metadata: {
        ...receipt.metadata || {},
        originalRecipientPeerId: receipt.recipientPeerId
      }
    };
  }
  isValidActiveEnvelope(value) {
    return this.isCustodyEnvelope(value) && !this.isEnvelopeExpired(value);
  }
  isEnvelopeExpired(envelope) {
    return Number.isFinite(envelope.expiresAt) && Date.now() >= envelope.expiresAt;
  }
  isCustodyEnvelope(value) {
    if (!value || typeof value !== "object")
      return false;
    const v = value;
    return typeof v.envelopeId === "string" && v.envelopeId.length > 0 && typeof v.opId === "string" && v.opId.length > 0 && Array.isArray(v.recipientPeerIds) && v.recipientPeerIds.length > 0 && v.recipientPeerIds.every((peerId) => typeof peerId === "string" && peerId.length > 0) && typeof v.workspaceId === "string" && v.workspaceId.length > 0 && typeof v.domain === "string" && v.domain.length > 0;
  }
}
// ../decent-protocol/dist/messages/PreKeyTypes.js
var PRE_KEY_BUNDLE_VERSION = 1;
// ../decent-protocol/dist/messages/PreKeyLifecyclePolicy.js
var DEFAULT_PRE_KEY_LIFECYCLE_POLICY = Object.freeze({
  signedPreKeyTtlMs: 30 * 24 * 60 * 60 * 1000,
  signedPreKeyRefreshWindowMs: 7 * 24 * 60 * 60 * 1000,
  maxOneTimePreKeyAgeMs: 21 * 24 * 60 * 60 * 1000,
  maxPeerBundleAgeMs: 45 * 24 * 60 * 60 * 1000,
  targetOneTimePreKeys: 20,
  lowWatermarkOneTimePreKeys: 8
});
function decideSignedPreKeyLifecycle(signedPreKey, options = {}) {
  const now = options.now ?? Date.now();
  const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.signedPreKeyRefreshWindowMs;
  if (!signedPreKey || signedPreKey.expiresAt <= now) {
    return {
      regenerateAll: true,
      rotateSignedPreKey: false
    };
  }
  return {
    regenerateAll: false,
    rotateSignedPreKey: signedPreKey.expiresAt - now <= refreshWindowMs
  };
}
function planLocalOneTimePreKeyLifecycle(entries, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxOneTimePreKeyAgeMs;
  const targetCount = options.targetCount ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.targetOneTimePreKeys;
  const lowWatermark = options.lowWatermark ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.lowWatermarkOneTimePreKeys;
  const minCreatedAt = now - maxAgeMs;
  const staleKeyIds = [];
  let totalCount = 0;
  for (const entry of entries) {
    totalCount += 1;
    if (entry.createdAt < minCreatedAt) {
      staleKeyIds.push(entry.keyId);
    }
  }
  const retainedCount = totalCount - staleKeyIds.length;
  const replenishCount = retainedCount < lowWatermark ? Math.max(0, targetCount - retainedCount) : 0;
  return {
    staleKeyIds,
    retainedCount,
    replenishCount
  };
}
function normalizePeerPreKeyBundle(bundle, options = {}) {
  if (!bundle)
    return null;
  const now = options.now ?? Date.now();
  const expectedVersion = options.expectedVersion ?? PRE_KEY_BUNDLE_VERSION;
  const maxBundleAgeMs = options.maxBundleAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxPeerBundleAgeMs;
  const maxOneTimePreKeyAgeMs = options.maxOneTimePreKeyAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxOneTimePreKeyAgeMs;
  if (bundle.version !== expectedVersion)
    return null;
  if (!bundle.signingPublicKey || !bundle.signedPreKey?.publicKey || !bundle.signedPreKey?.signature)
    return null;
  if (bundle.signedPreKey.expiresAt <= now)
    return null;
  if (!bundle.generatedAt || bundle.generatedAt < now - maxBundleAgeMs)
    return null;
  const minOneTimeCreatedAt = now - maxOneTimePreKeyAgeMs;
  const seen = new Set;
  const oneTimePreKeys = bundle.oneTimePreKeys.slice().sort((a, b) => a.keyId - b.keyId).filter((entry) => {
    if (!entry?.publicKey)
      return false;
    if (!Number.isFinite(entry.keyId) || entry.keyId <= 0)
      return false;
    if (!Number.isFinite(entry.createdAt) || entry.createdAt < minOneTimeCreatedAt)
      return false;
    if (seen.has(entry.keyId))
      return false;
    seen.add(entry.keyId);
    return true;
  });
  return {
    ...bundle,
    oneTimePreKeys
  };
}
function hasPeerPreKeyBundleChanged(before, after) {
  if (before.version !== after.version)
    return true;
  if (before.peerId !== after.peerId)
    return true;
  if (before.generatedAt !== after.generatedAt)
    return true;
  if (before.signingPublicKey !== after.signingPublicKey)
    return true;
  if (before.signedPreKey.keyId !== after.signedPreKey.keyId || before.signedPreKey.publicKey !== after.signedPreKey.publicKey || before.signedPreKey.signature !== after.signedPreKey.signature || before.signedPreKey.createdAt !== after.signedPreKey.createdAt || before.signedPreKey.expiresAt !== after.signedPreKey.expiresAt) {
    return true;
  }
  if (before.oneTimePreKeys.length !== after.oneTimePreKeys.length)
    return true;
  for (let i = 0;i < before.oneTimePreKeys.length; i++) {
    const beforeEntry = before.oneTimePreKeys[i];
    const afterEntry = after.oneTimePreKeys[i];
    if (beforeEntry.keyId !== afterEntry.keyId || beforeEntry.publicKey !== afterEntry.publicKey || beforeEntry.createdAt !== afterEntry.createdAt) {
      return true;
    }
  }
  return false;
}
// ../decent-protocol/dist/sync/ManifestStore.js
var MANIFEST_STORE_STATE_SCHEMA_VERSION = 1;
function domainKey(domain, channelId) {
  return channelId ? `${domain}:${channelId}` : domain;
}
function normalizeData(data) {
  if (!data)
    return {};
  return { ...data };
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function toFiniteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return null;
  return value;
}
function sanitizeVersionEntry(entry, fallbackWorkspaceId) {
  if (!isRecord(entry))
    return null;
  const domain = typeof entry.domain === "string" ? entry.domain : null;
  const workspaceId = typeof entry.workspaceId === "string" && entry.workspaceId.length > 0 ? entry.workspaceId : fallbackWorkspaceId;
  const version = toFiniteNumber(entry.version);
  const itemCount = toFiniteNumber(entry.itemCount);
  const lastUpdatedAt = toFiniteNumber(entry.lastUpdatedAt);
  const lastUpdatedBy = typeof entry.lastUpdatedBy === "string" ? entry.lastUpdatedBy : null;
  if (!domain || !workspaceId || version === null || itemCount === null || lastUpdatedAt === null || !lastUpdatedBy) {
    return null;
  }
  return {
    domain,
    workspaceId,
    ...typeof entry.channelId === "string" ? { channelId: entry.channelId } : {},
    version,
    itemCount,
    ...typeof entry.checksum === "string" ? { checksum: entry.checksum } : {},
    lastUpdatedAt,
    lastUpdatedBy
  };
}
function sanitizeDelta(delta, fallbackWorkspaceId) {
  if (!isRecord(delta))
    return null;
  const domain = typeof delta.domain === "string" ? delta.domain : null;
  const workspaceId = typeof delta.workspaceId === "string" && delta.workspaceId.length > 0 ? delta.workspaceId : fallbackWorkspaceId;
  const version = toFiniteNumber(delta.version);
  const baseVersion = toFiniteNumber(delta.baseVersion);
  const timestamp = toFiniteNumber(delta.timestamp);
  const opId = typeof delta.opId === "string" ? delta.opId : null;
  const operation = typeof delta.operation === "string" ? delta.operation : null;
  const subject = typeof delta.subject === "string" ? delta.subject : null;
  const author = typeof delta.author === "string" ? delta.author : null;
  if (!domain || !workspaceId || version === null || baseVersion === null || timestamp === null || !opId || !operation || !subject || !author) {
    return null;
  }
  return {
    domain,
    workspaceId,
    ...typeof delta.channelId === "string" ? { channelId: delta.channelId } : {},
    version,
    baseVersion,
    opId,
    operation,
    subject,
    data: isRecord(delta.data) ? normalizeData(delta.data) : {},
    timestamp,
    author
  };
}
function sanitizeSnapshot(snapshot, fallbackWorkspaceId) {
  if (!isRecord(snapshot))
    return null;
  const domain = typeof snapshot.domain === "string" ? snapshot.domain : null;
  const workspaceId = typeof snapshot.workspaceId === "string" && snapshot.workspaceId.length > 0 ? snapshot.workspaceId : fallbackWorkspaceId;
  const version = toFiniteNumber(snapshot.version);
  const basedOnVersion = toFiniteNumber(snapshot.basedOnVersion);
  const createdAt = toFiniteNumber(snapshot.createdAt);
  const createdBy = typeof snapshot.createdBy === "string" ? snapshot.createdBy : null;
  const snapshotId = typeof snapshot.snapshotId === "string" ? snapshot.snapshotId : null;
  if (!domain || !workspaceId || version === null || basedOnVersion === null || createdAt === null || !createdBy || !snapshotId) {
    return null;
  }
  const base = {
    domain,
    workspaceId,
    version,
    snapshotId,
    basedOnVersion,
    createdAt,
    createdBy,
    ...typeof snapshot.checksum === "string" ? { checksum: snapshot.checksum } : {}
  };
  if (domain === "workspace-manifest") {
    if (typeof snapshot.name !== "string")
      return null;
    const snapshotVersion = toFiniteNumber(snapshot.snapshotVersion);
    const deltasSince = toFiniteNumber(snapshot.deltasSince);
    if (snapshotVersion === null || deltasSince === null)
      return null;
    return {
      ...base,
      domain,
      name: snapshot.name,
      ...typeof snapshot.description === "string" ? { description: snapshot.description } : {},
      ...isRecord(snapshot.policy) ? { policy: deepClone(snapshot.policy) } : {},
      snapshotVersion,
      deltasSince
    };
  }
  if (domain === "membership") {
    const memberCount = toFiniteNumber(snapshot.memberCount);
    if (memberCount === null || !Array.isArray(snapshot.members))
      return null;
    const members = snapshot.members.filter((member) => isRecord(member) && typeof member.peerId === "string").map((member) => {
      const role = member.role === "owner" || member.role === "admin" || member.role === "member" ? member.role : "member";
      return {
        peerId: member.peerId,
        ...typeof member.alias === "string" ? { alias: member.alias } : {},
        role,
        joinedAt: toFiniteNumber(member.joinedAt) ?? 0
      };
    });
    return {
      ...base,
      domain,
      memberCount,
      members
    };
  }
  if (domain === "channel-manifest") {
    const channelCount = toFiniteNumber(snapshot.channelCount);
    if (channelCount === null || !Array.isArray(snapshot.channels))
      return null;
    const channels = snapshot.channels.filter((channel) => isRecord(channel) && typeof channel.id === "string").map((channel) => ({
      id: channel.id,
      name: typeof channel.name === "string" ? channel.name : channel.id,
      type: typeof channel.type === "string" ? channel.type : "channel",
      createdAt: toFiniteNumber(channel.createdAt) ?? 0,
      createdBy: typeof channel.createdBy === "string" ? channel.createdBy : "unknown"
    }));
    return {
      ...base,
      domain,
      channelCount,
      channels
    };
  }
  if (domain === "channel-message") {
    if (typeof snapshot.channelId !== "string" || snapshot.channelId.length === 0)
      return null;
    const messageCount = toFiniteNumber(snapshot.messageCount);
    const minTimestamp = toFiniteNumber(snapshot.minTimestamp);
    const maxTimestamp = toFiniteNumber(snapshot.maxTimestamp);
    if (messageCount === null || minTimestamp === null || maxTimestamp === null || !Array.isArray(snapshot.messageIds)) {
      return null;
    }
    return {
      ...base,
      domain,
      channelId: snapshot.channelId,
      messageCount,
      messageIds: snapshot.messageIds.filter((id) => typeof id === "string"),
      minTimestamp,
      maxTimestamp
    };
  }
  return null;
}
function sanitizeWorkspaceState(rawWorkspace) {
  if (!isRecord(rawWorkspace) || typeof rawWorkspace.workspaceId !== "string" || rawWorkspace.workspaceId.length === 0) {
    return null;
  }
  const workspaceId = rawWorkspace.workspaceId;
  const versions = new Map;
  const deltas = new Map;
  const snapshots = new Map;
  if (Array.isArray(rawWorkspace.versions)) {
    for (const entry of rawWorkspace.versions) {
      const version = sanitizeVersionEntry(entry, workspaceId);
      if (!version || version.workspaceId !== workspaceId)
        continue;
      versions.set(domainKey(version.domain, version.channelId), version);
    }
  }
  if (Array.isArray(rawWorkspace.deltas)) {
    const seenOpIds = new Map;
    for (const rawDelta of rawWorkspace.deltas) {
      const delta = sanitizeDelta(rawDelta, workspaceId);
      if (!delta || delta.workspaceId !== workspaceId)
        continue;
      const key = domainKey(delta.domain, delta.channelId);
      let seen = seenOpIds.get(key);
      if (!seen) {
        seen = new Set;
        seenOpIds.set(key, seen);
      }
      if (seen.has(delta.opId))
        continue;
      seen.add(delta.opId);
      const existing = deltas.get(key) ?? [];
      existing.push(delta);
      deltas.set(key, existing);
    }
    for (const [, domainDeltas] of deltas) {
      domainDeltas.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
    }
  }
  if (Array.isArray(rawWorkspace.snapshots)) {
    for (const rawSnapshot of rawWorkspace.snapshots) {
      const snapshot = sanitizeSnapshot(rawSnapshot, workspaceId);
      if (!snapshot || snapshot.workspaceId !== workspaceId)
        continue;
      const key = domainKey(snapshot.domain, snapshot.domain === "channel-message" ? snapshot.channelId : undefined);
      const existing = snapshots.get(key);
      if (!existing || existing.version <= snapshot.version) {
        snapshots.set(key, snapshot);
      }
    }
  }
  if (versions.size === 0 && deltas.size === 0 && snapshots.size === 0)
    return null;
  return {
    workspaceId,
    state: {
      versions,
      deltas,
      snapshots
    }
  };
}

class ManifestStore {
  constructor() {
    Object.defineProperty(this, "workspaces", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "changeListener", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "saveWorkspaceState", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "loadWorkspaceState", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "deleteWorkspaceState", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "hydratedWorkspaces", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Set
    });
  }
  setChangeListener(listener) {
    this.changeListener = listener;
  }
  setPersistence(saveWorkspaceState, loadWorkspaceState, deleteWorkspaceState) {
    this.saveWorkspaceState = saveWorkspaceState;
    this.loadWorkspaceState = loadWorkspaceState;
    this.deleteWorkspaceState = deleteWorkspaceState ?? null;
  }
  async restoreWorkspace(workspaceId) {
    if (!workspaceId || !this.loadWorkspaceState || this.hydratedWorkspaces.has(workspaceId))
      return false;
    this.hydratedWorkspaces.add(workspaceId);
    try {
      const persisted = await this.loadWorkspaceState(workspaceId);
      if (!persisted)
        return false;
      return this.importWorkspaceState(persisted);
    } catch {
      return false;
    }
  }
  async removeWorkspace(workspaceId) {
    this.workspaces.delete(workspaceId);
    this.hydratedWorkspaces.delete(workspaceId);
    if (!this.deleteWorkspaceState)
      return;
    try {
      await this.deleteWorkspaceState(workspaceId);
    } catch {}
  }
  exportWorkspaceState(workspaceId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws)
      return;
    const versions = [...ws.versions.values()].sort((a, b) => {
      const domainCmp = a.domain.localeCompare(b.domain);
      if (domainCmp !== 0)
        return domainCmp;
      return (a.channelId ?? "").localeCompare(b.channelId ?? "");
    }).map((entry) => ({ ...entry }));
    const deltas = [...ws.deltas.entries()].flatMap(([, domainDeltas]) => {
      const sorted = [...domainDeltas].sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
      return sorted.length > ManifestStore.MAX_DELTAS_PER_DOMAIN ? sorted.slice(sorted.length - ManifestStore.MAX_DELTAS_PER_DOMAIN) : sorted;
    }).sort((a, b) => {
      const domainCmp = a.domain.localeCompare(b.domain);
      if (domainCmp !== 0)
        return domainCmp;
      const channelCmp = (a.channelId ?? "").localeCompare(b.channelId ?? "");
      if (channelCmp !== 0)
        return channelCmp;
      if (a.version !== b.version)
        return a.version - b.version;
      if (a.timestamp !== b.timestamp)
        return a.timestamp - b.timestamp;
      return a.opId.localeCompare(b.opId);
    }).map((delta) => ({ ...delta, data: delta.data ? { ...delta.data } : {} }));
    const snapshots = [...ws.snapshots.values()].sort((a, b) => {
      const domainCmp = a.domain.localeCompare(b.domain);
      if (domainCmp !== 0)
        return domainCmp;
      return ("channelId" in a ? a.channelId ?? "" : "").localeCompare("channelId" in b ? b.channelId ?? "" : "");
    }).map((snapshot) => ({ ...snapshot }));
    return {
      workspaceId,
      versions,
      deltas,
      snapshots
    };
  }
  importWorkspaceState(state) {
    const parsed = sanitizeWorkspaceState(state);
    if (!parsed)
      return false;
    this.workspaces.set(parsed.workspaceId, parsed.state);
    this.hydratedWorkspaces.add(parsed.workspaceId);
    return true;
  }
  exportState() {
    const workspaces = [...this.workspaces.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workspaceId, ws]) => {
      const versions = [...ws.versions.values()].sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0)
          return domainCmp;
        return (a.channelId ?? "").localeCompare(b.channelId ?? "");
      }).map((entry) => ({ ...entry }));
      const deltas = [...ws.deltas.entries()].flatMap(([, domainDeltas]) => {
        const sorted = [...domainDeltas].sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
        return sorted.length > ManifestStore.MAX_DELTAS_PER_DOMAIN ? sorted.slice(sorted.length - ManifestStore.MAX_DELTAS_PER_DOMAIN) : sorted;
      }).sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0)
          return domainCmp;
        const channelCmp = (a.channelId ?? "").localeCompare(b.channelId ?? "");
        if (channelCmp !== 0)
          return channelCmp;
        if (a.version !== b.version)
          return a.version - b.version;
        if (a.timestamp !== b.timestamp)
          return a.timestamp - b.timestamp;
        return a.opId.localeCompare(b.opId);
      }).map((delta) => ({ ...delta, data: delta.data ? { ...delta.data } : {} }));
      const snapshots = [...ws.snapshots.values()].sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0)
          return domainCmp;
        return ("channelId" in a ? a.channelId ?? "" : "").localeCompare("channelId" in b ? b.channelId ?? "" : "");
      }).map((snapshot) => ({ ...snapshot }));
      return {
        workspaceId,
        versions,
        deltas,
        snapshots
      };
    });
    return {
      schemaVersion: MANIFEST_STORE_STATE_SCHEMA_VERSION,
      workspaces
    };
  }
  importState(state) {
    if (!isRecord(state))
      return;
    const schemaVersion = toFiniteNumber(state.schemaVersion);
    if (schemaVersion === null || schemaVersion < 1)
      return;
    const rawWorkspaces = state.workspaces;
    if (!Array.isArray(rawWorkspaces))
      return;
    const next = new Map;
    for (const rawWorkspace of rawWorkspaces) {
      if (!isRecord(rawWorkspace) || typeof rawWorkspace.workspaceId !== "string" || rawWorkspace.workspaceId.length === 0) {
        continue;
      }
      const workspaceId = rawWorkspace.workspaceId;
      const versions = new Map;
      const deltas = new Map;
      const snapshots = new Map;
      if (Array.isArray(rawWorkspace.versions)) {
        for (const entry of rawWorkspace.versions) {
          const version = sanitizeVersionEntry(entry, workspaceId);
          if (!version || version.workspaceId !== workspaceId)
            continue;
          versions.set(domainKey(version.domain, version.channelId), version);
        }
      }
      if (Array.isArray(rawWorkspace.deltas)) {
        for (const rawDelta of rawWorkspace.deltas) {
          const delta = sanitizeDelta(rawDelta, workspaceId);
          if (!delta || delta.workspaceId !== workspaceId)
            continue;
          const key = domainKey(delta.domain, delta.channelId);
          const existing = deltas.get(key) ?? [];
          if (!existing.some((entry) => entry.opId === delta.opId)) {
            existing.push(delta);
            existing.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
            deltas.set(key, existing);
          }
        }
      }
      if (Array.isArray(rawWorkspace.snapshots)) {
        for (const rawSnapshot of rawWorkspace.snapshots) {
          const snapshot = sanitizeSnapshot(rawSnapshot, workspaceId);
          if (!snapshot || snapshot.workspaceId !== workspaceId)
            continue;
          const key = domainKey(snapshot.domain, snapshot.domain === "channel-message" ? snapshot.channelId : undefined);
          const existing = snapshots.get(key);
          if (!existing || existing.version <= snapshot.version) {
            snapshots.set(key, snapshot);
          }
        }
      }
      if (versions.size === 0 && deltas.size === 0 && snapshots.size === 0)
        continue;
      next.set(workspaceId, {
        versions,
        deltas,
        snapshots
      });
    }
    if (rawWorkspaces.length > 0 && next.size === 0) {
      return;
    }
    this.workspaces.clear();
    this.hydratedWorkspaces.clear();
    for (const [workspaceId, ws] of next.entries()) {
      this.workspaces.set(workspaceId, ws);
      this.hydratedWorkspaces.add(workspaceId);
    }
  }
  notifyChange(workspaceId) {
    this.persistWorkspaceState(workspaceId);
    if (!this.changeListener)
      return;
    try {
      this.changeListener();
    } catch {}
  }
  persistWorkspaceState(workspaceId) {
    if (!this.saveWorkspaceState)
      return;
    const workspaceIds = workspaceId ? [workspaceId] : [...this.workspaces.keys()];
    for (const id of workspaceIds) {
      const snapshot = this.exportWorkspaceState(id);
      if (!snapshot)
        continue;
      Promise.resolve(this.saveWorkspaceState(id, snapshot)).catch(() => {});
    }
  }
  ensureWorkspace(workspaceId) {
    const existing = this.workspaces.get(workspaceId);
    if (existing)
      return existing;
    const created = {
      versions: new Map,
      deltas: new Map,
      snapshots: new Map
    };
    this.workspaces.set(workspaceId, created);
    return created;
  }
  updateDomain(params) {
    const now = params.timestamp ?? Date.now();
    const ws = this.ensureWorkspace(params.workspaceId);
    const key = domainKey(params.domain, params.channelId);
    const previous = ws.versions.get(key);
    const nextVersion = (previous?.version ?? 0) + 1;
    const state = {
      domain: params.domain,
      workspaceId: params.workspaceId,
      ...params.channelId ? { channelId: params.channelId } : {},
      version: nextVersion,
      itemCount: params.itemCount ?? previous?.itemCount ?? 0,
      ...params.checksum ? { checksum: params.checksum } : previous?.checksum ? { checksum: previous.checksum } : {},
      lastUpdatedAt: now,
      lastUpdatedBy: params.author
    };
    ws.versions.set(key, state);
    const delta = {
      domain: params.domain,
      workspaceId: params.workspaceId,
      ...params.channelId ? { channelId: params.channelId } : {},
      version: nextVersion,
      baseVersion: previous?.version ?? 0,
      opId: params.opId ?? crypto.randomUUID(),
      operation: params.operation ?? "update",
      subject: params.subject ?? key,
      data: normalizeData(params.data),
      timestamp: now,
      author: params.author
    };
    const deltas = ws.deltas.get(key) ?? [];
    deltas.push(delta);
    ws.deltas.set(key, deltas);
    this.notifyChange(params.workspaceId);
    return deepClone(delta);
  }
  getVersion(workspaceId, domain, channelId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws)
      return 0;
    return ws.versions.get(domainKey(domain, channelId))?.version ?? 0;
  }
  getSummary(workspaceId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) {
      return {
        workspaceId,
        generatedAt: Date.now(),
        versions: []
      };
    }
    const versions = [...ws.versions.values()].map((entry) => ({
      domain: entry.domain,
      workspaceId: entry.workspaceId,
      ...entry.channelId ? { channelId: entry.channelId } : {},
      version: entry.version,
      itemCount: entry.itemCount,
      lastUpdatedAt: entry.lastUpdatedAt,
      lastUpdatedBy: entry.lastUpdatedBy,
      ...entry.checksum ? { checksum: entry.checksum } : {}
    })).sort((a, b) => {
      const domainCmp = a.domain.localeCompare(b.domain);
      if (domainCmp !== 0)
        return domainCmp;
      const aChannel = a.channelId ?? "";
      const bChannel = b.channelId ?? "";
      return aChannel.localeCompare(bChannel);
    });
    const snapshots = [...ws.snapshots.values()].map((snapshot) => ({
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...snapshot.domain === "channel-message" && snapshot.channelId ? { channelId: snapshot.channelId } : {},
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      basedOnVersion: snapshot.basedOnVersion,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy
    }));
    return {
      workspaceId,
      generatedAt: Date.now(),
      versions,
      ...snapshots.length > 0 ? { snapshots } : {}
    };
  }
  buildDiffRequest(workspaceId, remote) {
    const localByKey = new Map;
    for (const localVersion of this.getSummary(workspaceId).versions) {
      localByKey.set(domainKey(localVersion.domain, localVersion.channelId), localVersion);
    }
    const requests = [];
    for (const remoteVersion of remote.versions) {
      const key = domainKey(remoteVersion.domain, remoteVersion.channelId);
      const local = localByKey.get(key);
      const localVersion = local?.version ?? 0;
      if (remoteVersion.version <= localVersion)
        continue;
      requests.push({
        domain: remoteVersion.domain,
        workspaceId,
        ...remoteVersion.channelId ? { channelId: remoteVersion.channelId } : {},
        fromVersion: localVersion,
        toVersion: remoteVersion.version
      });
    }
    return requests;
  }
  getDeltasSince(params) {
    const ws = this.workspaces.get(params.workspaceId);
    if (!ws)
      return [];
    const key = domainKey(params.domain, params.channelId);
    const deltas = ws.deltas.get(key) ?? [];
    const toVersion = params.toVersion ?? Number.MAX_SAFE_INTEGER;
    const limited = deltas.filter((delta) => delta.version > params.fromVersion && delta.version <= toVersion).sort((a, b) => a.version - b.version).slice(0, params.limit ?? Number.MAX_SAFE_INTEGER);
    return deepClone(limited);
  }
  applyDelta(delta) {
    const changed = this.applyDeltaInternal(delta);
    if (changed)
      this.notifyChange(delta.workspaceId);
    return deepClone(delta);
  }
  applyDeltaBatch(deltas) {
    const changedWorkspaces = new Set;
    for (const delta of deltas) {
      const changed = this.applyDeltaInternal(delta);
      if (changed)
        changedWorkspaces.add(delta.workspaceId);
    }
    for (const workspaceId of changedWorkspaces) {
      this.notifyChange(workspaceId);
    }
  }
  applyDeltaInternal(delta) {
    const ws = this.ensureWorkspace(delta.workspaceId);
    const key = domainKey(delta.domain, delta.channelId);
    const existing = ws.deltas.get(key) ?? [];
    let changed = false;
    if (!existing.some((entry) => entry.opId === delta.opId)) {
      existing.push({ ...delta, data: delta.data ? { ...delta.data } : {} });
      existing.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
      ws.deltas.set(key, existing);
      changed = true;
    }
    const previous = ws.versions.get(key);
    const currentVersion = previous?.version ?? 0;
    if (delta.version >= currentVersion) {
      const nextState = {
        domain: delta.domain,
        workspaceId: delta.workspaceId,
        ...delta.channelId ? { channelId: delta.channelId } : {},
        version: delta.version,
        itemCount: Number(delta.data?.itemCount ?? previous?.itemCount ?? 0),
        ...typeof delta.data?.checksum === "string" ? { checksum: String(delta.data.checksum) } : previous?.checksum ? { checksum: previous.checksum } : {},
        lastUpdatedAt: delta.timestamp,
        lastUpdatedBy: delta.author
      };
      ws.versions.set(key, nextState);
      changed = true;
    }
    return changed;
  }
  saveSnapshot(snapshot) {
    const ws = this.ensureWorkspace(snapshot.workspaceId);
    const key = domainKey(snapshot.domain, snapshot.domain === "channel-message" ? snapshot.channelId : undefined);
    ws.snapshots.set(key, { ...snapshot });
    const previous = ws.versions.get(key);
    ws.versions.set(key, {
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...snapshot.domain === "channel-message" && snapshot.channelId ? { channelId: snapshot.channelId } : {},
      version: snapshot.version,
      itemCount: this.snapshotItemCount(snapshot),
      ...snapshot.checksum ? { checksum: snapshot.checksum } : previous?.checksum ? { checksum: previous.checksum } : {},
      lastUpdatedAt: snapshot.createdAt,
      lastUpdatedBy: snapshot.createdBy
    });
    this.notifyChange(snapshot.workspaceId);
  }
  getSnapshot(workspaceId, domain, channelId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws)
      return null;
    const key = domainKey(domain, channelId);
    const snapshot = ws.snapshots.get(key);
    return snapshot ? deepClone(snapshot) : null;
  }
  restoreSnapshot(snapshot, restoredBy) {
    this.saveSnapshot(snapshot);
    return this.updateDomain({
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...snapshot.domain === "channel-message" && snapshot.channelId ? { channelId: snapshot.channelId } : {},
      author: restoredBy,
      itemCount: this.snapshotItemCount(snapshot),
      checksum: snapshot.checksum,
      operation: "update",
      subject: `snapshot:${snapshot.snapshotId}`,
      data: {
        snapshotId: snapshot.snapshotId,
        restored: true,
        itemCount: this.snapshotItemCount(snapshot)
      }
    });
  }
  snapshotItemCount(snapshot) {
    switch (snapshot.domain) {
      case "workspace-manifest":
        return 1;
      case "membership":
        return snapshot.memberCount;
      case "channel-manifest":
        return snapshot.channelCount;
      case "channel-message":
        return snapshot.messageCount;
      default:
        return 0;
    }
  }
}
Object.defineProperty(ManifestStore, "MAX_DELTAS_PER_DOMAIN", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 500
});
// ../decent-protocol/dist/storage/AtRestEncryption.js
var HKDF_INFO = new TextEncoder().encode("decent-at-rest-v1");

// ../decent-protocol/dist/storage/PersistentStore.js
var PRE_KEY_MAX_ONE_TIME_AGE_MS = 21 * 24 * 60 * 60 * 1000;
var PRE_KEY_MAX_BUNDLE_AGE_MS = 45 * 24 * 60 * 60 * 1000;
// ../node_modules/.bun/@noble+hashes@2.0.1/node_modules/@noble/hashes/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n, title = "") {
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new Error(`${prefix}expected integer >= 0, got ${n}`);
  }
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== undefined;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash must wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, undefined, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error('"digestInto() output" expected to be of length >=' + min);
  }
}
function clean(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0;i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === undefined || n2 === undefined) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0;i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0;i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(undefined);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// ../node_modules/.bun/@noble+hashes@2.0.1/node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}

class HashMD {
  blockLen;
  outputLen;
  padOffset;
  isLE;
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos;i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0;i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor;
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA224_IV = /* @__PURE__ */ Uint32Array.from([
  3238371032,
  914150663,
  812702999,
  4144912697,
  4290775857,
  1750603025,
  1694076839,
  3204075428
]);
var SHA384_IV = /* @__PURE__ */ Uint32Array.from([
  3418070365,
  3238371032,
  1654270250,
  914150663,
  2438529370,
  812702999,
  355462360,
  4144912697,
  1731405415,
  4290775857,
  2394180231,
  1750603025,
  3675008525,
  1694076839,
  1203062813,
  3204075428
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// ../node_modules/.bun/@noble+hashes@2.0.1/node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0;i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// ../node_modules/.bun/@noble+hashes@2.0.1/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

class SHA2_32B extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16;i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0;i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
}

class _SHA256 extends SHA2_32B {
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
}

class _SHA224 extends SHA2_32B {
  A = SHA224_IV[0] | 0;
  B = SHA224_IV[1] | 0;
  C = SHA224_IV[2] | 0;
  D = SHA224_IV[3] | 0;
  E = SHA224_IV[4] | 0;
  F = SHA224_IV[5] | 0;
  G = SHA224_IV[6] | 0;
  H = SHA224_IV[7] | 0;
  constructor() {
    super(28);
  }
}
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);

class SHA2_64B extends HashMD {
  constructor(outputLen) {
    super(128, outputLen, 16, false);
  }
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16;i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0;i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}

class _SHA512 extends SHA2_64B {
  Ah = SHA512_IV[0] | 0;
  Al = SHA512_IV[1] | 0;
  Bh = SHA512_IV[2] | 0;
  Bl = SHA512_IV[3] | 0;
  Ch = SHA512_IV[4] | 0;
  Cl = SHA512_IV[5] | 0;
  Dh = SHA512_IV[6] | 0;
  Dl = SHA512_IV[7] | 0;
  Eh = SHA512_IV[8] | 0;
  El = SHA512_IV[9] | 0;
  Fh = SHA512_IV[10] | 0;
  Fl = SHA512_IV[11] | 0;
  Gh = SHA512_IV[12] | 0;
  Gl = SHA512_IV[13] | 0;
  Hh = SHA512_IV[14] | 0;
  Hl = SHA512_IV[15] | 0;
  constructor() {
    super(64);
  }
}

class _SHA384 extends SHA2_64B {
  Ah = SHA384_IV[0] | 0;
  Al = SHA384_IV[1] | 0;
  Bh = SHA384_IV[2] | 0;
  Bl = SHA384_IV[3] | 0;
  Ch = SHA384_IV[4] | 0;
  Cl = SHA384_IV[5] | 0;
  Dh = SHA384_IV[6] | 0;
  Dl = SHA384_IV[7] | 0;
  Eh = SHA384_IV[8] | 0;
  El = SHA384_IV[9] | 0;
  Fh = SHA384_IV[10] | 0;
  Fl = SHA384_IV[11] | 0;
  Gh = SHA384_IV[12] | 0;
  Gl = SHA384_IV[13] | 0;
  Hh = SHA384_IV[14] | 0;
  Hl = SHA384_IV[15] | 0;
  constructor() {
    super(48);
  }
}
var T224_IV = /* @__PURE__ */ Uint32Array.from([
  2352822216,
  424955298,
  1944164710,
  2312950998,
  502970286,
  855612546,
  1738396948,
  1479516111,
  258812777,
  2077511080,
  2011393907,
  79989058,
  1067287976,
  1780299464,
  286451373,
  2446758561
]);
var T256_IV = /* @__PURE__ */ Uint32Array.from([
  573645204,
  4230739756,
  2673172387,
  3360449730,
  596883563,
  1867755857,
  2520282905,
  1497426621,
  2519219938,
  2827943907,
  3193839141,
  1401305490,
  721525244,
  746961066,
  246885852,
  2177182882
]);

class _SHA512_224 extends SHA2_64B {
  Ah = T224_IV[0] | 0;
  Al = T224_IV[1] | 0;
  Bh = T224_IV[2] | 0;
  Bl = T224_IV[3] | 0;
  Ch = T224_IV[4] | 0;
  Cl = T224_IV[5] | 0;
  Dh = T224_IV[6] | 0;
  Dl = T224_IV[7] | 0;
  Eh = T224_IV[8] | 0;
  El = T224_IV[9] | 0;
  Fh = T224_IV[10] | 0;
  Fl = T224_IV[11] | 0;
  Gh = T224_IV[12] | 0;
  Gl = T224_IV[13] | 0;
  Hh = T224_IV[14] | 0;
  Hl = T224_IV[15] | 0;
  constructor() {
    super(28);
  }
}

class _SHA512_256 extends SHA2_64B {
  Ah = T256_IV[0] | 0;
  Al = T256_IV[1] | 0;
  Bh = T256_IV[2] | 0;
  Bl = T256_IV[3] | 0;
  Ch = T256_IV[4] | 0;
  Cl = T256_IV[5] | 0;
  Dh = T256_IV[6] | 0;
  Dl = T256_IV[7] | 0;
  Eh = T256_IV[8] | 0;
  El = T256_IV[9] | 0;
  Fh = T256_IV[10] | 0;
  Fl = T256_IV[11] | 0;
  Gh = T256_IV[12] | 0;
  Gl = T256_IV[13] | 0;
  Hh = T256_IV[14] | 0;
  Hl = T256_IV[15] | 0;
  constructor() {
    super(32);
  }
}
var sha256 = /* @__PURE__ */ createHasher(() => new _SHA256, /* @__PURE__ */ oidNist(1));

// ../node_modules/.bun/@noble+curves@2.0.1/node_modules/@noble/curves/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function abool(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}" `;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new Error("positive bigint expected, got " + n);
  } else
    anumber(n);
  return n;
}
function numberToHexUnpadded(num) {
  const hex = abignumber(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  n = abignumber(n);
  const res = hexToBytes(n.toString(16).padStart(len * 2, "0"));
  if (res.length !== len)
    throw new Error("number too large");
  return res;
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0;n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber(hashLen, "hashLen");
  anumber(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1000;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = undefined;
    while (!(res = pred(gen())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object, fields = {}, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === undefined)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}
function memoized(fn) {
  const map = new WeakMap;
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== undefined)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// ../node_modules/.bun/@noble+curves@2.0.1/node_modules/@noble/curves/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
  const p1div4 = (Fp.ORDER + _1n2) / _4n;
  const root = Fp.pow(n, p1div4);
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const p5div8 = (Fp.ORDER - _5n) / _8n;
  const n2 = Fp.mul(n, _2n);
  const v = Fp.pow(n2, p5div8);
  const nv = Fp.mul(n, v);
  const i = Fp.mul(Fp.mul(nv, _2n), v);
  const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp, n) => {
    let tv1 = Fp.pow(n, c4);
    let tv2 = Fp.mul(tv1, c1);
    const tv3 = Fp.mul(tv1, c2);
    const tv4 = Fp.mul(tv1, c3);
    const e1 = Fp.eql(Fp.sqr(tv2), n);
    const e2 = Fp.eql(Fp.sqr(tv3), n);
    tv1 = Fp.cmov(tv1, tv2, e1);
    tv2 = Fp.cmov(tv4, tv3, e2);
    const e3 = Fp.eql(Fp.sqr(tv2), n);
    const root = Fp.cmov(tv1, tv2, e3);
    assertIsSquare(Fp, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1000)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    if (Fp.is0(n))
      return n;
    if (FpLegendre(Fp, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp.mul(Fp.ONE, cc);
    let t = Fp.pow(n, Q);
    let R = Fp.pow(n, Q1div2);
    while (!Fp.eql(t, Fp.ONE)) {
      if (Fp.is0(t))
        return Fp.ZERO;
      let i = 1;
      let t_tmp = Fp.sqr(t);
      while (!Fp.eql(t_tmp, Fp.ONE)) {
        i++;
        t_tmp = Fp.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp.pow(c, exponent);
      M = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  validateObject(field, opts);
  return field;
}
function FpPow(Fp, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num;
  let p = Fp.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp.mul(p, d);
    d = Fp.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const p1mod2 = (Fp.ORDER - _1n2) / _2n;
  const powered = Fp.pow(n, p1mod2);
  const yes = Fp.eql(powered, Fp.ONE);
  const zero = Fp.eql(powered, Fp.ZERO);
  const no = Fp.eql(powered, Fp.neg(Fp.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== undefined)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}

class _Field {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _sqrt;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _0n2)
      throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
    let _nbitLength = undefined;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        this.sqrt = opts.sqrt;
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = opts.allowedLengths?.slice();
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    this._sqrt = undefined;
    Object.preventExtensions(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new Error("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    if (!this._sqrt)
      this._sqrt = FpSqrt(this.ORDER);
    return this._sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes(bytes);
    const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  invertBatch(lst) {
    return FpInvertBatch(this, lst);
  }
  cmov(a, b, condition) {
    return condition ? b : a;
  }
}
function Field(ORDER, opts = {}) {
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE = false) {
  abytes(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// ../node_modules/.bun/@noble+curves@2.0.1/node_modules/@noble/curves/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window2, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window2 * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window2 % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
var pointPrecomputes = new WeakMap;
var pointWindowSizes = new WeakMap;
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}

class wNAF {
  BASE;
  ZERO;
  Fn;
  bits;
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window2 = 0;window2 < windows; window2++) {
      base = p;
      points.push(base);
      for (let i = 1;i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0;window2 < wo.windows; window2++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0;window2 < wo.windows; window2++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
}
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === undefined)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// ../node_modules/.bun/@noble+hashes@2.0.1/node_modules/@noble/hashes/hmac.js
class _HMAC {
  oHash;
  iHash;
  blockLen;
  outputLen;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, undefined, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0;i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0;i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    abytes(out, this.outputLen, "output");
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
}
var hmac = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
hmac.create = (hash, key) => new _HMAC(hash, key);

// ../node_modules/.bun/@noble+curves@2.0.1/node_modules/@noble/curves/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === undefined ? def[optName] : opts[optName];
  }
  abool(optsn.lowS, "lowS");
  abool(optsn.prehash, "prehash");
  if (optsn.format !== undefined)
    validateSigFormat(optsn.format);
  return optsn;
}

class DERErr extends Error {
  constructor(m = "") {
    super(m);
  }
}
var DER = {
  Err: DERErr,
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    decode(tag, data) {
      const { Err: E } = DER;
      let pos = 0;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  _int: {
    encode(num) {
      const { Err: E } = DER;
      if (num < _0n4)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = DER;
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data = abytes(bytes, undefined, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = DER;
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object"
  });
  const { endo } = extraOpts;
  if (endo) {
    if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes(pprefix(hasEvenY), bx);
    } else {
      return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes(bytes, undefined, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes || pointToBytes;
  const decodePoint = extraOpts.fromBytes || pointFromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp.eql(Z, Fp.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(Z);
    const x = Fp.mul(X, iz);
    const y = Fp.mul(Y, iz);
    const zz = Fp.mul(Z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }

  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes(bytes, undefined, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    double() {
      const { a, b } = CURVE;
      const b3 = Fp.mul(b, _3n2);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
      const a = CURVE.a;
      const b3 = Fp.mul(CURVE.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn.isValidNot0(scalar))
        throw new Error("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    multiplyUnsafe(sc) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      if (!Fn.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    toBytes(isCompressed = true) {
      abool(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const bits = Fn.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes || randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn), { seed: getMinHashLength(Fn.ORDER) });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !!Point.fromBytes(publicKey);
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed = randomBytes_(lengths.seed)) {
    return mapHashToField(abytes(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    if (!isBytes(item))
      return;
    if ("_lengths" in Fn && Fn._lengths || secretKey === publicKey)
      return;
    const l = abytes(item, undefined, "key").length;
    return l === publicKey || l === publicKeyUncompressed;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  ahash(hash);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  ecdsaOpts = Object.assign({}, ecdsaOpts);
  const randomBytes2 = ecdsaOpts.randomBytes || randomBytes;
  const hmac2 = ecdsaOpts.hmac || ((key, msg) => hmac(hash, key, msg));
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeCofactor = CURVE_ORDER * _2n2 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n4;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertSmallCofactor() {
    if (hasLargeCofactor)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : undefined;
    return abytes(bytes, sizer);
  }

  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertSmallCofactor();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        const { r: r2, s: s2 } = DER.toSig(abytes(bytes));
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes(hex), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes(pprefix((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes(messageHash, undefined, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertSmallCofactor();
        return concatBytes(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes(rb, sb);
    }
    toHex(format) {
      return bytesToHex(this.toBytes(format));
    }
  }
  const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  };
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n4, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes(message, undefined, "message");
    return prehash ? abytes(hash(message), undefined, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes2(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes(e, undefined, "extraEntropy"));
    }
    const seed = concatBytes(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const ik = Fn.inv(k);
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n4)
        return;
      const s = Fn.create(ik * Fn.create(m + r * d));
      if (s === _0n4)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n4);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeCofactor ? undefined : recovery);
    }
    return { seed, k2sig };
  }
  function sign(message, secretKey, opts = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts);
    const drbg = createHmacDrbg(hash.outputLen, Fn.BYTES, hmac2);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts.format);
  }
  function verify(signature, message, publicKey, opts = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
    publicKey = abytes(publicKey, undefined, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P = Point.fromBytes(publicKey);
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
      if (R.is0())
        return false;
      const v = Fn.create(R.x);
      return v === r;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts = {}) {
    const { prehash } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign,
    verify,
    recoverPublicKey,
    Signature,
    hash
  });
}

// ../node_modules/.bun/@noble+curves@2.0.1/node_modules/@noble/curves/nist.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var p256_CURVE = /* @__PURE__ */ (() => ({
  p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  h: BigInt(1),
  a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
  b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}))();
var p256_Point = /* @__PURE__ */ weierstrass(p256_CURVE);
var p256 = /* @__PURE__ */ ecdsa(p256_Point, sha256);

// ../decent-protocol/dist/identity/wordlist.js
var WORDLIST = [
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  "absurd",
  "abuse",
  "access",
  "accident",
  "account",
  "accuse",
  "achieve",
  "acid",
  "acoustic",
  "acquire",
  "across",
  "act",
  "action",
  "actor",
  "actress",
  "actual",
  "adapt",
  "add",
  "addict",
  "address",
  "adjust",
  "admit",
  "adult",
  "advance",
  "advice",
  "aerobic",
  "affair",
  "afford",
  "afraid",
  "again",
  "age",
  "agent",
  "agree",
  "ahead",
  "aim",
  "air",
  "airport",
  "aisle",
  "alarm",
  "album",
  "alcohol",
  "alert",
  "alien",
  "all",
  "alley",
  "allow",
  "almost",
  "alone",
  "alpha",
  "already",
  "also",
  "alter",
  "always",
  "amateur",
  "amazing",
  "among",
  "amount",
  "amused",
  "analyst",
  "anchor",
  "ancient",
  "anger",
  "angle",
  "angry",
  "animal",
  "ankle",
  "announce",
  "annual",
  "another",
  "answer",
  "antenna",
  "antique",
  "anxiety",
  "any",
  "apart",
  "apology",
  "appear",
  "apple",
  "approve",
  "april",
  "arch",
  "arctic",
  "area",
  "arena",
  "argue",
  "arm",
  "armed",
  "armor",
  "army",
  "around",
  "arrange",
  "arrest",
  "arrive",
  "arrow",
  "art",
  "artefact",
  "artist",
  "artwork",
  "ask",
  "aspect",
  "assault",
  "asset",
  "assist",
  "assume",
  "asthma",
  "athlete",
  "atom",
  "attack",
  "attend",
  "attitude",
  "attract",
  "auction",
  "audit",
  "august",
  "aunt",
  "author",
  "auto",
  "autumn",
  "average",
  "avocado",
  "avoid",
  "awake",
  "aware",
  "away",
  "awesome",
  "awful",
  "awkward",
  "axis",
  "baby",
  "bachelor",
  "bacon",
  "badge",
  "bag",
  "balance",
  "balcony",
  "ball",
  "bamboo",
  "banana",
  "banner",
  "bar",
  "barely",
  "bargain",
  "barrel",
  "base",
  "basic",
  "basket",
  "battle",
  "beach",
  "bean",
  "beauty",
  "because",
  "become",
  "beef",
  "before",
  "begin",
  "behave",
  "behind",
  "believe",
  "below",
  "belt",
  "bench",
  "benefit",
  "best",
  "betray",
  "better",
  "between",
  "beyond",
  "bicycle",
  "bid",
  "bike",
  "bind",
  "biology",
  "bird",
  "birth",
  "bitter",
  "black",
  "blade",
  "blame",
  "blanket",
  "blast",
  "bleak",
  "bless",
  "blind",
  "blood",
  "blossom",
  "blouse",
  "blue",
  "blur",
  "blush",
  "board",
  "boat",
  "body",
  "boil",
  "bomb",
  "bone",
  "bonus",
  "book",
  "boost",
  "border",
  "boring",
  "borrow",
  "boss",
  "bottom",
  "bounce",
  "box",
  "boy",
  "bracket",
  "brain",
  "brand",
  "brass",
  "brave",
  "bread",
  "breeze",
  "brick",
  "bridge",
  "brief",
  "bright",
  "bring",
  "brisk",
  "broccoli",
  "broken",
  "bronze",
  "broom",
  "brother",
  "brown",
  "brush",
  "bubble",
  "buddy",
  "budget",
  "buffalo",
  "build",
  "bulb",
  "bulk",
  "bullet",
  "bundle",
  "bunker",
  "burden",
  "burger",
  "burst",
  "bus",
  "business",
  "busy",
  "butter",
  "buyer",
  "buzz",
  "cabbage",
  "cabin",
  "cable",
  "cactus",
  "cage",
  "cake",
  "call",
  "calm",
  "camera",
  "camp",
  "can",
  "canal",
  "cancel",
  "candy",
  "cannon",
  "canoe",
  "canvas",
  "canyon",
  "capable",
  "capital",
  "captain",
  "car",
  "carbon",
  "card",
  "cargo",
  "carpet",
  "carry",
  "cart",
  "case",
  "cash",
  "casino",
  "castle",
  "casual",
  "cat",
  "catalog",
  "catch",
  "category",
  "cattle",
  "caught",
  "cause",
  "caution",
  "cave",
  "ceiling",
  "celery",
  "cement",
  "census",
  "century",
  "cereal",
  "certain",
  "chair",
  "chalk",
  "champion",
  "change",
  "chaos",
  "chapter",
  "charge",
  "chase",
  "chat",
  "cheap",
  "check",
  "cheese",
  "chef",
  "cherry",
  "chest",
  "chicken",
  "chief",
  "child",
  "chimney",
  "choice",
  "choose",
  "chronic",
  "chuckle",
  "chunk",
  "churn",
  "cigar",
  "cinnamon",
  "circle",
  "citizen",
  "city",
  "civil",
  "claim",
  "clap",
  "clarify",
  "claw",
  "clay",
  "clean",
  "clerk",
  "clever",
  "click",
  "client",
  "cliff",
  "climb",
  "clinic",
  "clip",
  "clock",
  "clog",
  "close",
  "cloth",
  "cloud",
  "clown",
  "club",
  "clump",
  "cluster",
  "clutch",
  "coach",
  "coast",
  "coconut",
  "code",
  "coffee",
  "coil",
  "coin",
  "collect",
  "color",
  "column",
  "combine",
  "come",
  "comfort",
  "comic",
  "common",
  "company",
  "concert",
  "conduct",
  "confirm",
  "congress",
  "connect",
  "consider",
  "control",
  "convince",
  "cook",
  "cool",
  "copper",
  "copy",
  "coral",
  "core",
  "corn",
  "correct",
  "cost",
  "cotton",
  "couch",
  "country",
  "couple",
  "course",
  "cousin",
  "cover",
  "coyote",
  "crack",
  "cradle",
  "craft",
  "cram",
  "crane",
  "crash",
  "crater",
  "crawl",
  "crazy",
  "cream",
  "credit",
  "creek",
  "crew",
  "cricket",
  "crime",
  "crisp",
  "critic",
  "crop",
  "cross",
  "crouch",
  "crowd",
  "crucial",
  "cruel",
  "cruise",
  "crumble",
  "crunch",
  "crush",
  "cry",
  "crystal",
  "cube",
  "culture",
  "cup",
  "cupboard",
  "curious",
  "current",
  "curtain",
  "curve",
  "cushion",
  "custom",
  "cute",
  "cycle",
  "dad",
  "damage",
  "damp",
  "dance",
  "danger",
  "daring",
  "dash",
  "daughter",
  "dawn",
  "day",
  "deal",
  "debate",
  "debris",
  "decade",
  "december",
  "decide",
  "decline",
  "decorate",
  "decrease",
  "deer",
  "defense",
  "define",
  "defy",
  "degree",
  "delay",
  "deliver",
  "demand",
  "demise",
  "denial",
  "dentist",
  "deny",
  "depart",
  "depend",
  "deposit",
  "depth",
  "deputy",
  "derive",
  "describe",
  "desert",
  "design",
  "desk",
  "despair",
  "destroy",
  "detail",
  "detect",
  "develop",
  "device",
  "devote",
  "diagram",
  "dial",
  "diamond",
  "diary",
  "dice",
  "diesel",
  "diet",
  "differ",
  "digital",
  "dignity",
  "dilemma",
  "dinner",
  "dinosaur",
  "direct",
  "dirt",
  "disagree",
  "discover",
  "disease",
  "dish",
  "dismiss",
  "disorder",
  "display",
  "distance",
  "divert",
  "divide",
  "divorce",
  "dizzy",
  "doctor",
  "document",
  "dog",
  "doll",
  "dolphin",
  "domain",
  "donate",
  "donkey",
  "donor",
  "door",
  "dose",
  "double",
  "dove",
  "draft",
  "dragon",
  "drama",
  "drastic",
  "draw",
  "dream",
  "dress",
  "drift",
  "drill",
  "drink",
  "drip",
  "drive",
  "drop",
  "drum",
  "dry",
  "duck",
  "dumb",
  "dune",
  "during",
  "dust",
  "dutch",
  "duty",
  "dwarf",
  "dynamic",
  "eager",
  "eagle",
  "early",
  "earn",
  "earth",
  "easily",
  "east",
  "easy",
  "echo",
  "ecology",
  "economy",
  "edge",
  "edit",
  "educate",
  "effort",
  "egg",
  "eight",
  "either",
  "elbow",
  "elder",
  "electric",
  "elegant",
  "element",
  "elephant",
  "elevator",
  "elite",
  "else",
  "embark",
  "embody",
  "embrace",
  "emerge",
  "emotion",
  "employ",
  "empower",
  "empty",
  "enable",
  "enact",
  "end",
  "endless",
  "endorse",
  "enemy",
  "energy",
  "enforce",
  "engage",
  "engine",
  "enhance",
  "enjoy",
  "enlist",
  "enough",
  "enrich",
  "enroll",
  "ensure",
  "enter",
  "entire",
  "entry",
  "envelope",
  "episode",
  "equal",
  "equip",
  "era",
  "erase",
  "erode",
  "erosion",
  "error",
  "erupt",
  "escape",
  "essay",
  "essence",
  "estate",
  "eternal",
  "ethics",
  "evidence",
  "evil",
  "evoke",
  "evolve",
  "exact",
  "example",
  "excess",
  "exchange",
  "excite",
  "exclude",
  "excuse",
  "execute",
  "exercise",
  "exhaust",
  "exhibit",
  "exile",
  "exist",
  "exit",
  "exotic",
  "expand",
  "expect",
  "expire",
  "explain",
  "expose",
  "express",
  "extend",
  "extra",
  "eye",
  "eyebrow",
  "fabric",
  "face",
  "faculty",
  "fade",
  "faint",
  "faith",
  "fall",
  "false",
  "fame",
  "family",
  "famous",
  "fan",
  "fancy",
  "fantasy",
  "farm",
  "fashion",
  "fat",
  "fatal",
  "father",
  "fatigue",
  "fault",
  "favorite",
  "feature",
  "february",
  "federal",
  "fee",
  "feed",
  "feel",
  "female",
  "fence",
  "festival",
  "fetch",
  "fever",
  "few",
  "fiber",
  "fiction",
  "field",
  "figure",
  "file",
  "film",
  "filter",
  "final",
  "find",
  "fine",
  "finger",
  "finish",
  "fire",
  "firm",
  "first",
  "fiscal",
  "fish",
  "fit",
  "fitness",
  "fix",
  "flag",
  "flame",
  "flash",
  "flat",
  "flavor",
  "flee",
  "flight",
  "flip",
  "float",
  "flock",
  "floor",
  "flower",
  "fluid",
  "flush",
  "fly",
  "foam",
  "focus",
  "fog",
  "foil",
  "fold",
  "follow",
  "food",
  "foot",
  "force",
  "forest",
  "forget",
  "fork",
  "fortune",
  "forum",
  "forward",
  "fossil",
  "foster",
  "found",
  "fox",
  "fragile",
  "frame",
  "frequent",
  "fresh",
  "friend",
  "fringe",
  "frog",
  "front",
  "frost",
  "frown",
  "frozen",
  "fruit",
  "fuel",
  "fun",
  "funny",
  "furnace",
  "fury",
  "future",
  "gadget",
  "gain",
  "galaxy",
  "gallery",
  "game",
  "gap",
  "garage",
  "garbage",
  "garden",
  "garlic",
  "garment",
  "gas",
  "gasp",
  "gate",
  "gather",
  "gauge",
  "gaze",
  "general",
  "genius",
  "genre",
  "gentle",
  "genuine",
  "gesture",
  "ghost",
  "giant",
  "gift",
  "giggle",
  "ginger",
  "giraffe",
  "girl",
  "give",
  "glad",
  "glance",
  "glare",
  "glass",
  "glide",
  "glimpse",
  "globe",
  "gloom",
  "glory",
  "glove",
  "glow",
  "glue",
  "goat",
  "goddess",
  "gold",
  "good",
  "goose",
  "gorilla",
  "gospel",
  "gossip",
  "govern",
  "gown",
  "grab",
  "grace",
  "grain",
  "grant",
  "grape",
  "grass",
  "gravity",
  "great",
  "green",
  "grid",
  "grief",
  "grit",
  "grocery",
  "group",
  "grow",
  "grunt",
  "guard",
  "guess",
  "guide",
  "guilt",
  "guitar",
  "gun",
  "gym",
  "habit",
  "hair",
  "half",
  "hammer",
  "hamster",
  "hand",
  "happy",
  "harbor",
  "hard",
  "harsh",
  "harvest",
  "hat",
  "have",
  "hawk",
  "hazard",
  "head",
  "health",
  "heart",
  "heavy",
  "hedgehog",
  "height",
  "hello",
  "helmet",
  "help",
  "hen",
  "hero",
  "hidden",
  "high",
  "hill",
  "hint",
  "hip",
  "hire",
  "history",
  "hobby",
  "hockey",
  "hold",
  "hole",
  "holiday",
  "hollow",
  "home",
  "honey",
  "hood",
  "hope",
  "horn",
  "horror",
  "horse",
  "hospital",
  "host",
  "hotel",
  "hour",
  "hover",
  "hub",
  "huge",
  "human",
  "humble",
  "humor",
  "hundred",
  "hungry",
  "hunt",
  "hurdle",
  "hurry",
  "hurt",
  "husband",
  "hybrid",
  "ice",
  "icon",
  "idea",
  "identify",
  "idle",
  "ignore",
  "ill",
  "illegal",
  "illness",
  "image",
  "imitate",
  "immense",
  "immune",
  "impact",
  "impose",
  "improve",
  "impulse",
  "inch",
  "include",
  "income",
  "increase",
  "index",
  "indicate",
  "indoor",
  "industry",
  "infant",
  "inflict",
  "inform",
  "inhale",
  "inherit",
  "initial",
  "inject",
  "injury",
  "inmate",
  "inner",
  "innocent",
  "input",
  "inquiry",
  "insane",
  "insect",
  "inside",
  "inspire",
  "install",
  "intact",
  "interest",
  "into",
  "invest",
  "invite",
  "involve",
  "iron",
  "island",
  "isolate",
  "issue",
  "item",
  "ivory",
  "jacket",
  "jaguar",
  "jar",
  "jazz",
  "jealous",
  "jeans",
  "jelly",
  "jewel",
  "job",
  "join",
  "joke",
  "journey",
  "joy",
  "judge",
  "juice",
  "jump",
  "jungle",
  "junior",
  "junk",
  "just",
  "kangaroo",
  "keen",
  "keep",
  "ketchup",
  "key",
  "kick",
  "kid",
  "kidney",
  "kind",
  "kingdom",
  "kiss",
  "kit",
  "kitchen",
  "kite",
  "kitten",
  "kiwi",
  "knee",
  "knife",
  "knock",
  "know",
  "lab",
  "label",
  "labor",
  "ladder",
  "lady",
  "lake",
  "lamp",
  "language",
  "laptop",
  "large",
  "later",
  "latin",
  "laugh",
  "laundry",
  "lava",
  "law",
  "lawn",
  "lawsuit",
  "layer",
  "lazy",
  "leader",
  "leaf",
  "learn",
  "leave",
  "lecture",
  "left",
  "leg",
  "legal",
  "legend",
  "leisure",
  "lemon",
  "lend",
  "length",
  "lens",
  "leopard",
  "lesson",
  "letter",
  "level",
  "liar",
  "liberty",
  "library",
  "license",
  "life",
  "lift",
  "light",
  "like",
  "limb",
  "limit",
  "link",
  "lion",
  "liquid",
  "list",
  "little",
  "live",
  "lizard",
  "load",
  "loan",
  "lobster",
  "local",
  "lock",
  "logic",
  "lonely",
  "long",
  "loop",
  "lottery",
  "loud",
  "lounge",
  "love",
  "loyal",
  "lucky",
  "luggage",
  "lumber",
  "lunar",
  "lunch",
  "luxury",
  "lyrics",
  "machine",
  "mad",
  "magic",
  "magnet",
  "maid",
  "mail",
  "main",
  "major",
  "make",
  "mammal",
  "man",
  "manage",
  "mandate",
  "mango",
  "mansion",
  "manual",
  "maple",
  "marble",
  "march",
  "margin",
  "marine",
  "market",
  "marriage",
  "mask",
  "mass",
  "master",
  "match",
  "material",
  "math",
  "matrix",
  "matter",
  "maximum",
  "maze",
  "meadow",
  "mean",
  "measure",
  "meat",
  "mechanic",
  "medal",
  "media",
  "melody",
  "melt",
  "member",
  "memory",
  "mention",
  "menu",
  "mercy",
  "merge",
  "merit",
  "merry",
  "mesh",
  "message",
  "metal",
  "method",
  "middle",
  "midnight",
  "milk",
  "million",
  "mimic",
  "mind",
  "minimum",
  "minor",
  "minute",
  "miracle",
  "mirror",
  "misery",
  "miss",
  "mistake",
  "mix",
  "mixed",
  "mixture",
  "mobile",
  "model",
  "modify",
  "mom",
  "moment",
  "monitor",
  "monkey",
  "monster",
  "month",
  "moon",
  "moral",
  "more",
  "morning",
  "mosquito",
  "mother",
  "motion",
  "motor",
  "mountain",
  "mouse",
  "move",
  "movie",
  "much",
  "muffin",
  "mule",
  "multiply",
  "muscle",
  "museum",
  "mushroom",
  "music",
  "must",
  "mutual",
  "myself",
  "mystery",
  "myth",
  "naive",
  "name",
  "napkin",
  "narrow",
  "nasty",
  "nation",
  "nature",
  "near",
  "neck",
  "need",
  "negative",
  "neglect",
  "neither",
  "nephew",
  "nerve",
  "nest",
  "net",
  "network",
  "neutral",
  "never",
  "news",
  "next",
  "nice",
  "night",
  "noble",
  "noise",
  "nominee",
  "noodle",
  "normal",
  "north",
  "nose",
  "notable",
  "note",
  "nothing",
  "notice",
  "novel",
  "now",
  "nuclear",
  "number",
  "nurse",
  "nut",
  "oak",
  "obey",
  "object",
  "oblige",
  "obscure",
  "observe",
  "obtain",
  "obvious",
  "occur",
  "ocean",
  "october",
  "odor",
  "off",
  "offer",
  "office",
  "often",
  "oil",
  "okay",
  "old",
  "olive",
  "olympic",
  "omit",
  "once",
  "one",
  "onion",
  "online",
  "only",
  "open",
  "opera",
  "opinion",
  "oppose",
  "option",
  "orange",
  "orbit",
  "orchard",
  "order",
  "ordinary",
  "organ",
  "orient",
  "original",
  "orphan",
  "ostrich",
  "other",
  "outdoor",
  "outer",
  "output",
  "outside",
  "oval",
  "oven",
  "over",
  "own",
  "owner",
  "oxygen",
  "oyster",
  "ozone",
  "pact",
  "paddle",
  "page",
  "pair",
  "palace",
  "palm",
  "panda",
  "panel",
  "panic",
  "panther",
  "paper",
  "parade",
  "parent",
  "park",
  "parrot",
  "party",
  "pass",
  "patch",
  "path",
  "patient",
  "patrol",
  "pattern",
  "pause",
  "pave",
  "payment",
  "peace",
  "peanut",
  "pear",
  "peasant",
  "pelican",
  "pen",
  "penalty",
  "pencil",
  "people",
  "pepper",
  "perfect",
  "permit",
  "person",
  "pet",
  "phone",
  "photo",
  "phrase",
  "physical",
  "piano",
  "picnic",
  "picture",
  "piece",
  "pig",
  "pigeon",
  "pill",
  "pilot",
  "pink",
  "pioneer",
  "pipe",
  "pistol",
  "pitch",
  "pizza",
  "place",
  "planet",
  "plastic",
  "plate",
  "play",
  "please",
  "pledge",
  "pluck",
  "plug",
  "plunge",
  "poem",
  "poet",
  "point",
  "polar",
  "pole",
  "police",
  "pond",
  "pony",
  "pool",
  "popular",
  "portion",
  "position",
  "possible",
  "post",
  "potato",
  "pottery",
  "poverty",
  "powder",
  "power",
  "practice",
  "praise",
  "predict",
  "prefer",
  "prepare",
  "present",
  "pretty",
  "prevent",
  "price",
  "pride",
  "primary",
  "print",
  "priority",
  "prison",
  "private",
  "prize",
  "problem",
  "process",
  "produce",
  "profit",
  "program",
  "project",
  "promote",
  "proof",
  "property",
  "prosper",
  "protect",
  "proud",
  "provide",
  "public",
  "pudding",
  "pull",
  "pulp",
  "pulse",
  "pumpkin",
  "punch",
  "pupil",
  "puppy",
  "purchase",
  "purity",
  "purpose",
  "purse",
  "push",
  "put",
  "puzzle",
  "pyramid",
  "quality",
  "quantum",
  "quarter",
  "question",
  "quick",
  "quit",
  "quiz",
  "quote",
  "rabbit",
  "raccoon",
  "race",
  "rack",
  "radar",
  "radio",
  "rail",
  "rain",
  "raise",
  "rally",
  "ramp",
  "ranch",
  "random",
  "range",
  "rapid",
  "rare",
  "rate",
  "rather",
  "raven",
  "raw",
  "razor",
  "ready",
  "real",
  "reason",
  "rebel",
  "rebuild",
  "recall",
  "receive",
  "recipe",
  "record",
  "recycle",
  "reduce",
  "reflect",
  "reform",
  "refuse",
  "region",
  "regret",
  "regular",
  "reject",
  "relax",
  "release",
  "relief",
  "rely",
  "remain",
  "remember",
  "remind",
  "remove",
  "render",
  "renew",
  "rent",
  "reopen",
  "repair",
  "repeat",
  "replace",
  "report",
  "require",
  "rescue",
  "resemble",
  "resist",
  "resource",
  "response",
  "result",
  "retire",
  "retreat",
  "return",
  "reunion",
  "reveal",
  "review",
  "reward",
  "rhythm",
  "rib",
  "ribbon",
  "rice",
  "rich",
  "ride",
  "ridge",
  "rifle",
  "right",
  "rigid",
  "ring",
  "riot",
  "ripple",
  "risk",
  "ritual",
  "rival",
  "river",
  "road",
  "roast",
  "robot",
  "robust",
  "rocket",
  "romance",
  "roof",
  "rookie",
  "room",
  "rose",
  "rotate",
  "rough",
  "round",
  "route",
  "royal",
  "rubber",
  "rude",
  "rug",
  "rule",
  "run",
  "runway",
  "rural",
  "sad",
  "saddle",
  "sadness",
  "safe",
  "sail",
  "salad",
  "salmon",
  "salon",
  "salt",
  "salute",
  "same",
  "sample",
  "sand",
  "satisfy",
  "satoshi",
  "sauce",
  "sausage",
  "save",
  "say",
  "scale",
  "scan",
  "scare",
  "scatter",
  "scene",
  "scheme",
  "school",
  "science",
  "scissors",
  "scorpion",
  "scout",
  "scrap",
  "screen",
  "script",
  "scrub",
  "sea",
  "search",
  "season",
  "seat",
  "second",
  "secret",
  "section",
  "security",
  "seed",
  "seek",
  "segment",
  "select",
  "sell",
  "seminar",
  "senior",
  "sense",
  "sentence",
  "series",
  "service",
  "session",
  "settle",
  "setup",
  "seven",
  "shadow",
  "shaft",
  "shallow",
  "share",
  "shed",
  "shell",
  "sheriff",
  "shield",
  "shift",
  "shine",
  "ship",
  "shiver",
  "shock",
  "shoe",
  "shoot",
  "shop",
  "short",
  "shoulder",
  "shove",
  "shrimp",
  "shrug",
  "shuffle",
  "shy",
  "sibling",
  "sick",
  "side",
  "siege",
  "sight",
  "sign",
  "silent",
  "silk",
  "silly",
  "silver",
  "similar",
  "simple",
  "since",
  "sing",
  "siren",
  "sister",
  "situate",
  "six",
  "size",
  "skate",
  "sketch",
  "ski",
  "skill",
  "skin",
  "skirt",
  "skull",
  "slab",
  "slam",
  "sleep",
  "slender",
  "slice",
  "slide",
  "slight",
  "slim",
  "slogan",
  "slot",
  "slow",
  "slush",
  "small",
  "smart",
  "smile",
  "smoke",
  "smooth",
  "snack",
  "snake",
  "snap",
  "sniff",
  "snow",
  "soap",
  "soccer",
  "social",
  "sock",
  "soda",
  "soft",
  "solar",
  "soldier",
  "solid",
  "solution",
  "solve",
  "someone",
  "song",
  "soon",
  "sorry",
  "sort",
  "soul",
  "sound",
  "soup",
  "source",
  "south",
  "space",
  "spare",
  "spatial",
  "spawn",
  "speak",
  "special",
  "speed",
  "spell",
  "spend",
  "sphere",
  "spice",
  "spider",
  "spike",
  "spin",
  "spirit",
  "split",
  "spoil",
  "sponsor",
  "spoon",
  "sport",
  "spot",
  "spray",
  "spread",
  "spring",
  "spy",
  "square",
  "squeeze",
  "squirrel",
  "stable",
  "stadium",
  "staff",
  "stage",
  "stairs",
  "stamp",
  "stand",
  "start",
  "state",
  "stay",
  "steak",
  "steel",
  "stem",
  "step",
  "stereo",
  "stick",
  "still",
  "sting",
  "stock",
  "stomach",
  "stone",
  "stool",
  "story",
  "stove",
  "strategy",
  "street",
  "strike",
  "strong",
  "struggle",
  "student",
  "stuff",
  "stumble",
  "style",
  "subject",
  "submit",
  "subway",
  "success",
  "such",
  "sudden",
  "suffer",
  "sugar",
  "suggest",
  "suit",
  "summer",
  "sun",
  "sunny",
  "sunset",
  "super",
  "supply",
  "supreme",
  "sure",
  "surface",
  "surge",
  "surprise",
  "surround",
  "survey",
  "suspect",
  "sustain",
  "swallow",
  "swamp",
  "swap",
  "swarm",
  "swear",
  "sweet",
  "swift",
  "swim",
  "swing",
  "switch",
  "sword",
  "symbol",
  "symptom",
  "syrup",
  "system",
  "table",
  "tackle",
  "tag",
  "tail",
  "talent",
  "talk",
  "tank",
  "tape",
  "target",
  "task",
  "taste",
  "tattoo",
  "taxi",
  "teach",
  "team",
  "tell",
  "ten",
  "tenant",
  "tennis",
  "tent",
  "term",
  "test",
  "text",
  "thank",
  "that",
  "theme",
  "then",
  "theory",
  "there",
  "they",
  "thing",
  "this",
  "thought",
  "three",
  "thrive",
  "throw",
  "thumb",
  "thunder",
  "ticket",
  "tide",
  "tiger",
  "tilt",
  "timber",
  "time",
  "tiny",
  "tip",
  "tired",
  "tissue",
  "title",
  "toast",
  "tobacco",
  "today",
  "toddler",
  "toe",
  "together",
  "toilet",
  "token",
  "tomato",
  "tomorrow",
  "tone",
  "tongue",
  "tonight",
  "tool",
  "tooth",
  "top",
  "topic",
  "topple",
  "torch",
  "tornado",
  "tortoise",
  "toss",
  "total",
  "tourist",
  "toward",
  "tower",
  "town",
  "toy",
  "track",
  "trade",
  "traffic",
  "tragic",
  "train",
  "transfer",
  "trap",
  "trash",
  "travel",
  "tray",
  "treat",
  "tree",
  "trend",
  "trial",
  "tribe",
  "trick",
  "trigger",
  "trim",
  "trip",
  "trophy",
  "trouble",
  "truck",
  "true",
  "truly",
  "trumpet",
  "trust",
  "truth",
  "try",
  "tube",
  "tuition",
  "tumble",
  "tuna",
  "tunnel",
  "turkey",
  "turn",
  "turtle",
  "twelve",
  "twenty",
  "twice",
  "twin",
  "twist",
  "two",
  "type",
  "typical",
  "ugly",
  "umbrella",
  "unable",
  "unaware",
  "uncle",
  "uncover",
  "under",
  "undo",
  "unfair",
  "unfold",
  "unhappy",
  "uniform",
  "unique",
  "unit",
  "universe",
  "unknown",
  "unlock",
  "until",
  "unusual",
  "unveil",
  "update",
  "upgrade",
  "uphold",
  "upon",
  "upper",
  "upset",
  "urban",
  "urge",
  "usage",
  "use",
  "used",
  "useful",
  "useless",
  "usual",
  "utility",
  "vacant",
  "vacuum",
  "vague",
  "valid",
  "valley",
  "valve",
  "van",
  "vanish",
  "vapor",
  "various",
  "vast",
  "vault",
  "vehicle",
  "velvet",
  "vendor",
  "venture",
  "venue",
  "verb",
  "verify",
  "version",
  "very",
  "vessel",
  "veteran",
  "viable",
  "vibrant",
  "vicious",
  "victory",
  "video",
  "view",
  "village",
  "vintage",
  "violin",
  "virtual",
  "virus",
  "visa",
  "visit",
  "visual",
  "vital",
  "vivid",
  "vocal",
  "voice",
  "void",
  "volcano",
  "volume",
  "vote",
  "voyage",
  "wage",
  "wagon",
  "wait",
  "walk",
  "wall",
  "walnut",
  "want",
  "warfare",
  "warm",
  "warrior",
  "wash",
  "wasp",
  "waste",
  "water",
  "wave",
  "way",
  "wealth",
  "weapon",
  "wear",
  "weasel",
  "weather",
  "web",
  "wedding",
  "weekend",
  "weird",
  "welcome",
  "west",
  "wet",
  "whale",
  "what",
  "wheat",
  "wheel",
  "when",
  "where",
  "whip",
  "whisper",
  "wide",
  "width",
  "wife",
  "wild",
  "will",
  "win",
  "window",
  "wine",
  "wing",
  "wink",
  "winner",
  "winter",
  "wire",
  "wisdom",
  "wise",
  "wish",
  "witness",
  "wolf",
  "woman",
  "wonder",
  "wood",
  "wool",
  "word",
  "work",
  "world",
  "worry",
  "worth",
  "wrap",
  "wreck",
  "wrestle",
  "wrist",
  "write",
  "wrong",
  "yard",
  "year",
  "yellow",
  "you",
  "young",
  "youth",
  "zebra",
  "zero",
  "zone",
  "zoo"
];

// ../decent-protocol/dist/identity/HDKeyDerivation.js
var HDPurpose;
(function(HDPurpose2) {
  HDPurpose2[HDPurpose2["Identity"] = 0] = "Identity";
  HDPurpose2[HDPurpose2["Workspace"] = 1] = "Workspace";
  HDPurpose2[HDPurpose2["Contact"] = 2] = "Contact";
  HDPurpose2[HDPurpose2["Device"] = 3] = "Device";
})(HDPurpose || (HDPurpose = {}));

class HDKeyDerivation {
  async deriveMasterKey(seed) {
    const cleanSeed = new Uint8Array(seed).buffer;
    const keyMaterial = await crypto.subtle.importKey("raw", cleanSeed, "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: new TextEncoder().encode("decent-hd-master-v1"),
      iterations: 1e5,
      hash: "SHA-512"
    }, keyMaterial, 512);
  }
  async deriveIdentityKey(masterKey, index = 0) {
    this.validateIndex(index);
    const path = `m/0'/identity/${index}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Identity, index, path);
  }
  async deriveWorkspaceKey(masterKey, workspaceIndex) {
    this.validateIndex(workspaceIndex);
    const path = `m/1'/workspace/${workspaceIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Workspace, workspaceIndex, path);
  }
  async deriveContactKey(masterKey, contactIndex) {
    this.validateIndex(contactIndex);
    const path = `m/2'/contact/${contactIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Contact, contactIndex, path);
  }
  async deriveDeviceKey(masterKey, deviceIndex) {
    this.validateIndex(deviceIndex);
    const path = `m/3'/device/${deviceIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Device, deviceIndex, path);
  }
  async deriveKeyPairAtPath(masterKey, purpose, index, path) {
    const intermediateKey = await this.deriveIntermediate(masterKey, purpose);
    const ecdhRaw = new Uint8Array(await this.hkdfDerive(intermediateKey, `decent-hd-ecdh/${index}`, 32));
    const ecdsaRaw = new Uint8Array(await this.hkdfDerive(intermediateKey, `decent-hd-ecdsa/${index}`, 32));
    this.clampScalar(ecdhRaw);
    this.clampScalar(ecdsaRaw);
    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, "ECDH");
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, "ECDSA");
    return { ecdhKeyPair, ecdsaKeyPair, path };
  }
  async deriveIntermediate(masterKey, purpose) {
    const cleanKey = new Uint8Array(new Uint8Array(masterKey)).buffer;
    const hmacKey = await crypto.subtle.importKey("raw", cleanKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const data = new TextEncoder().encode(`decent-hd-purpose/${purpose}`);
    return crypto.subtle.sign("HMAC", hmacKey, data);
  }
  async hkdfDerive(ikm, info, length) {
    const cleanIkm = new Uint8Array(new Uint8Array(ikm)).buffer;
    const key = await crypto.subtle.importKey("raw", cleanIkm, "HKDF", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info)
    }, key, length * 8);
  }
  clampScalar(scalar) {
    scalar[0] &= 127;
    if (scalar.every((b) => b === 0))
      scalar[31] = 1;
  }
  async importP256PrivateKey(privateKeyBytes, algorithm) {
    const d = new Uint8Array(privateKeyBytes);
    const uncompressedPub = p256.getPublicKey(d, false);
    const x = uncompressedPub.slice(1, 33);
    const y = uncompressedPub.slice(33, 65);
    const privateJwk = {
      kty: "EC",
      crv: "P-256",
      x: this.bytesToBase64Url(x),
      y: this.bytesToBase64Url(y),
      d: this.bytesToBase64Url(d),
      ext: true
    };
    const usages = algorithm === "ECDH" ? ["deriveKey", "deriveBits"] : ["sign"];
    const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: algorithm, namedCurve: "P-256" }, true, usages);
    const publicJwk = {
      kty: "EC",
      crv: "P-256",
      x: this.bytesToBase64Url(x),
      y: this.bytesToBase64Url(y),
      ext: true
    };
    const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: algorithm, namedCurve: "P-256" }, true, algorithm === "ECDH" ? [] : ["verify"]);
    return { privateKey, publicKey };
  }
  bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0;i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  validateIndex(index) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("Derivation index must be a non-negative integer");
    }
  }
}

// ../decent-protocol/dist/identity/SeedPhrase.js
class SeedPhraseManager {
  constructor() {
    Object.defineProperty(this, "hd", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new HDKeyDerivation
    });
  }
  generate() {
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const mnemonic = this.entropyToMnemonic(entropy);
    return {
      mnemonic,
      entropy: Array.from(entropy).map((b) => b.toString(16).padStart(2, "0")).join("")
    };
  }
  validate(mnemonic) {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) {
      return { valid: false, error: `Expected 12 words, got ${words.length}` };
    }
    for (let i = 0;i < words.length; i++) {
      if (!WORDLIST.includes(words[i])) {
        return { valid: false, error: `Unknown word at position ${i + 1}: "${words[i]}"` };
      }
    }
    try {
      const entropy = this.mnemonicToEntropy(mnemonic);
      const regenerated = this.entropyToMnemonic(entropy);
      if (regenerated !== words.join(" ")) {
        return { valid: false, error: "Invalid checksum" };
      }
    } catch {
      return { valid: false, error: "Invalid checksum" };
    }
    return { valid: true };
  }
  async deriveKeys(mnemonic) {
    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }
    const masterSeed = await this.deriveMasterSeed(mnemonic);
    const ecdhRaw = new Uint8Array(await this.hkdfDerive(masterSeed, "mesh-ecdh-key-v1", 32));
    const ecdsaRaw = new Uint8Array(await this.hkdfDerive(masterSeed, "mesh-ecdsa-key-v1", 32));
    ecdhRaw[0] &= 127;
    ecdsaRaw[0] &= 127;
    if (ecdhRaw.every((b) => b === 0))
      ecdhRaw[31] = 1;
    if (ecdsaRaw.every((b) => b === 0))
      ecdsaRaw[31] = 1;
    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, "ECDH");
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, "ECDSA");
    return { ecdhKeyPair, ecdsaKeyPair, masterSeed };
  }
  async deriveWorkspaceKeys(mnemonic, workspaceIndex) {
    if (!Number.isInteger(workspaceIndex) || workspaceIndex < 0) {
      throw new Error("Workspace index must be a non-negative integer");
    }
    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }
    const masterSeed = await this.deriveMasterSeed(mnemonic);
    const ecdhContext = workspaceIndex === 0 ? "mesh-ecdh-key-v1" : `decent-ecdh-key-v1/${workspaceIndex}`;
    const ecdsaContext = workspaceIndex === 0 ? "mesh-ecdsa-key-v1" : `decent-ecdsa-key-v1/${workspaceIndex}`;
    const ecdhRaw = new Uint8Array(await this.hkdfDerive(masterSeed, ecdhContext, 32));
    const ecdsaRaw = new Uint8Array(await this.hkdfDerive(masterSeed, ecdsaContext, 32));
    ecdhRaw[0] &= 127;
    ecdsaRaw[0] &= 127;
    if (ecdhRaw.every((b) => b === 0))
      ecdhRaw[31] = 1;
    if (ecdsaRaw.every((b) => b === 0))
      ecdsaRaw[31] = 1;
    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, "ECDH");
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, "ECDSA");
    return { ecdhKeyPair, ecdsaKeyPair, masterSeed };
  }
  async deriveMultipleWorkspaceKeys(mnemonic, indices) {
    const result = new Map;
    for (const index of indices) {
      result.set(index, await this.deriveWorkspaceKeys(mnemonic, index));
    }
    return result;
  }
  async verifyPhrase(mnemonic, expectedIdentityId) {
    try {
      const keys = await this.deriveKeys(mnemonic);
      const pubKeyBytes = await crypto.subtle.exportKey("spki", keys.ecdhKeyPair.publicKey);
      const base64 = this.arrayBufferToBase64(pubKeyBytes);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64));
      const id = Array.from(new Uint8Array(hash).slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return id === expectedIdentityId;
    } catch {
      return false;
    }
  }
  async derivePeerId(seedPhrase) {
    const { peerId } = await this.deriveAll(seedPhrase);
    return peerId;
  }
  async deriveAll(seedPhrase) {
    const keys = await this.deriveKeys(seedPhrase);
    const spki = await crypto.subtle.exportKey("spki", keys.ecdhKeyPair.publicKey);
    const hash = await crypto.subtle.digest("SHA-256", spki);
    const peerId = Array.from(new Uint8Array(hash).slice(0, 9)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { peerId, keys };
  }
  async deriveHDMasterKey(mnemonic) {
    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }
    const seed = this.mnemonicToEntropy(mnemonic);
    return this.hd.deriveMasterKey(seed);
  }
  async deriveHDIdentityKey(mnemonic, index = 0) {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveIdentityKey(masterKey, index);
  }
  async deriveHDWorkspaceKey(mnemonic, workspaceIndex) {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveWorkspaceKey(masterKey, workspaceIndex);
  }
  async deriveHDContactKey(mnemonic, contactIndex) {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveContactKey(masterKey, contactIndex);
  }
  async deriveHDDeviceKey(mnemonic, deviceIndex) {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveDeviceKey(masterKey, deviceIndex);
  }
  async deriveIdentityId(mnemonic) {
    const identityKeys = await this.deriveHDIdentityKey(mnemonic, 0);
    const spki = await crypto.subtle.exportKey("spki", identityKeys.ecdhKeyPair.publicKey);
    const base64 = this.arrayBufferToBase64(spki);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64));
    return Array.from(new Uint8Array(hash).slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async deriveDevicePeerId(mnemonic, deviceIndex) {
    if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
      throw new Error("Device index must be a non-negative integer");
    }
    const deviceKeys = await this.deriveHDDeviceKey(mnemonic, deviceIndex);
    const spki = await crypto.subtle.exportKey("spki", deviceKeys.ecdhKeyPair.publicKey);
    const hash = await crypto.subtle.digest("SHA-256", spki);
    return Array.from(new Uint8Array(hash).slice(0, 9)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async deriveDeviceKeys(mnemonic, deviceIndex) {
    if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
      throw new Error("Device index must be a non-negative integer");
    }
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    const identityKeys = await this.hd.deriveIdentityKey(masterKey, 0);
    const deviceKeys = await this.hd.deriveDeviceKey(masterKey, deviceIndex);
    const identitySpki = await crypto.subtle.exportKey("spki", identityKeys.ecdhKeyPair.publicKey);
    const identityBase64 = this.arrayBufferToBase64(identitySpki);
    const identityHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identityBase64));
    const identityId = Array.from(new Uint8Array(identityHash).slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const deviceSpki = await crypto.subtle.exportKey("spki", deviceKeys.ecdhKeyPair.publicKey);
    const deviceHash = await crypto.subtle.digest("SHA-256", deviceSpki);
    const peerId = Array.from(new Uint8Array(deviceHash).slice(0, 9)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { peerId, identityId, deviceKeys, identityKeys };
  }
  entropyToMnemonic(entropy) {
    const hash = this.checksumSync(entropy);
    const checksumBits = hash[0] >> 4;
    let bits = "";
    for (const byte of entropy) {
      bits += byte.toString(2).padStart(8, "0");
    }
    bits += checksumBits.toString(2).padStart(4, "0");
    const words = [];
    for (let i = 0;i < 132; i += 11) {
      const index = parseInt(bits.slice(i, i + 11), 2);
      words.push(WORDLIST[index]);
    }
    return words.join(" ");
  }
  mnemonicToEntropy(mnemonic) {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    let bits = "";
    for (const word of words) {
      const index = WORDLIST.indexOf(word);
      if (index === -1)
        throw new Error(`Unknown word: ${word}`);
      bits += index.toString(2).padStart(11, "0");
    }
    const entropyBits = bits.slice(0, 128);
    const entropy = new Uint8Array(16);
    for (let i = 0;i < 16; i++) {
      entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
    }
    return entropy;
  }
  checksumSync(data) {
    let hash = 2166136261;
    for (let i = 0;i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, 16777619);
    }
    const result = new Uint8Array(32);
    for (let i = 0;i < 32; i++) {
      hash = Math.imul(hash, 16777619) ^ i;
      result[i] = hash & 255;
    }
    return result;
  }
  async deriveMasterSeed(mnemonic) {
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(mnemonic), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: new TextEncoder().encode("decent-protocol-seed-v1"),
      iterations: 1e5,
      hash: "SHA-256"
    }, keyMaterial, 512);
  }
  async hkdfDerive(masterSeed, info, length) {
    const cleanIkm = new Uint8Array(new Uint8Array(masterSeed)).buffer;
    const key = await crypto.subtle.importKey("raw", cleanIkm, "HKDF", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info)
    }, key, length * 8);
  }
  async importP256PrivateKey(privateKeyBytes, algorithm) {
    const d = new Uint8Array(privateKeyBytes);
    const uncompressedPub = p256.getPublicKey(d, false);
    const x = uncompressedPub.slice(1, 33);
    const y = uncompressedPub.slice(33, 65);
    const b64url = (bytes) => {
      let binary = "";
      for (let i = 0;i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const privateJwk = {
      kty: "EC",
      crv: "P-256",
      x: b64url(x),
      y: b64url(y),
      d: b64url(d),
      ext: true
    };
    const usages = algorithm === "ECDH" ? ["deriveKey", "deriveBits"] : ["sign"];
    const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: algorithm, namedCurve: "P-256" }, true, usages);
    const publicJwk = {
      kty: "EC",
      crv: "P-256",
      x: b64url(x),
      y: b64url(y),
      ext: true
    };
    const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: algorithm, namedCurve: "P-256" }, true, algorithm === "ECDH" ? [] : ["verify"]);
    return { privateKey, publicKey };
  }
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0;i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
// ../decent-protocol/dist/identity/DeviceManager.js
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var _DeviceRegistry_devices;
var _a;
var _MessageDedup_seen;
var _MessageDedup_seenSet;
var _MessageDedup_maxSize;
var _b;
var ECDSA_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" };
var PROOF_MAX_AGE_MS = 5 * 60 * 1000;

class DeviceManager {
  static async createDeviceProof(identityId, deviceId, signingKey, timestamp) {
    const ts = timestamp ?? Date.now();
    const payload = `${identityId}:${deviceId}:${ts}`;
    const data = new TextEncoder().encode(payload);
    const sig = await crypto.subtle.sign(ECDSA_SIGN_PARAMS, signingKey, data);
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return { identityId, deviceId, timestamp: ts, signature };
  }
  static async verifyDeviceProof(proof, signingPublicKey) {
    const age = Date.now() - proof.timestamp;
    if (age > PROOF_MAX_AGE_MS) {
      return { valid: false, reason: `Device proof expired (${Math.round(age / 1000)}s > ${PROOF_MAX_AGE_MS / 1000}s)` };
    }
    const payload = `${proof.identityId}:${proof.deviceId}:${proof.timestamp}`;
    const data = new TextEncoder().encode(payload);
    const sigBytes = Uint8Array.from(atob(proof.signature), (c) => c.charCodeAt(0));
    try {
      const valid = await crypto.subtle.verify(ECDSA_SIGN_PARAMS, signingPublicKey, sigBytes, data);
      if (!valid) {
        return { valid: false, reason: "Invalid signature: device proof signature verification failed" };
      }
    } catch {
      return { valid: false, reason: "Invalid signature: device proof signature could not be verified" };
    }
    return { valid: true };
  }
  static async createDeviceAnnouncement(identityId, devicePeerId, deviceLabel, signingKey) {
    const proof = await DeviceManager.createDeviceProof(identityId, devicePeerId, signingKey);
    return {
      type: "device-announce",
      identityId,
      device: {
        deviceId: devicePeerId,
        peerId: devicePeerId,
        deviceLabel,
        lastSeen: Date.now()
      },
      proof
    };
  }
}
Object.defineProperty(DeviceManager, "DeviceRegistry", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: (_a = class DeviceRegistry {
    constructor() {
      _DeviceRegistry_devices.set(this, new Map);
    }
    addDevice(identityId, device) {
      const existing = __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").get(identityId) || [];
      const idx = existing.findIndex((d) => d.deviceId === device.deviceId);
      if (idx >= 0) {
        existing[idx] = device;
      } else {
        existing.push(device);
      }
      __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").set(identityId, existing);
    }
    removeDevice(identityId, deviceId) {
      const existing = __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").get(identityId) || [];
      __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").set(identityId, existing.filter((d) => d.deviceId !== deviceId));
    }
    getDevices(identityId) {
      return __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").get(identityId) || [];
    }
    getAllPeerIds(identityId) {
      return this.getDevices(identityId).map((d) => d.peerId);
    }
    getIdentityForPeerId(peerId) {
      for (const [identityId, devices] of __classPrivateFieldGet(this, _DeviceRegistry_devices, "f").entries()) {
        if (devices.some((d) => d.peerId === peerId)) {
          return identityId;
        }
      }
      return;
    }
  }, _DeviceRegistry_devices = new WeakMap, _a)
});
Object.defineProperty(DeviceManager, "MessageDedup", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: (_b = class MessageDedup {
    constructor(maxSize = 1e4) {
      _MessageDedup_seen.set(this, []);
      _MessageDedup_seenSet.set(this, new Set);
      _MessageDedup_maxSize.set(this, undefined);
      __classPrivateFieldSet(this, _MessageDedup_maxSize, maxSize, "f");
    }
    isDuplicate(messageId) {
      return __classPrivateFieldGet(this, _MessageDedup_seenSet, "f").has(messageId);
    }
    markSeen(messageId) {
      if (__classPrivateFieldGet(this, _MessageDedup_seenSet, "f").has(messageId))
        return;
      __classPrivateFieldGet(this, _MessageDedup_seen, "f").push(messageId);
      __classPrivateFieldGet(this, _MessageDedup_seenSet, "f").add(messageId);
      while (__classPrivateFieldGet(this, _MessageDedup_seen, "f").length > __classPrivateFieldGet(this, _MessageDedup_maxSize, "f")) {
        const evicted = __classPrivateFieldGet(this, _MessageDedup_seen, "f").shift();
        __classPrivateFieldGet(this, _MessageDedup_seenSet, "f").delete(evicted);
      }
    }
  }, _MessageDedup_seen = new WeakMap, _MessageDedup_seenSet = new WeakMap, _MessageDedup_maxSize = new WeakMap, _b)
});
// ../decent-protocol/dist/media/Attachment.js
var CHUNK_SIZE = 64 * 1024;
var MAX_THUMBNAIL_SIZE = 5 * 1024;
// ../decent-protocol/dist/media/MediaStore.js
var DEFAULT_CONFIG = {
  maxTotalBytes: 1024 * 1024 * 1024,
  maxPerWorkspaceBytes: 500 * 1024 * 1024,
  autoPruneAgeMs: 30 * 24 * 60 * 60 * 1000,
  autoDownload: {
    images: 5 * 1024 * 1024,
    voice: 10 * 1024 * 1024,
    audio: 0,
    video: 0,
    files: 0
  }
};
// ../decent-protocol/dist/logging/Logger.js
var LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};
var DEFAULT_CONFIG2 = {
  consoleLevel: "warn",
  categoryLevels: {},
  bufferSize: 500
};
function globalObj() {
  return globalThis;
}
function isRecord2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizeLevel(level) {
  switch (level) {
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return level;
    default:
      return;
  }
}
function readLocalStorageConfig() {
  try {
    const storage = globalObj()?.localStorage;
    if (!storage)
      return {};
    const consoleLevel = normalizeLevel(storage.getItem("decentchat.log.consoleLevel"));
    const bufferSizeRaw = storage.getItem("decentchat.log.bufferSize");
    const bufferSize = bufferSizeRaw ? Number(bufferSizeRaw) : undefined;
    let categoryLevels;
    const categoryLevelsRaw = storage.getItem("decentchat.log.categoryLevels");
    if (categoryLevelsRaw) {
      const parsed = JSON.parse(categoryLevelsRaw);
      if (isRecord2(parsed)) {
        categoryLevels = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, normalizeLevel(value)]).filter(([, value]) => !!value));
      }
    }
    return {
      consoleLevel,
      categoryLevels,
      bufferSize: Number.isFinite(bufferSize) && bufferSize > 0 ? Math.floor(bufferSize) : undefined
    };
  } catch {
    return {};
  }
}
function mergeConfig(...configs) {
  const merged = {
    consoleLevel: DEFAULT_CONFIG2.consoleLevel,
    categoryLevels: { ...DEFAULT_CONFIG2.categoryLevels },
    bufferSize: DEFAULT_CONFIG2.bufferSize
  };
  for (const config of configs) {
    if (!config)
      continue;
    if (config.consoleLevel)
      merged.consoleLevel = config.consoleLevel;
    if (config.categoryLevels)
      merged.categoryLevels = { ...merged.categoryLevels, ...config.categoryLevels };
    if (typeof config.bufferSize === "number" && Number.isFinite(config.bufferSize) && config.bufferSize > 0) {
      merged.bufferSize = Math.max(1, Math.floor(config.bufferSize));
    }
  }
  return merged;
}
function getState() {
  const g = globalObj();
  if (!g.__DECENT_LOG_STATE__) {
    const state = {
      buffer: [],
      runtimeConfig: {}
    };
    g.__DECENT_LOG_STATE__ = state;
    exposeGlobalApi(state);
  }
  return g.__DECENT_LOG_STATE__;
}
function exposeGlobalApi(state) {
  const g = globalObj();
  if (!Object.getOwnPropertyDescriptor(g, "__DECENT_LOGS__")) {
    Object.defineProperty(g, "__DECENT_LOGS__", {
      configurable: true,
      enumerable: false,
      get: () => state.buffer
    });
  }
  if (typeof g.__DECENT_GET_LOG_CONFIG__ !== "function") {
    g.__DECENT_GET_LOG_CONFIG__ = () => getDecentLogConfig();
  }
  if (typeof g.__DECENT_SET_LOG_CONFIG__ !== "function") {
    g.__DECENT_SET_LOG_CONFIG__ = (patch) => setDecentLogConfig(patch);
  }
  if (typeof g.__DECENT_CLEAR_LOGS__ !== "function") {
    g.__DECENT_CLEAR_LOGS__ = () => {
      state.buffer.splice(0, state.buffer.length);
    };
  }
}
function getDecentLogConfig() {
  const state = getState();
  const g = globalObj();
  const seededConfig = isRecord2(g.__DECENT_LOG_CONFIG__) ? g.__DECENT_LOG_CONFIG__ : undefined;
  const localConfig = readLocalStorageConfig();
  const effective = mergeConfig(DEFAULT_CONFIG2, seededConfig, localConfig, state.runtimeConfig);
  const hasExplicitConsoleLevel = !!seededConfig?.consoleLevel || !!localConfig.consoleLevel || !!state.runtimeConfig.consoleLevel;
  if (!hasExplicitConsoleLevel && g.__DECENT_DEBUG === true) {
    effective.consoleLevel = "debug";
  }
  return effective;
}
function setDecentLogConfig(patch) {
  const state = getState();
  state.runtimeConfig = {
    ...state.runtimeConfig,
    ...patch,
    categoryLevels: {
      ...state.runtimeConfig.categoryLevels ?? {},
      ...patch.categoryLevels ?? {}
    }
  };
  return getDecentLogConfig();
}
function shouldEmit(level, category, config) {
  const threshold = config.categoryLevels[category] ?? config.consoleLevel;
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[threshold];
}
function consoleMethod(level) {
  switch (level) {
    case "error":
      return console.error.bind(console);
    case "warn":
      return console.warn.bind(console);
    case "info":
      return console.info.bind(console);
    case "trace":
      return console.trace.bind(console);
    case "debug":
    default:
      return console.debug.bind(console);
  }
}
function formatPrefix(category, scope) {
  return scope ? `[DecentChat][${category}][${scope}]` : `[DecentChat][${category}]`;
}
function writeEntry(entry) {
  const state = getState();
  const config = getDecentLogConfig();
  state.buffer.push(entry);
  if (state.buffer.length > config.bufferSize) {
    state.buffer.splice(0, state.buffer.length - config.bufferSize);
  }
  if (!shouldEmit(entry.level, entry.category, config))
    return;
  consoleMethod(entry.level)(formatPrefix(entry.category, entry.scope), entry.message, ...entry.args);
}
function createLogger(scope, category = "app") {
  const log = (level, message, ...args) => {
    writeEntry({
      ts: Date.now(),
      level,
      category,
      scope,
      message,
      args
    });
  };
  return {
    trace: (message, ...args) => log("trace", message, ...args),
    debug: (message, ...args) => log("debug", message, ...args),
    info: (message, ...args) => log("info", message, ...args),
    warn: (message, ...args) => log("warn", message, ...args),
    error: (message, ...args) => log("error", message, ...args),
    child: (childScope, childCategory = category) => createLogger(`${scope}:${childScope}`, childCategory)
  };
}
// ../decent-protocol/dist/invite/InviteURI.js
var DEFAULT_PUBLIC_SERVERS = [
  "wss://0.peerjs.com/peerjs"
];

class InviteURI {
  static encode(data, webDomain = "decentchat.app") {
    const { host, port, inviteCode, secure, peerId, publicKey, transportPublicKey, inviterAlias, inviterIsBot, inviterAllowWorkspaceDMs, workspaceName, workspaceId, path, expiresAt, maxUses, inviteId, inviterId, signature } = data;
    const params = new URLSearchParams;
    params.set("signal", `${host}:${port}`);
    if (peerId)
      params.set("peer", peerId);
    if (publicKey)
      params.set("pk", publicKey);
    if (transportPublicKey)
      params.set("tpk", transportPublicKey);
    if (inviterAlias)
      params.set("alias", inviterAlias);
    if (inviterIsBot)
      params.set("bot", "1");
    if (inviterAllowWorkspaceDMs === false)
      params.set("wdm", "0");
    if (workspaceName)
      params.set("name", workspaceName);
    if (workspaceId)
      params.set("ws", workspaceId);
    if (secure)
      params.set("secure", "1");
    if (path && path !== "/peerjs")
      params.set("path", path);
    if (typeof expiresAt === "number" && expiresAt > 0)
      params.set("exp", String(expiresAt));
    if (typeof maxUses === "number" && maxUses > 0)
      params.set("max", String(maxUses));
    if (inviteId)
      params.set("i", inviteId);
    if (inviterId)
      params.set("inviter", inviterId);
    if (signature)
      params.set("sig", signature);
    if (data.fallbackServers && data.fallbackServers.length > 0) {
      for (const server of data.fallbackServers) {
        params.append("fallback", server);
      }
    }
    if (data.turnServers && data.turnServers.length > 0) {
      for (const server of data.turnServers) {
        params.append("turn", server);
      }
    }
    if (data.peers && data.peers.length > 0) {
      for (const p of data.peers) {
        if (p !== peerId)
          params.append("peer", p);
      }
    }
    return `https://${webDomain}/join/${inviteCode}?${params.toString()}`;
  }
  static encodeNative(data) {
    const { host, port, inviteCode, secure } = data;
    const hostStr = host.includes(":") ? `[${host}]` : host;
    const uri = `decent://${hostStr}:${port}/${inviteCode}`;
    const params = new URLSearchParams;
    if (data.fallbackServers && data.fallbackServers.length > 0) {
      for (const server of data.fallbackServers) {
        params.append("fallback", server);
      }
    }
    if (data.turnServers && data.turnServers.length > 0) {
      for (const server of data.turnServers) {
        params.append("turn", server);
      }
    }
    if (data.peerId)
      params.set("peer", data.peerId);
    if (data.publicKey)
      params.set("pk", data.publicKey);
    if (data.transportPublicKey)
      params.set("tpk", data.transportPublicKey);
    if (data.inviterAlias)
      params.set("alias", data.inviterAlias);
    if (data.inviterIsBot)
      params.set("bot", "1");
    if (data.inviterAllowWorkspaceDMs === false)
      params.set("wdm", "0");
    if (data.workspaceName)
      params.set("name", data.workspaceName);
    if (data.workspaceId)
      params.set("ws", data.workspaceId);
    if (secure)
      params.set("secure", "1");
    if (data.path && data.path !== "/peerjs")
      params.set("path", data.path);
    if (typeof data.expiresAt === "number" && data.expiresAt > 0)
      params.set("exp", String(data.expiresAt));
    if (typeof data.maxUses === "number" && data.maxUses > 0)
      params.set("max", String(data.maxUses));
    if (data.inviteId)
      params.set("i", data.inviteId);
    if (data.inviterId)
      params.set("inviter", data.inviterId);
    if (data.signature)
      params.set("sig", data.signature);
    if (data.peers && data.peers.length > 0) {
      for (const p of data.peers) {
        if (p !== data.peerId)
          params.append("peer", p);
      }
    }
    const queryStr = params.toString();
    return queryStr ? `${uri}?${queryStr}` : uri;
  }
  static decode(uri) {
    let normalizedUri = uri.trim();
    if (normalizedUri.startsWith("https://") || normalizedUri.startsWith("http://")) {
      return this.decodeWebURL(normalizedUri);
    }
    if (!normalizedUri.startsWith("decent://")) {
      throw new Error(`Invalid invite URI: must start with decent:// — got: ${normalizedUri.slice(0, 20)}`);
    }
    const withoutScheme = normalizedUri.slice("decent://".length);
    const queryIdx = withoutScheme.indexOf("?");
    const pathPart = queryIdx >= 0 ? withoutScheme.slice(0, queryIdx) : withoutScheme;
    const queryStr = queryIdx >= 0 ? withoutScheme.slice(queryIdx + 1) : "";
    const { host, port, path: codePath } = this.parseHostPort(pathPart);
    const inviteCode = codePath.replace(/^\//, "");
    if (!inviteCode) {
      throw new Error("Invalid invite URI: missing invite code");
    }
    const params = new URLSearchParams(queryStr);
    const fallbackServers = params.getAll("fallback");
    const turnServers = params.getAll("turn");
    const secure = params.get("secure") === "1" || port === 443;
    const peerPath = params.get("path") || "/peerjs";
    const expRaw = params.get("exp");
    const maxRaw = params.get("max");
    const expiresAt = expRaw ? Number(expRaw) : undefined;
    const maxUses = maxRaw ? Number(maxRaw) : undefined;
    const inviteId = params.get("i") || undefined;
    const inviterId = params.get("inviter") || undefined;
    const signature = params.get("sig") || undefined;
    const allPeers = params.getAll("peer");
    const primaryPeer = allPeers[0] || undefined;
    const additionalPeers = allPeers.length > 1 ? allPeers.slice(1) : undefined;
    return {
      host,
      port,
      inviteCode,
      secure,
      path: peerPath,
      fallbackServers,
      turnServers,
      peerId: primaryPeer,
      peers: additionalPeers,
      publicKey: params.get("pk") || undefined,
      transportPublicKey: params.get("tpk") || undefined,
      inviterAlias: params.get("alias") || undefined,
      inviterIsBot: params.get("bot") === "1" ? true : undefined,
      inviterAllowWorkspaceDMs: params.get("wdm") === "0" ? false : undefined,
      workspaceName: params.get("name") || undefined,
      workspaceId: params.get("ws") || undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      maxUses: Number.isFinite(maxUses) ? maxUses : undefined,
      inviteId,
      inviterId,
      signature
    };
  }
  static decodeWebURL(url) {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const joinIdx = pathParts.indexOf("join");
    if (joinIdx < 0 || joinIdx + 1 >= pathParts.length) {
      throw new Error("Invalid web invite URL: expected /join/CODE path");
    }
    const inviteCode = pathParts[joinIdx + 1];
    const signalParam = parsed.searchParams.get("signal") || "";
    let host = parsed.hostname;
    let port = 443;
    let secure = true;
    if (signalParam) {
      const { host: sHost, port: sPort } = this.parseHostPort(signalParam);
      host = sHost;
      port = sPort;
      secure = parsed.searchParams.get("secure") === "1" || sPort === 443;
    }
    const allPeers = parsed.searchParams.getAll("peer");
    const primaryPeer = allPeers[0] || undefined;
    const additionalPeers = allPeers.length > 1 ? allPeers.slice(1) : undefined;
    const expRaw = parsed.searchParams.get("exp");
    const maxRaw = parsed.searchParams.get("max");
    const expiresAt = expRaw ? Number(expRaw) : undefined;
    const maxUses = maxRaw ? Number(maxRaw) : undefined;
    const inviteId = parsed.searchParams.get("i") || undefined;
    return {
      host,
      port,
      inviteCode,
      secure,
      path: parsed.searchParams.get("path") || "/peerjs",
      fallbackServers: parsed.searchParams.getAll("fallback"),
      turnServers: parsed.searchParams.getAll("turn"),
      peerId: primaryPeer,
      peers: additionalPeers,
      publicKey: parsed.searchParams.get("pk") || undefined,
      transportPublicKey: parsed.searchParams.get("tpk") || undefined,
      inviterAlias: parsed.searchParams.get("alias") || undefined,
      inviterIsBot: parsed.searchParams.get("bot") === "1" ? true : undefined,
      inviterAllowWorkspaceDMs: parsed.searchParams.get("wdm") === "0" ? false : undefined,
      workspaceName: parsed.searchParams.get("name") || undefined,
      workspaceId: parsed.searchParams.get("ws") || undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      maxUses: Number.isFinite(maxUses) ? maxUses : undefined,
      inviteId,
      inviterId: parsed.searchParams.get("inviter") || undefined,
      signature: parsed.searchParams.get("sig") || undefined
    };
  }
  static parseHostPort(str) {
    let host;
    let rest;
    if (str.startsWith("[")) {
      const closeBracket = str.indexOf("]");
      if (closeBracket < 0)
        throw new Error("Invalid IPv6 address: missing ]");
      host = str.slice(1, closeBracket);
      rest = str.slice(closeBracket + 1);
    } else {
      const slashIdx = str.indexOf("/");
      const hostPortPart = slashIdx >= 0 ? str.slice(0, slashIdx) : str;
      const pathPart = slashIdx >= 0 ? str.slice(slashIdx) : "";
      const lastColon = hostPortPart.lastIndexOf(":");
      if (lastColon >= 0) {
        host = hostPortPart.slice(0, lastColon);
        const portAndPath = hostPortPart.slice(lastColon);
        rest = portAndPath + pathPart;
      } else {
        host = hostPortPart;
        rest = pathPart;
      }
    }
    let port = 9000;
    let path = "";
    if (rest.startsWith(":")) {
      rest = rest.slice(1);
      const slashIdx = rest.indexOf("/");
      if (slashIdx >= 0) {
        port = parseInt(rest.slice(0, slashIdx), 10);
        path = rest.slice(slashIdx);
      } else {
        port = parseInt(rest, 10);
      }
    } else if (rest.startsWith("/")) {
      path = rest;
    }
    if (isNaN(port))
      port = 9000;
    return { host, port, path };
  }
  static getSignPayload(data) {
    const base = `${data.inviteCode}:${data.workspaceId || ""}:${data.expiresAt || 0}:${data.maxUses || 0}`;
    return data.inviteId ? `${base}:${data.inviteId}` : base;
  }
  static isExpired(data, now = Date.now()) {
    if (!data.expiresAt)
      return false;
    return now > data.expiresAt;
  }
  static create(opts) {
    return this.encode({
      host: opts.host,
      port: opts.port,
      inviteCode: opts.inviteCode,
      secure: opts.secure ?? opts.port === 443,
      path: "/peerjs",
      fallbackServers: DEFAULT_PUBLIC_SERVERS,
      turnServers: [],
      peerId: opts.peerId,
      publicKey: opts.publicKey,
      transportPublicKey: opts.transportPublicKey,
      inviterAlias: opts.inviterAlias,
      inviterIsBot: opts.inviterIsBot,
      inviterAllowWorkspaceDMs: opts.inviterAllowWorkspaceDMs,
      workspaceName: opts.workspaceName,
      workspaceId: opts.workspaceId
    });
  }
  static isValid(uri) {
    try {
      this.decode(uri);
      return true;
    } catch {
      return false;
    }
  }
  static toShareText(data) {
    const name = data.workspaceName || "a workspace";
    const uri = this.encode(data);
    return `Join ${name} on DecentChat:
${uri}`;
  }
}
// ../decent-protocol/dist/security/RateLimiter.js
var DEFAULT_LIMITS = {
  message: { max: 30, refillRate: 10 },
  bytes: { max: 5242880, refillRate: 102400 },
  connection: { max: 5, refillRate: 1 / 60 },
  sync: { max: 120, refillRate: 20 },
  media: { max: 100, refillRate: 20 },
  handshake: { max: 3, refillRate: 1 / 10 }
};
// ../decent-protocol/dist/security/MessageGuard.js
var DEFAULT_SIZE_LIMITS = {
  maxTextBytes: 64 * 1024,
  maxAttachmentMetaBytes: 4 * 1024,
  maxMediaBytes: 50 * 1024 * 1024,
  maxSyncPayloadBytes: 10 * 1024 * 1024,
  maxAttachmentsPerMessage: 10,
  maxMessageFields: 50
};
// ../decent-protocol/dist/security/PeerAuth.js
var ECDSA_SIGN_PARAMS2 = { name: "ECDSA", hash: "SHA-256" };

class PeerAuth {
  static createChallenge() {
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    return { nonce, timestamp: Date.now() };
  }
  static isChallengeExpired(challenge, maxAgeMs = 30000) {
    return Date.now() - challenge.timestamp > maxAgeMs;
  }
  static async respondToChallenge(nonce, challengerPeerId, signingKey) {
    const payload = buildPayload(nonce, challengerPeerId);
    const signatureBuffer = await crypto.subtle.sign(ECDSA_SIGN_PARAMS2, signingKey, payload);
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    return { signature };
  }
  static async verifyResponse(nonce, ourPeerId, signature, peerSigningKey) {
    try {
      const payload = buildPayload(nonce, ourPeerId);
      const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      return await crypto.subtle.verify(ECDSA_SIGN_PARAMS2, peerSigningKey, sigBytes, payload);
    } catch {
      return false;
    }
  }
}
function buildPayload(nonce, peerId) {
  return new TextEncoder().encode(nonce + peerId);
}
// ../decent-protocol/dist/crypto/DoubleRatchet.js
var MAX_SKIP = 100;
var ROOT_KDF_INFO = "decent-root-kdf-v1";

class DoubleRatchet {
  static async initAlice(sharedSecret, peerDHPublicKey, preGeneratedDHKeyPair) {
    const dhKeyPair = preGeneratedDHKeyPair ?? await generateDHKeyPair();
    const { rootKey, chainKey } = await rootKDF(sharedSecret, await deriveSharedSecret(dhKeyPair.privateKey, peerDHPublicKey));
    return {
      dhKeyPair,
      peerDHPublicKey,
      rootKey,
      sendChainKey: chainKey,
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      previousSendCount: 0,
      skippedKeys: new Map
    };
  }
  static async initBob(sharedSecret, dhKeyPair) {
    return {
      dhKeyPair,
      peerDHPublicKey: null,
      rootKey: sharedSecret,
      sendChainKey: null,
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      previousSendCount: 0,
      skippedKeys: new Map
    };
  }
  static async encrypt(state, plaintext) {
    const { messageKey, nextChainKey } = await chainKDF(state.sendChainKey);
    state.sendChainKey = nextChainKey;
    const header = {
      dhPublicKey: await exportDHPublicKey(state.dhKeyPair.publicKey),
      previousCount: state.previousSendCount,
      messageNumber: state.sendCount
    };
    state.sendCount++;
    const { ciphertext, iv } = await aesEncrypt(messageKey, plaintext);
    return { header, ciphertext, iv };
  }
  static async decrypt(state, message) {
    const skippedKey = await trySkippedKeys(state, message);
    if (skippedKey !== null)
      return skippedKey;
    const peerDHPublicKey = await importDHPublicKey(message.header.dhPublicKey);
    const currentPeerKeyStr = state.peerDHPublicKey ? await exportDHPublicKey(state.peerDHPublicKey) : null;
    if (message.header.dhPublicKey !== currentPeerKeyStr) {
      if (state.recvChainKey !== null) {
        await skipMessageKeys(state, message.header.previousCount);
      }
      await dhRatchetStep(state, peerDHPublicKey);
    }
    await skipMessageKeys(state, message.header.messageNumber);
    const { messageKey, nextChainKey } = await chainKDF(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    state.recvCount++;
    return aesDecrypt(messageKey, message.ciphertext, message.iv);
  }
}
async function dhRatchetStep(state, peerDHPublicKey) {
  state.peerDHPublicKey = peerDHPublicKey;
  state.previousSendCount = state.sendCount;
  state.sendCount = 0;
  state.recvCount = 0;
  const dhOutput1 = await deriveSharedSecret(state.dhKeyPair.privateKey, peerDHPublicKey);
  const recv = await rootKDF(state.rootKey, dhOutput1);
  state.rootKey = recv.rootKey;
  state.recvChainKey = recv.chainKey;
  state.dhKeyPair = await generateDHKeyPair();
  const dhOutput2 = await deriveSharedSecret(state.dhKeyPair.privateKey, peerDHPublicKey);
  const send = await rootKDF(state.rootKey, dhOutput2);
  state.rootKey = send.rootKey;
  state.sendChainKey = send.chainKey;
}
async function skipMessageKeys(state, until) {
  if (state.recvCount + MAX_SKIP < until) {
    throw new Error("Too many skipped messages");
  }
  while (state.recvCount < until) {
    const { messageKey, nextChainKey } = await chainKDF(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    const peerKeyStr = state.peerDHPublicKey ? await exportDHPublicKey(state.peerDHPublicKey) : "init";
    state.skippedKeys.set(`${peerKeyStr}:${state.recvCount}`, messageKey);
    state.recvCount++;
    if (state.skippedKeys.size > MAX_SKIP * 2) {
      const keys = Array.from(state.skippedKeys.keys());
      for (let i = 0;i < keys.length - MAX_SKIP; i++) {
        state.skippedKeys.delete(keys[i]);
      }
    }
  }
}
async function trySkippedKeys(state, message) {
  const key = `${message.header.dhPublicKey}:${message.header.messageNumber}`;
  const messageKey = state.skippedKeys.get(key);
  if (!messageKey)
    return null;
  state.skippedKeys.delete(key);
  return aesDecrypt(messageKey, message.ciphertext, message.iv);
}
async function generateDHKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}
async function deriveSharedSecret(privateKey, publicKey) {
  return crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
}
async function exportDHPublicKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}
async function importDHPublicKey(base64) {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}
async function rootKDF(rootKey, dhOutput) {
  const ikm = await crypto.subtle.importKey("raw", dhOutput, "HKDF", false, ["deriveBits"]);
  const salt = new Uint8Array(rootKey);
  const info = new TextEncoder().encode(ROOT_KDF_INFO);
  const derived = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, ikm, 512);
  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64)
  };
}
async function chainKDF(chainKey) {
  const hmacKey = await crypto.subtle.importKey("raw", chainKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const messageKey = await crypto.subtle.sign("HMAC", hmacKey, new Uint8Array([1]));
  const nextChainKey = await crypto.subtle.sign("HMAC", hmacKey, new Uint8Array([2]));
  return { messageKey, nextChainKey };
}
async function aesEncrypt(keyData, plaintext) {
  const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv.buffer)
  };
}
async function aesDecrypt(keyData, ciphertext, iv) {
  const key = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToArrayBuffer(iv) }, key, base64ToArrayBuffer(ciphertext));
  return new TextDecoder().decode(decrypted);
}
async function serializeRatchetState(state) {
  const pubRaw = await crypto.subtle.exportKey("raw", state.dhKeyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", state.dhKeyPair.privateKey);
  let peerPubB64 = null;
  if (state.peerDHPublicKey) {
    const peerRaw = await crypto.subtle.exportKey("raw", state.peerDHPublicKey);
    peerPubB64 = arrayBufferToBase64(peerRaw);
  }
  const skipped = [];
  for (const [k, v] of state.skippedKeys) {
    skipped.push([k, arrayBufferToBase64(v)]);
  }
  return {
    dhKeyPair: {
      publicKey: arrayBufferToBase64(pubRaw),
      privateKey: JSON.stringify(privJwk)
    },
    peerDHPublicKey: peerPubB64,
    rootKey: arrayBufferToBase64(state.rootKey),
    sendChainKey: state.sendChainKey ? arrayBufferToBase64(state.sendChainKey) : null,
    recvChainKey: state.recvChainKey ? arrayBufferToBase64(state.recvChainKey) : null,
    sendCount: state.sendCount,
    recvCount: state.recvCount,
    previousSendCount: state.previousSendCount,
    skippedKeys: skipped
  };
}
async function deserializeRatchetState(data) {
  const publicKey = await crypto.subtle.importKey("raw", base64ToArrayBuffer(data.dhKeyPair.publicKey), { name: "ECDH", namedCurve: "P-256" }, true, []);
  const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(data.dhKeyPair.privateKey), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  let peerDHPublicKey = null;
  if (data.peerDHPublicKey) {
    peerDHPublicKey = await importDHPublicKey(data.peerDHPublicKey);
  }
  const skippedKeys = new Map;
  for (const [k, v] of data.skippedKeys) {
    skippedKeys.set(k, base64ToArrayBuffer(v));
  }
  return {
    dhKeyPair: { publicKey, privateKey },
    peerDHPublicKey,
    rootKey: base64ToArrayBuffer(data.rootKey),
    sendChainKey: data.sendChainKey ? base64ToArrayBuffer(data.sendChainKey) : null,
    recvChainKey: data.recvChainKey ? base64ToArrayBuffer(data.recvChainKey) : null,
    sendCount: data.sendCount,
    recvCount: data.recvCount,
    previousSendCount: data.previousSendCount,
    skippedKeys
  };
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0;i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0;i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
// ../decent-transport-webrtc/dist/PeerTransport.js
var import_peerjs = __toESM(require_bundler(), 1);
var transportLog = createLogger("PeerTransport", "transport");
var DEFAULT_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];
var DEFAULT_TURN_SERVERS = [
  {
    urls: ["turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject"
  }
];
var ICE_SERVERS_WITH_TURN = [
  ...DEFAULT_ICE_SERVERS,
  ...DEFAULT_TURN_SERVERS
];
function normalizePeerJsServer(serverUrl) {
  const url = new URL(serverUrl);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : secure ? 443 : 80,
    path: url.pathname || "/",
    secure
  };
}
function resolveLocalDevSignalingPort() {
  const envPort = process.env?.VITE_SIGNAL_PORT;
  const normalized = Number(envPort ?? 9000);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 9000;
}

class PeerTransport {
  constructor(config = {}) {
    Object.defineProperty(this, "signalingInstances", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: []
    });
    Object.defineProperty(this, "connections", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "connectingTo", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Set
    });
    Object.defineProperty(this, "config", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: undefined
    });
    Object.defineProperty(this, "myPeerId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "_autoReconnectEnabled", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: true
    });
    Object.defineProperty(this, "_manuallyDisconnected", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Set
    });
    Object.defineProperty(this, "_reconnectAttempts", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_reconnectTimers", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_reconnectDelays", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: [5000, 15000, 30000, 60000, 120000]
    });
    Object.defineProperty(this, "_peerConnectFailures", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_peerConnectQuarantineUntil", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_peerConnectQuarantineLevel", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_signalingReconnectTimers", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_signalingReconnectAttempts", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_signalingProbeInterval", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "_pingTimers", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_pongTimeouts", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_pendingPing", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_missedPongs", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_lastRecoveryAt", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "_heartbeatEnabled", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: true
    });
    Object.defineProperty(this, "_networkListenersSetup", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false
    });
    Object.defineProperty(this, "_networkListenersCleanup", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "_managedTimeouts", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Set
    });
    Object.defineProperty(this, "_destroyed", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false
    });
    Object.defineProperty(this, "_peerMessageQueues", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Map
    });
    Object.defineProperty(this, "onConnect", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "onDisconnect", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "onMessage", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "onError", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(this, "onSignalingStateChange", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: null
    });
    this.config = config;
  }
  async init(peerId) {
    if (this._destroyed) {
      throw new Error("PeerTransport has been destroyed");
    }
    const servers = this._resolveSignalingServers();
    if (servers.length === 0) {
      return this._initSingleServer(peerId);
    }
    const results = await Promise.allSettled(servers.map((server) => this._initServer(server, peerId)));
    const firstSuccess = results.find((r) => r.status === "fulfilled");
    if (!firstSuccess) {
      const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message || "Unknown error");
      throw new Error(`Failed to connect to any signaling server: ${errors.join(", ")}`);
    }
    const assignedId = firstSuccess.value;
    this.myPeerId = assignedId;
    const connected = results.filter((r) => r.status === "fulfilled").length;
    const total = servers.length;
    transportLog.info(`Connected to ${connected}/${total} signaling servers as ${assignedId}`);
    this._setupNetworkListeners();
    this._startSignalingProbe();
    return assignedId;
  }
  _waitForAnySignalingReconnect(timeoutMs = 6000) {
    if (this.signalingInstances.some((i) => i.connected))
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for signaling server reconnect"));
      }, timeoutMs);
      const poll = setInterval(() => {
        if (this.signalingInstances.some((i) => i.connected)) {
          cleanup();
          resolve();
        }
      }, 250);
      function cleanup() {
        clearTimeout(deadline);
        clearInterval(poll);
      }
    });
  }
  async connect(peerId) {
    const now = Date.now();
    const quarantinedUntil = this._peerConnectQuarantineUntil.get(peerId) ?? 0;
    if (quarantinedUntil > now) {
      const remainingMs = quarantinedUntil - now;
      throw new Error(`Peer ${peerId} temporarily quarantined for ${Math.ceil(remainingMs / 1000)}s after repeated connect failures`);
    }
    this._manuallyDisconnected.delete(peerId);
    if (this.signalingInstances.length === 0) {
      throw new Error("PeerTransport not initialised — call init() first");
    }
    if (this.connections.has(peerId))
      return;
    if (this.connectingTo.has(peerId))
      return;
    this.connectingTo.add(peerId);
    const maxRetries = this.config.maxRetries ?? 1;
    const baseDelay = this.config.retryDelayMs ?? 2000;
    let lastError = null;
    try {
      if (!this.signalingInstances.some((i) => i.connected)) {
        await this._waitForAnySignalingReconnect(8000).catch(() => {
          throw new Error("Signaling server temporarily unavailable — please try again in a moment");
        });
      }
      for (const instance of this.signalingInstances) {
        if (!instance.connected)
          continue;
        for (let attempt = 0;attempt <= maxRetries; attempt++) {
          try {
            await this._attemptConnect(instance, peerId);
            this._clearPeerConnectFailure(peerId);
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            lastError = err instanceof Error ? err : new Error(msg);
            if (msg.includes("disconnecting from server") || msg.includes("disconnected from server")) {
              await this._waitForAnySignalingReconnect(6000).catch(() => null);
              const curSig = this.connections.get(peerId);
              if (curSig && curSig.status === "connected") {
                return;
              }
              this.connections.delete(peerId);
              try {
                await this._attemptConnect(instance, peerId);
                this._clearPeerConnectFailure(peerId);
                return;
              } catch {}
            }
            if (attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise((r) => setTimeout(r, delay));
              const cur = this.connections.get(peerId);
              if (cur && cur.status === "connected") {
                return;
              }
              this.connections.delete(peerId);
            }
          }
        }
      }
      this._notePeerConnectFailure(peerId, lastError);
      throw new Error(`Failed to connect to ${peerId} via any signaling server`);
    } finally {
      this.connectingTo.delete(peerId);
    }
  }
  disconnect(peerId) {
    this._manuallyDisconnected.add(peerId);
    this._cancelReconnect(peerId);
    this._stopHeartbeat(peerId);
    this._clearPeerConnectFailure(peerId);
    const active = this.connections.get(peerId);
    if (active) {
      active.conn.close();
      this.connections.delete(peerId);
      this.onDisconnect?.(peerId);
    }
  }
  send(peerId, data) {
    const active = this.connections.get(peerId);
    if (!active || active.status !== "connected")
      return false;
    const markDisconnected = () => {
      const current = this.connections.get(peerId);
      if (current?.conn !== active.conn)
        return;
      this._stopHeartbeat(peerId);
      current.status = "failed";
      this.connections.delete(peerId);
      this.onDisconnect?.(peerId);
      this._scheduleReconnect(peerId);
    };
    if (!active.conn.open) {
      markDisconnected();
      return false;
    }
    try {
      active.conn.send(data);
      return true;
    } catch (err) {
      markDisconnected();
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (!message.includes("Connection is not open") && !message.includes("listen for the `open` event before sending")) {
        this.onError?.(err instanceof Error ? err : new Error(message));
      }
      return false;
    }
  }
  getConnectedPeers() {
    return Array.from(this.connections.entries()).filter(([, c]) => c.status === "connected").map(([id]) => id);
  }
  isConnectingToPeer(peerId) {
    return this.connectingTo.has(peerId) || this._reconnectTimers.has(peerId);
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this._managedTimeouts.forEach((t) => clearTimeout(t));
    this._managedTimeouts.clear();
    this._reconnectTimers.forEach((t) => clearTimeout(t));
    this._reconnectTimers.clear();
    this._reconnectAttempts.clear();
    this._peerConnectFailures.clear();
    this._peerConnectQuarantineUntil.clear();
    this._peerConnectQuarantineLevel.clear();
    this._manuallyDisconnected.clear();
    this._signalingReconnectTimers.forEach((t) => clearTimeout(t));
    this._signalingReconnectTimers.clear();
    this._signalingReconnectAttempts.clear();
    this._stopSignalingProbe();
    this._pingTimers.forEach((t) => clearInterval(t));
    this._pingTimers.clear();
    this._pongTimeouts.forEach((t) => clearTimeout(t));
    this._pongTimeouts.clear();
    this._pendingPing.clear();
    this._missedPongs.clear();
    this._lastRecoveryAt.clear();
    if (this._networkListenersCleanup) {
      this._networkListenersCleanup();
      this._networkListenersCleanup = null;
    }
    this._networkListenersSetup = false;
    this.connections.forEach(({ conn }) => conn.close());
    this.connections.clear();
    this._peerMessageQueues.clear();
    this.connectingTo.clear();
    for (const instance of this.signalingInstances) {
      try {
        if (!instance.peer.destroyed && typeof instance.peer.disconnect === "function") {
          instance.peer.disconnect();
        }
      } catch {}
      try {
        if (!instance.peer.destroyed) {
          instance.peer.destroy();
        }
      } catch {}
      instance.connected = false;
    }
    this.signalingInstances = [];
    this.myPeerId = null;
  }
  setAutoReconnect(enabled) {
    this._autoReconnectEnabled = enabled;
  }
  _cancelReconnect(peerId) {
    const timer = this._reconnectTimers.get(peerId);
    if (timer)
      clearTimeout(timer);
    this._reconnectTimers.delete(peerId);
    this._reconnectAttempts.delete(peerId);
  }
  _scheduleReconnect(peerId) {
    if (!this._autoReconnectEnabled)
      return;
    if (this._manuallyDisconnected.has(peerId))
      return;
    if (this._reconnectTimers.has(peerId))
      return;
    const attempt = this._reconnectAttempts.get(peerId) ?? 0;
    const baseDelay = this._reconnectDelays[Math.min(attempt, this._reconnectDelays.length - 1)];
    const now = Date.now();
    const quarantinedUntil = this._peerConnectQuarantineUntil.get(peerId) ?? 0;
    const quarantineDelay = quarantinedUntil > now ? quarantinedUntil - now : 0;
    const delay = Math.max(baseDelay, quarantineDelay);
    const timer = setTimeout(async () => {
      this._reconnectTimers.delete(peerId);
      if (this._manuallyDisconnected.has(peerId))
        return;
      if (this.connections.has(peerId))
        return;
      this._reconnectAttempts.set(peerId, attempt + 1);
      try {
        await this.connect(peerId);
        this._reconnectAttempts.delete(peerId);
      } catch {
        this._scheduleReconnect(peerId);
      }
    }, delay);
    this._reconnectTimers.set(peerId, timer);
  }
  _isPeerUnavailableError(error, peerId) {
    if (!error)
      return false;
    const msg = error.message || "";
    if (!msg)
      return false;
    return msg.includes(`Could not connect to peer ${peerId}`) || msg.includes(`Failed to connect to ${peerId}`) || msg.includes(`Connection to ${peerId}`) || msg.includes("peer-unavailable");
  }
  _notePeerConnectFailure(peerId, error) {
    if (!this._isPeerUnavailableError(error, peerId))
      return;
    const failures = (this._peerConnectFailures.get(peerId) ?? 0) + 1;
    this._peerConnectFailures.set(peerId, failures);
    if (failures < PeerTransport.PEER_CONNECT_FAILURE_THRESHOLD)
      return;
    const level = (this._peerConnectQuarantineLevel.get(peerId) ?? 0) + 1;
    this._peerConnectQuarantineLevel.set(peerId, level);
    this._peerConnectFailures.set(peerId, 0);
    const quarantineMs = Math.min(PeerTransport.PEER_CONNECT_QUARANTINE_BASE_MS * 2 ** Math.max(0, level - 1), PeerTransport.PEER_CONNECT_QUARANTINE_MAX_MS);
    this._peerConnectQuarantineUntil.set(peerId, Date.now() + quarantineMs);
  }
  _clearPeerConnectFailure(peerId) {
    this._peerConnectFailures.delete(peerId);
    this._peerConnectQuarantineUntil.delete(peerId);
    this._peerConnectQuarantineLevel.delete(peerId);
  }
  setHeartbeatEnabled(enabled) {
    this._heartbeatEnabled = enabled;
    if (!enabled) {
      for (const peerId of this._pingTimers.keys()) {
        this._stopHeartbeat(peerId);
      }
    } else {
      for (const [peerId, active] of this.connections) {
        if (active.status === "connected") {
          this._startHeartbeat(peerId);
        }
      }
    }
  }
  _startHeartbeat(peerId) {
    if (!this._heartbeatEnabled)
      return;
    if (this._pingTimers.has(peerId))
      return;
    const interval = setInterval(() => {
      this._sendPing(peerId);
    }, PeerTransport.PING_INTERVAL_MS);
    this._pingTimers.set(peerId, interval);
  }
  _stopHeartbeat(peerId) {
    const interval = this._pingTimers.get(peerId);
    if (interval)
      clearInterval(interval);
    this._pingTimers.delete(peerId);
    const timeout = this._pongTimeouts.get(peerId);
    if (timeout)
      clearTimeout(timeout);
    this._pongTimeouts.delete(peerId);
    this._pendingPing.delete(peerId);
    this._missedPongs.delete(peerId);
    this._lastRecoveryAt.delete(peerId);
  }
  _sendPing(peerId) {
    const ts = Date.now();
    const sent = this.send(peerId, { type: "heartbeat:ping", ts });
    if (!sent)
      return;
    this._pendingPing.set(peerId, ts);
    const existing = this._pongTimeouts.get(peerId);
    if (existing)
      clearTimeout(existing);
    const timeout = setTimeout(() => {
      this._pongTimeouts.delete(peerId);
      this._onPingTimeout(peerId);
    }, PeerTransport.PONG_TIMEOUT_MS);
    this._pongTimeouts.set(peerId, timeout);
  }
  _handlePong(peerId, ts) {
    const pending = this._pendingPing.get(peerId);
    if (pending !== ts)
      return;
    this._pendingPing.delete(peerId);
    this._missedPongs.set(peerId, 0);
    const timeout = this._pongTimeouts.get(peerId);
    if (timeout)
      clearTimeout(timeout);
    this._pongTimeouts.delete(peerId);
  }
  _onPingTimeout(peerId) {
    const missed = (this._missedPongs.get(peerId) ?? 0) + 1;
    this._missedPongs.set(peerId, missed);
    if (missed < PeerTransport.HEARTBEAT_FAIL_THRESHOLD) {
      console.warn(`[Heartbeat] Peer ${peerId.slice(0, 8)} missed pong (${missed}/${PeerTransport.HEARTBEAT_FAIL_THRESHOLD})`);
      return;
    }
    const now = Date.now();
    const lastRecovery = this._lastRecoveryAt.get(peerId) ?? 0;
    if (now - lastRecovery < PeerTransport.RECOVERY_COOLDOWN_MS) {
      return;
    }
    this._lastRecoveryAt.set(peerId, now);
    console.warn(`[Heartbeat] Peer ${peerId.slice(0, 8)} unresponsive — attempting recovery`);
    const active = this.connections.get(peerId);
    if (!active)
      return;
    try {
      const pc = active.conn.peerConnection;
      if (pc && typeof pc.restartIce === "function") {
        transportLog.info(`Triggering ICE restart for ${peerId.slice(0, 8)}`);
        pc.restartIce();
        return;
      }
    } catch {}
    transportLog.info(`Closing dead connection to ${peerId.slice(0, 8)}`);
    active.conn.close();
  }
  _setupNetworkListeners() {
    if (this._networkListenersSetup)
      return;
    if (typeof window === "undefined")
      return;
    this._networkListenersSetup = true;
    const onOnline = () => {
      transportLog.info("Browser went online — pinging all peers");
      for (const [peerId, active] of this.connections) {
        if (active.status === "connected" && this._heartbeatEnabled) {
          this._sendPing(peerId);
        }
      }
      this._probeSignalingServers();
    };
    const onOffline = () => {
      transportLog.info("Browser went offline");
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        transportLog.debug("Tab became visible — pinging all peers");
        for (const [peerId, active] of this.connections) {
          if (active.status === "connected" && this._heartbeatEnabled) {
            this._sendPing(peerId);
          }
        }
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    this._networkListenersCleanup = () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }
  _probeSignalingServers() {
    for (const instance of this.signalingInstances) {
      if (!instance.connected && !instance.peer.destroyed) {
        transportLog.debug(`Probing signaling server: ${instance.label}`);
        try {
          instance.peer.reconnect();
        } catch {}
      }
    }
  }
  _startSignalingProbe() {
    if (this._signalingProbeInterval)
      return;
    if (this._destroyed)
      return;
    this._signalingProbeInterval = setInterval(() => {
      this._periodicSignalingProbe();
    }, PeerTransport.SIGNALING_PROBE_INTERVAL_MS);
    if (typeof this._signalingProbeInterval.unref === "function") {
      this._signalingProbeInterval.unref();
    }
  }
  _stopSignalingProbe() {
    if (this._signalingProbeInterval) {
      clearInterval(this._signalingProbeInterval);
      this._signalingProbeInterval = null;
    }
  }
  _periodicSignalingProbe() {
    if (this._destroyed)
      return;
    for (const instance of this.signalingInstances) {
      if (instance.peer.destroyed)
        continue;
      if (instance.connected)
        continue;
      this._signalingReconnectAttempts.delete(instance.url);
      if (!this._signalingReconnectTimers.has(instance.url)) {
        transportLog.info(`[probe] reviving signaling reconnect chain for ${instance.label}`);
        this._scheduleSignalingReconnect(instance);
      }
      try {
        instance.peer.reconnect();
      } catch {}
    }
  }
  getMyPeerId() {
    return this.myPeerId;
  }
  getSignalingStatus() {
    return this.signalingInstances.map((i) => ({
      url: i.url,
      label: i.label,
      connected: i.connected
    }));
  }
  _emitSignalingStateChange() {
    this.onSignalingStateChange?.(this.getSignalingStatus());
  }
  getConnectedServerCount() {
    return this.signalingInstances.filter((i) => i.connected).length;
  }
  async addSignalingServer(serverUrl, label) {
    if (!this.myPeerId) {
      console.warn("[PeerTransport] Cannot add signaling server before init()");
      return false;
    }
    if (this.signalingInstances.some((i) => i.url === serverUrl)) {
      transportLog.debug(`Already connected to ${serverUrl}`);
      return true;
    }
    try {
      transportLog.info(`Connecting to discovered server: ${serverUrl}`);
      await this._initServer({ url: serverUrl, label: label || serverUrl }, this.myPeerId);
      transportLog.info(`Successfully connected to ${serverUrl}`);
      return true;
    } catch (err) {
      console.warn(`[PEX] Failed to connect to ${serverUrl}:`, err.message);
      return false;
    }
  }
  _resolveIceServers(isLocalhost) {
    if (this.config.iceServers)
      return this.config.iceServers;
    if (isLocalhost)
      return [];
    if (this.config.useTurn === false)
      return DEFAULT_ICE_SERVERS;
    if (this.config.turnServers && this.config.turnServers.length > 0) {
      return [...DEFAULT_ICE_SERVERS, ...this.config.turnServers];
    }
    return ICE_SERVERS_WITH_TURN;
  }
  _resolveSignalingServers() {
    const servers = [];
    if (this.config.signalingServers && this.config.signalingServers.length > 0) {
      for (const s of this.config.signalingServers) {
        if (typeof s === "string") {
          servers.push({ url: s, label: s });
        } else {
          servers.push({ url: s.url, label: s.label || s.url });
        }
      }
      return servers;
    }
    if (this.config.signalingServer) {
      servers.push({ url: this.config.signalingServer, label: this.config.signalingServer });
    }
    return servers;
  }
  _createPeer(peerId, peerConfig) {
    return peerId ? new import_peerjs.Peer(peerId, peerConfig) : new import_peerjs.Peer(peerConfig);
  }
  _initSingleServer(peerId, attempt = 0) {
    return new Promise((resolve, reject) => {
      const configuredPort = resolveLocalDevSignalingPort();
      const peerConfig = {
        debug: this.config.debug ?? 1
      };
      if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
        peerConfig.host = "localhost";
        peerConfig.port = configuredPort;
        peerConfig.path = "/peerjs";
        peerConfig.secure = false;
      }
      const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      peerConfig.config = { iceServers: this._resolveIceServers(isLocalhost) };
      const peer = this._createPeer(peerId, peerConfig);
      const initErrHandler = (error) => {
        peer.destroy();
        if (error.type === "unavailable-id" && attempt < 5) {
          const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
          console.warn(`[PeerTransport] Peer ID temporarily taken, retrying in ${delay / 1000}s (attempt ${attempt + 1}/5)...`);
          this._setManagedTimeout(() => {
            this._initSingleServer(peerId, attempt + 1).then(resolve).catch(reject);
          }, delay);
        } else {
          if (error.type !== "unavailable-id")
            this.onError?.(error);
          reject(error);
        }
      };
      peer.on("error", initErrHandler);
      peer.on("open", (id) => {
        peer.off("error", initErrHandler);
        this.myPeerId = id;
        const instance = { peer, url: "default", label: "default", connected: true };
        this.signalingInstances.push(instance);
        this._setupPeerEvents(instance);
        this._setupNetworkListeners();
        this._startSignalingProbe();
        resolve(id);
      });
    });
  }
  _initServer(server, peerId, attempt = 0) {
    return new Promise((resolve, reject) => {
      const normalized = normalizePeerJsServer(server.url);
      const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const peerConfig = {
        host: normalized.host,
        port: normalized.port,
        path: normalized.path,
        secure: normalized.secure,
        debug: this.config.debug ?? 1,
        config: { iceServers: this._resolveIceServers(isLocalhost) }
      };
      const id = peerId || this.myPeerId;
      const peer = this._createPeer(id, peerConfig);
      const timeout = setTimeout(() => {
        peer.destroy();
        reject(new Error(`Signaling server ${server.label} timed out`));
      }, 15000);
      const initErrHandler = (error) => {
        clearTimeout(timeout);
        peer.destroy();
        if (error.type === "unavailable-id" && attempt < 5) {
          const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
          console.warn(`[PeerTransport] [${server.label}] Peer ID temporarily taken, retrying in ${delay / 1000}s (attempt ${attempt + 1}/5)...`);
          this._setManagedTimeout(() => {
            this._initServer(server, peerId, attempt + 1).then(resolve).catch(reject);
          }, delay);
        } else {
          if (error.type !== "unavailable-id") {
            this.onError?.(new Error(`[${server.label}] ${error.message || error}`));
          }
          reject(error);
        }
      };
      peer.on("error", initErrHandler);
      peer.on("open", (assignedId) => {
        clearTimeout(timeout);
        peer.off("error", initErrHandler);
        if (!this.myPeerId) {
          this.myPeerId = assignedId;
        }
        const instance = {
          peer,
          url: server.url,
          label: server.label,
          connected: true
        };
        this.signalingInstances.push(instance);
        this._setupPeerEvents(instance);
        this._emitSignalingStateChange();
        resolve(assignedId);
      });
    });
  }
  _setupPeerEvents(instance) {
    instance.peer.on("connection", (conn) => {
      this._setupConnection(conn, instance.url, true);
    });
    instance.peer.on("open", () => {
      instance.connected = true;
      transportLog.info(`Connected to signaling: ${instance.label}`);
      this._cancelSignalingReconnect(instance);
      this._emitSignalingStateChange();
    });
    instance.peer.on("disconnected", () => {
      instance.connected = false;
      transportLog.info(`Disconnected from signaling: ${instance.label}`);
      this._scheduleSignalingReconnect(instance);
      this._emitSignalingStateChange();
    });
    instance.peer.on("close", () => {
      instance.connected = false;
      transportLog.info(`Signaling closed: ${instance.label}`);
      if (!this._destroyed && !instance.peer.destroyed) {
        this._scheduleSignalingReconnect(instance);
      }
      this._emitSignalingStateChange();
    });
    instance.peer.on("error", (error) => {
      this.onError?.(new Error(`[${instance.label}] ${error.message || error}`));
      if (instance.peer.disconnected && !instance.peer.destroyed) {
        this._setManagedTimeout(() => {
          if (instance.peer.disconnected && !instance.peer.destroyed) {
            instance.peer.reconnect();
          }
        }, 1000);
      }
    });
  }
  _scheduleSignalingReconnect(instance) {
    if (instance.peer.destroyed)
      return;
    const existingTimer = this._signalingReconnectTimers.get(instance.url);
    if (existingTimer)
      clearTimeout(existingTimer);
    const attempt = this._signalingReconnectAttempts.get(instance.url) ?? 0;
    if (attempt >= PeerTransport.SIGNALING_MAX_RETRIES) {
      console.warn(`[DecentChat] Signaling reconnect gave up after ${attempt} attempts: ${instance.label}`);
      this._signalingReconnectAttempts.delete(instance.url);
      this._signalingReconnectTimers.delete(instance.url);
      return;
    }
    const delays = PeerTransport.SIGNALING_RECONNECT_DELAYS;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    transportLog.debug(`Scheduling signaling reconnect #${attempt + 1} in ${delay}ms: ${instance.label}`);
    const timer = this._setManagedTimeout(() => {
      this._signalingReconnectTimers.delete(instance.url);
      if (instance.peer.destroyed) {
        this._signalingReconnectAttempts.delete(instance.url);
        return;
      }
      if (!instance.peer.disconnected) {
        transportLog.debug(`Signaling already reconnected: ${instance.label}`);
        this._signalingReconnectAttempts.delete(instance.url);
        return;
      }
      this._signalingReconnectAttempts.set(instance.url, attempt + 1);
      transportLog.debug(`Attempting signaling reconnect #${attempt + 1}: ${instance.label}`);
      try {
        instance.peer.reconnect();
      } catch (err) {
        console.warn(`[DecentChat] Signaling reconnect threw: ${instance.label}`, err);
        this._scheduleSignalingReconnect(instance);
      }
    }, delay);
    this._signalingReconnectTimers.set(instance.url, timer);
  }
  _cancelSignalingReconnect(instance) {
    const timer = this._signalingReconnectTimers.get(instance.url);
    if (timer) {
      clearTimeout(timer);
      this._signalingReconnectTimers.delete(instance.url);
    }
    this._signalingReconnectAttempts.delete(instance.url);
  }
  _installSafePeerJsClose(conn) {
    const patched = conn;
    if (patched.__decentchatSafeClosePatched)
      return;
    patched.__decentchatSafeClosePatched = true;
    const originalClose = conn.close.bind(conn);
    patched.close = (...args) => {
      const dormantProvider = {
        options: patched.provider?.options ?? { config: {} },
        socket: { send: () => {} },
        emitError: () => {},
        getConnection: () => ({
          _initializeDataChannel: () => {},
          type: "data",
          addStream: () => {}
        }),
        _removeConnection: () => {},
        _getMessages: () => []
      };
      try {
        return originalClose(...args);
      } finally {
        if (patched.provider == null) {
          patched.provider = dormantProvider;
        }
      }
    };
  }
  _attemptConnect(instance, peerId) {
    return new Promise((resolve, reject) => {
      const conn = instance.peer.connect(peerId, { reliable: true });
      if (!conn) {
        reject(new Error(`Failed to create DataConnection to ${peerId} via ${instance.label} (peer.connect returned ${conn})`));
        return;
      }
      this._installSafePeerJsClose(conn);
      const timeout = setTimeout(() => {
        try {
          conn.close();
        } catch {}
        reject(new Error(`Connection to ${peerId} via ${instance.label} timed out`));
      }, 1e4);
      conn.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      conn.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      this._setupConnection(conn, instance.url, false);
    });
  }
  _setupConnection(conn, signalingServer, inbound) {
    this._installSafePeerJsClose(conn);
    const { peer: peerId } = conn;
    const existing = this.connections.get(peerId);
    if (existing && existing.status === "connected") {
      transportLog.debug(`dedup: rejecting ${inbound ? "inbound" : "outbound"} to ${peerId.slice(0, 8)} (already connected)`);
      conn.close();
      return;
    }
    if (existing && existing.status === "connecting" && this.myPeerId) {
      if (existing.inbound !== inbound) {
        const weAreLowest = this.myPeerId < peerId;
        if (inbound && weAreLowest) {
          transportLog.debug(`glare: rejecting inbound from ${peerId.slice(0, 8)} (our outbound wins)`);
          conn.close();
          return;
        }
        if (!inbound && !weAreLowest) {
          transportLog.debug(`glare: rejecting outbound to ${peerId.slice(0, 8)} (their inbound wins)`);
          conn.close();
          return;
        }
        transportLog.debug(`glare: overwriting ${existing.inbound ? "inbound" : "outbound"} with ${inbound ? "inbound" : "outbound"} for ${peerId.slice(0, 8)}`);
      } else {
        transportLog.debug(`dedup: rejecting same-dir ${inbound ? "inbound" : "outbound"} to ${peerId.slice(0, 8)} (first one kept)`);
        conn.close();
        return;
      }
    }
    if (existing) {
      try {
        existing.conn.close();
      } catch {}
    }
    const active = { conn, peerId, status: "connecting", signalingServer, inbound };
    this.connections.set(peerId, active);
    let alreadyConnected = false;
    const markConnected = () => {
      if (alreadyConnected)
        return;
      const current = this.connections.get(peerId);
      if (current && current !== active && current.status === "connected") {
        transportLog.debug(`markConnected: race-lost for ${peerId.slice(0, 8)} ${inbound ? "inbound" : "outbound"}, closing`);
        conn.close();
        return;
      }
      alreadyConnected = true;
      active.status = "connected";
      this.connections.set(peerId, active);
      this._startHeartbeat(peerId);
      transportLog.debug(`markConnected: firing onConnect for ${peerId.slice(0, 8)} ${inbound ? "inbound" : "outbound"} via ${signalingServer}`);
      this.onConnect?.(peerId);
    };
    if (conn.open) {
      markConnected();
    } else {
      conn.on("open", markConnected);
    }
    conn.on("data", (data) => {
      const current = this.connections.get(peerId);
      if (current?.conn !== conn)
        return;
      this._missedPongs.set(peerId, 0);
      const msg = data;
      if (msg?.type === "heartbeat:ping") {
        this.send(peerId, { type: "heartbeat:pong", ts: msg.ts });
        return;
      }
      if (msg?.type === "heartbeat:pong") {
        this._handlePong(peerId, msg.ts);
        return;
      }
      const prevQueue = this._peerMessageQueues.get(peerId) ?? Promise.resolve();
      const nextQueue = prevQueue.then(async () => {
        await this.onMessage?.(peerId, data);
        await new Promise((r) => setTimeout(r, 0));
      }).catch(() => {});
      this._peerMessageQueues.set(peerId, nextQueue);
    });
    conn.on("close", () => {
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        transportLog.debug(`conn.close for ${peerId.slice(0, 8)} ${inbound ? "inbound" : "outbound"} — firing onDisconnect`);
        this._stopHeartbeat(peerId);
        active.status = "failed";
        this.connections.delete(peerId);
        this._peerMessageQueues.delete(peerId);
        this.onDisconnect?.(peerId);
        this._scheduleReconnect(peerId);
      } else {
        transportLog.debug(`conn.close for ${peerId.slice(0, 8)} ${inbound ? "inbound" : "outbound"} — NOT active, ignoring`);
      }
    });
    conn.on("error", (err) => {
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        const wasConnected = current.status === "connected";
        this._stopHeartbeat(peerId);
        current.status = "failed";
        this.connections.delete(peerId);
        if (wasConnected) {
          this.onDisconnect?.(peerId);
        }
        this._scheduleReconnect(peerId);
      }
      this.onError?.(err);
    });
  }
  _setManagedTimeout(callback, delayMs) {
    const timer = setTimeout(() => {
      this._managedTimeouts.delete(timer);
      if (this._destroyed)
        return;
      callback();
    }, delayMs);
    this._managedTimeouts.add(timer);
    return timer;
  }
}
Object.defineProperty(PeerTransport, "PEER_CONNECT_FAILURE_THRESHOLD", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 2
});
Object.defineProperty(PeerTransport, "PEER_CONNECT_QUARANTINE_BASE_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 2 * 60000
});
Object.defineProperty(PeerTransport, "PEER_CONNECT_QUARANTINE_MAX_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 30 * 60000
});
Object.defineProperty(PeerTransport, "SIGNALING_RECONNECT_DELAYS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: [3000, 5000, 1e4, 30000, 60000]
});
Object.defineProperty(PeerTransport, "SIGNALING_MAX_RETRIES", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 50
});
Object.defineProperty(PeerTransport, "SIGNALING_PROBE_INTERVAL_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 30000
});
Object.defineProperty(PeerTransport, "PING_INTERVAL_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 30000
});
Object.defineProperty(PeerTransport, "PONG_TIMEOUT_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 20000
});
Object.defineProperty(PeerTransport, "HEARTBEAT_FAIL_THRESHOLD", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 2
});
Object.defineProperty(PeerTransport, "RECOVERY_COOLDOWN_MS", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 30000
});
// src/peer/DecentChatNodePeer.ts
import { createHash, randomUUID } from "node:crypto";

// src/peer/FileStore.ts
import { readFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
function openDatabase(dbPath) {
  const isBun = typeof globalThis !== "undefined" && "Bun" in globalThis;
  if (isBun) {
    const { Database } = __require("bun:sqlite");
    const db2 = new Database(dbPath);
    db2.exec("PRAGMA journal_mode = WAL");
    db2.exec("PRAGMA synchronous = NORMAL");
    return db2;
  }
  const BetterSqlite3 = __require("better-sqlite3");
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

class FileStore {
  dir;
  db;
  stmtGet;
  stmtSet;
  stmtDel;
  stmtKeys;
  stmtKeysAll;
  cache = new Map;
  constructor(dataDir) {
    this.dir = dataDir ?? join(homedir(), ".openclaw", "data", "decentchat");
    if (!existsSync(this.dir))
      mkdirSync(this.dir, { recursive: true });
    this.db = openDatabase(join(this.dir, "store.db"));
    this.db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.stmtGet = this.db.prepare("SELECT value FROM kv WHERE key = ?");
    this.stmtSet = this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
    this.stmtDel = this.db.prepare("DELETE FROM kv WHERE key = ?");
    this.stmtKeys = this.db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'");
    this.stmtKeysAll = this.db.prepare("SELECT key FROM kv");
    this.migrateJsonFiles();
  }
  get(key, defaultValue) {
    if (this.cache.has(key))
      return this.cache.get(key);
    const row = this.stmtGet.get(key);
    if (!row)
      return defaultValue;
    try {
      const data = JSON.parse(row.value);
      this.cache.set(key, data);
      return data;
    } catch {
      return defaultValue;
    }
  }
  set(key, value) {
    this.cache.set(key, value);
    this.stmtSet.run(key, JSON.stringify(value));
  }
  delete(key) {
    this.cache.delete(key);
    this.stmtDel.run(key);
  }
  keys(prefix = "") {
    const rows = prefix ? this.stmtKeys.all(this.likeEscape(prefix) + "%") : this.stmtKeysAll.all();
    const result = new Set(rows.map((r) => r.key));
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix))
        result.add(key);
    }
    return Array.from(result);
  }
  close() {
    try {
      this.db.close();
    } catch {}
  }
  migrateJsonFiles() {
    let jsonFiles;
    try {
      jsonFiles = readdirSync(this.dir).filter((f) => f.endsWith(".json") && !f.endsWith(".migrated"));
    } catch {
      return;
    }
    if (jsonFiles.length === 0)
      return;
    const insertMany = this.db.transaction(() => {
      for (const file of jsonFiles) {
        const key = file.slice(0, -".json".length);
        const filePath = join(this.dir, file);
        try {
          const raw = readFileSync(filePath, "utf-8");
          JSON.parse(raw);
          this.stmtSet.run(key, raw);
        } catch {
          continue;
        }
      }
    });
    insertMany();
    for (const file of jsonFiles) {
      try {
        renameSync(join(this.dir, file), join(this.dir, `${file}.migrated`));
      } catch {}
    }
  }
  likeEscape(s) {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
  }
}

// src/peer/NodeMessageProtocol.ts
var PRE_KEY_POLICY = DEFAULT_PRE_KEY_LIFECYCLE_POLICY;

class NodeMessageProtocol {
  cryptoManager;
  cipher;
  myPeerId;
  _signingKeyPair = null;
  ratchetStates = new Map;
  ratchetDHKeyPair = null;
  sharedSecrets = new Map;
  signingPublicKeys = new Map;
  peerPreKeyBundles = new Map;
  localSignedPreKey = null;
  localOneTimePreKeys = new Map;
  localPreKeyBundleCache = null;
  nextOneTimePreKeyId = 1;
  persistence = null;
  preKeyReady = null;
  localPreKeyMutation = Promise.resolve();
  getSigningPublicKey(peerId) {
    return this.signingPublicKeys.get(peerId);
  }
  async signData(data) {
    if (!this._signingKeyPair) {
      throw new Error("MessageProtocol not initialized with signing keys");
    }
    return this.cipher.sign(data, this._signingKeyPair.privateKey);
  }
  async verifyData(data, signature, peerId) {
    const signingKey = this.signingPublicKeys.get(peerId);
    if (!signingKey)
      return false;
    return this.cipher.verify(data, signature, signingKey);
  }
  constructor(cryptoManager, myPeerId) {
    this.cryptoManager = cryptoManager;
    this.cipher = new MessageCipher;
    this.myPeerId = myPeerId;
  }
  async init(signingKeyPair) {
    this._signingKeyPair = signingKeyPair;
    this.ratchetDHKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    await this.ensureLocalPreKeyMaterial();
  }
  setPersistence(persistence) {
    this.persistence = persistence;
    this.persistLocalPreKeyState();
  }
  async runWithLocalPreKeyMutation(operation) {
    const pending = this.localPreKeyMutation.catch(() => {
      return;
    }).then(operation);
    this.localPreKeyMutation = pending.then(() => {
      return;
    }, () => {
      return;
    });
    return pending;
  }
  async createHandshake() {
    const keyPair = await this.cryptoManager.getKeyPair();
    const publicKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);
    let ratchetDHPublicKey;
    if (this.ratchetDHKeyPair) {
      const ratchetPubRaw = await crypto.subtle.exportKey("raw", this.ratchetDHKeyPair.publicKey);
      ratchetDHPublicKey = arrayBufferToBase642(ratchetPubRaw);
    }
    let signingPublicKey;
    if (this._signingKeyPair) {
      signingPublicKey = await this.cryptoManager.exportPublicKey(this._signingKeyPair.publicKey);
    }
    return {
      publicKey,
      peerId: this.myPeerId,
      ratchetDHPublicKey,
      protocolVersion: 2,
      signingPublicKey,
      preKeySupport: true
    };
  }
  async processHandshake(peerId, handshake) {
    const peerPublicKey = await this.cryptoManager.importPublicKey(handshake.publicKey);
    if (handshake.signingPublicKey) {
      try {
        const signingKey = await this.cryptoManager.importSigningPublicKey(handshake.signingPublicKey);
        this.signingPublicKeys.set(peerId, signingKey);
      } catch (e) {
        console.warn(`[MessageProtocol] Failed to import signing key for ${peerId.slice(0, 8)}:`, e);
      }
    }
    const sharedSecret = await this.cryptoManager.deriveSharedSecret(peerPublicKey, undefined, this.myPeerId, peerId);
    this.sharedSecrets.set(peerId, sharedSecret);
    if (handshake.recovery === true) {
      console.log(`[MessageProtocol] Recovery handshake from ${peerId.slice(0, 8)} — clearing local ratchet state`);
      this.ratchetStates.delete(peerId);
      this.sharedSecrets.delete(peerId);
      if (this.persistence) {
        try {
          await this.persistence.delete(peerId);
        } catch {}
      }
    }
    if (handshake.protocolVersion === 2 && handshake.ratchetDHPublicKey) {
      if (this.ratchetStates.has(peerId))
        return;
      if (this.persistence) {
        const saved = await this.persistence.load(peerId);
        if (saved) {
          try {
            this.ratchetStates.set(peerId, await deserializeRatchetState(saved));
            return;
          } catch (e) {
            console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}, re-initializing:`, e);
          }
        }
      }
      const isAlice = this.myPeerId < peerId;
      const myKeyPair = await this.cryptoManager.getKeyPair();
      const initialSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: peerPublicKey }, myKeyPair.privateKey, 256);
      const peerRatchetDH = await crypto.subtle.importKey("raw", base64ToArrayBuffer2(handshake.ratchetDHPublicKey), { name: "ECDH", namedCurve: "P-256" }, true, []);
      let state;
      if (isAlice) {
        state = await DoubleRatchet.initAlice(initialSecret, peerRatchetDH);
      } else {
        state = await DoubleRatchet.initBob(initialSecret, this.ratchetDHKeyPair);
        this.ratchetDHKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      }
      this.ratchetStates.set(peerId, state);
      await this.persistState(peerId);
    }
  }
  async createPreKeyBundle() {
    await this.ensureLocalPreKeyMaterial();
    return this.runWithLocalPreKeyMutation(async () => {
      const changed = await this.applyLocalPreKeyLifecyclePolicy();
      if (changed) {
        await this.persistLocalPreKeyState();
      }
      if (!changed && this.localPreKeyBundleCache) {
        return structuredClone(this.localPreKeyBundleCache);
      }
      const bundle = await this.snapshotLocalPreKeyBundle();
      this.localPreKeyBundleCache = bundle;
      return structuredClone(bundle);
    });
  }
  async storePeerPreKeyBundle(peerId, bundle) {
    const sanitized = await this.sanitizeAndVerifyPeerPreKeyBundle(peerId, bundle);
    if (!sanitized)
      return false;
    this.peerPreKeyBundles.set(peerId, sanitized);
    await this.persistPeerPreKeyBundle(peerId, sanitized);
    return true;
  }
  async getPeerPreKeyBundle(peerId) {
    const cached = this.peerPreKeyBundles.get(peerId);
    if (cached) {
      const normalized = this.normalizePeerPreKeyBundle(cached);
      if (!normalized) {
        await this.clearPeerPreKeyBundle(peerId);
        return null;
      }
      if (this.hasPeerBundleChanged(cached, normalized)) {
        this.peerPreKeyBundles.set(peerId, normalized);
        await this.persistPeerPreKeyBundle(peerId, normalized);
      }
      return normalized;
    }
    if (!this.persistence?.loadPreKeyBundle)
      return null;
    try {
      const loaded = await this.persistence.loadPreKeyBundle(peerId);
      if (!loaded)
        return null;
      const sanitized = await this.sanitizeAndVerifyPeerPreKeyBundle(peerId, loaded);
      if (!sanitized) {
        if (this.persistence?.deletePreKeyBundle) {
          try {
            await this.persistence.deletePreKeyBundle(peerId);
          } catch (deleteError) {
            console.warn(`[PreKey] Failed to delete stale peer bundle for ${peerId.slice(0, 8)}:`, deleteError);
          }
        }
        return null;
      }
      this.peerPreKeyBundles.set(peerId, sanitized);
      if (this.hasPeerBundleChanged(loaded, sanitized)) {
        await this.persistPeerPreKeyBundle(peerId, sanitized);
      }
      return sanitized;
    } catch (e) {
      console.warn(`[PreKey] Failed to load peer bundle for ${peerId.slice(0, 8)}:`, e);
      return null;
    }
  }
  async clearPeerPreKeyBundle(peerId) {
    this.peerPreKeyBundles.delete(peerId);
    if (!this.persistence?.deletePreKeyBundle)
      return;
    try {
      await this.persistence.deletePreKeyBundle(peerId);
    } catch (e) {
      console.warn(`[PreKey] Failed to delete peer bundle for ${peerId.slice(0, 8)}:`, e);
    }
  }
  async encryptMessage(peerId, content, type = "text", metadata) {
    const signature = this._signingKeyPair ? await this.cipher.sign(content, this._signingKeyPair.privateKey) : "";
    const state = this.ratchetStates.get(peerId);
    if (state?.sendChainKey) {
      const ratchet = await DoubleRatchet.encrypt(state, content);
      await this.persistState(peerId);
      return {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        sender: this.myPeerId,
        type,
        ratchet,
        signature,
        protocolVersion: 2,
        metadata
      };
    }
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (sharedSecret) {
      const encrypted = await this.cipher.encrypt(content, sharedSecret);
      return {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        sender: this.myPeerId,
        type,
        encrypted,
        signature,
        protocolVersion: 1,
        metadata
      };
    }
    const bootstrapped = await this.encryptWithPreKeyBootstrap(peerId, content, type, signature, metadata);
    if (bootstrapped)
      return bootstrapped;
    throw new Error(`No shared secret with peer ${peerId.slice(0, 8)}`);
  }
  async decryptMessage(peerId, envelope, peerPublicKey) {
    if (envelope.protocolVersion === 3 && envelope.sessionInit) {
      return this.decryptPreKeySessionInit(peerId, envelope, peerPublicKey);
    }
    if (envelope.protocolVersion === 2 && "ratchet" in envelope) {
      let state = this.ratchetStates.get(peerId);
      if (!state && this.persistence) {
        const saved = await this.persistence.load(peerId);
        if (saved) {
          try {
            state = await deserializeRatchetState(saved);
            this.ratchetStates.set(peerId, state);
          } catch (e) {
            console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}:`, e);
          }
        }
      }
      if (!state) {
        throw new Error(`No ratchet state with peer ${peerId.slice(0, 8)}`);
      }
      const content2 = await DoubleRatchet.decrypt(state, envelope.ratchet);
      await this.persistState(peerId);
      const signingKey2 = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
      const isValid2 = await this.cipher.verify(content2, envelope.signature, signingKey2);
      if (!isValid2)
        return null;
      return content2;
    }
    if (!("encrypted" in envelope)) {
      throw new Error("Unsupported envelope format");
    }
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret)
      throw new Error(`No shared secret with peer ${peerId.slice(0, 8)}`);
    const content = await this.cipher.decrypt(envelope.encrypted, sharedSecret);
    const signingKey = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
    const isValid = await this.cipher.verify(content, envelope.signature, signingKey);
    if (!isValid)
      return null;
    return content;
  }
  hasSharedSecret(peerId) {
    return this.ratchetStates.has(peerId) || this.sharedSecrets.has(peerId);
  }
  hasRatchetState(peerId) {
    return this.ratchetStates.has(peerId);
  }
  clearSharedSecret(peerId) {
    this.sharedSecrets.delete(peerId);
  }
  async clearRatchetState(peerId) {
    this.ratchetStates.delete(peerId);
    if (this.persistence) {
      await this.persistence.delete(peerId);
    }
  }
  clearAllSecrets() {
    this.sharedSecrets.clear();
  }
  async restoreRatchetState(peerId) {
    if (!this.persistence)
      return false;
    const saved = await this.persistence.load(peerId);
    if (!saved)
      return false;
    try {
      this.ratchetStates.set(peerId, await deserializeRatchetState(saved));
      return true;
    } catch (e) {
      console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}:`, e);
      return false;
    }
  }
  async persistState(peerId) {
    if (!this.persistence)
      return;
    const state = this.ratchetStates.get(peerId);
    if (!state)
      return;
    try {
      const serialized = await serializeRatchetState(state);
      await this.persistence.save(peerId, serialized);
    } catch (e) {
      console.warn(`[Ratchet] Failed to persist state for ${peerId.slice(0, 8)}:`, e);
    }
  }
  async encryptWithPreKeyBootstrap(peerId, content, type, signature, metadata) {
    const bundle = await this.getPeerPreKeyBundle(peerId);
    if (!bundle)
      return null;
    const oneTimeKey = bundle.oneTimePreKeys[0];
    const selectedType = oneTimeKey ? "one-time" : "signed";
    const selectedKeyId = oneTimeKey?.keyId ?? bundle.signedPreKey.keyId;
    const selectedPublic = oneTimeKey?.publicKey ?? bundle.signedPreKey.publicKey;
    if (!selectedPublic)
      return null;
    if (!oneTimeKey && bundle.signedPreKey.expiresAt <= Date.now()) {
      return null;
    }
    const selectedPublicKey = await this.importEcdhPublicKey(selectedPublic);
    const senderEphemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const initialSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: selectedPublicKey }, senderEphemeral.privateKey, 256);
    const state = await DoubleRatchet.initAlice(initialSecret, selectedPublicKey);
    const ratchet = await DoubleRatchet.encrypt(state, content);
    this.ratchetStates.set(peerId, state);
    await this.persistState(peerId);
    const senderEphemeralPublicKey = await this.exportEcdhPublicKey(senderEphemeral.publicKey);
    if (oneTimeKey) {
      const consumedBundle = {
        ...bundle,
        oneTimePreKeys: bundle.oneTimePreKeys.slice(1)
      };
      const normalized = this.normalizePeerPreKeyBundle(consumedBundle);
      if (normalized) {
        this.peerPreKeyBundles.set(peerId, normalized);
        await this.persistPeerPreKeyBundle(peerId, normalized, "consumed peer bundle");
      } else {
        await this.clearPeerPreKeyBundle(peerId);
      }
    }
    return {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      sender: this.myPeerId,
      type,
      ratchet,
      signature,
      protocolVersion: 3,
      sessionInit: {
        type: "pre-key-session-init",
        bundleVersion: PRE_KEY_BUNDLE_VERSION,
        selectedPreKeyId: selectedKeyId,
        selectedPreKeyType: selectedType,
        senderEphemeralPublicKey,
        createdAt: Date.now()
      },
      metadata
    };
  }
  async decryptPreKeySessionInit(peerId, envelope, peerPublicKey) {
    if (this.ratchetStates.has(peerId)) {
      throw new Error(`Ratchet already established with peer ${peerId.slice(0, 8)}`);
    }
    await this.ensureLocalPreKeyMaterial();
    return this.runWithLocalPreKeyMutation(async () => {
      const init = envelope.sessionInit;
      if (!init || init.type !== "pre-key-session-init") {
        throw new Error("Invalid pre-key session-init payload");
      }
      const localPreKey = this.resolveLocalPreKey(init.selectedPreKeyType, init.selectedPreKeyId);
      if (!localPreKey) {
        throw new Error(`Pre-key ${init.selectedPreKeyType}:${init.selectedPreKeyId} unavailable`);
      }
      const senderEphemeral = await this.importEcdhPublicKey(init.senderEphemeralPublicKey);
      const initialSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: senderEphemeral }, localPreKey.privateKey, 256);
      const state = await DoubleRatchet.initBob(initialSecret, {
        publicKey: localPreKey.publicKey,
        privateKey: localPreKey.privateKey
      });
      const content = await DoubleRatchet.decrypt(state, envelope.ratchet);
      const signingKey = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
      const isValid = await this.cipher.verify(content, envelope.signature, signingKey);
      if (!isValid)
        return null;
      this.ratchetStates.set(peerId, state);
      await this.persistState(peerId);
      let localStateChanged = false;
      if (init.selectedPreKeyType === "one-time") {
        this.localOneTimePreKeys.delete(init.selectedPreKeyId);
        this.invalidateLocalPreKeyBundleCache();
        localStateChanged = true;
      }
      if (await this.applyLocalPreKeyLifecyclePolicy()) {
        localStateChanged = true;
      }
      if (localStateChanged) {
        await this.persistLocalPreKeyState();
      }
      return content;
    });
  }
  resolveLocalPreKey(type, keyId) {
    if (type === "signed") {
      if (!this.localSignedPreKey || this.localSignedPreKey.keyId !== keyId)
        return null;
      return this.localSignedPreKey;
    }
    return this.localOneTimePreKeys.get(keyId) ?? null;
  }
  async ensureLocalPreKeyMaterial() {
    if (this.preKeyReady) {
      await this.preKeyReady;
      return;
    }
    this.preKeyReady = (async () => {
      let restored = false;
      if (this.persistence?.loadLocalPreKeyState) {
        try {
          const persisted = await this.persistence.loadLocalPreKeyState(this.myPeerId);
          if (persisted) {
            await this.loadLocalPreKeyState(persisted);
            restored = true;
          }
        } catch (e) {
          console.warn("[PreKey] Failed to load local pre-key state:", e);
        }
      }
      if (!restored) {
        await this.generateFreshLocalPreKeys();
      }
      const changed = await this.applyLocalPreKeyLifecyclePolicy();
      if (!restored || changed) {
        await this.persistLocalPreKeyState();
      }
    })();
    await this.preKeyReady;
  }
  async loadLocalPreKeyState(state) {
    this.localSignedPreKey = {
      keyId: state.signedPreKey.keyId,
      createdAt: state.signedPreKey.createdAt,
      expiresAt: state.signedPreKey.expiresAt,
      signature: state.signedPreKey.signature,
      publicKey: await this.importEcdhPublicKey(state.signedPreKey.publicKey),
      privateKey: await this.importEcdhPrivateKey(state.signedPreKey.privateKey)
    };
    this.localOneTimePreKeys.clear();
    for (const key of state.oneTimePreKeys) {
      this.localOneTimePreKeys.set(key.keyId, {
        keyId: key.keyId,
        createdAt: key.createdAt,
        publicKey: await this.importEcdhPublicKey(key.publicKey),
        privateKey: await this.importEcdhPrivateKey(key.privateKey)
      });
    }
    this.nextOneTimePreKeyId = Math.max(state.nextOneTimePreKeyId, ...Array.from(this.localOneTimePreKeys.keys(), (id) => id + 1), 1);
    this.invalidateLocalPreKeyBundleCache();
  }
  async generateFreshLocalPreKeys() {
    if (!this._signingKeyPair)
      throw new Error("MessageProtocol not initialized with signing keys");
    this.invalidateLocalPreKeyBundleCache();
    const now = Date.now();
    const signedPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const signedPub = await this.exportEcdhPublicKey(signedPair.publicKey);
    this.localSignedPreKey = {
      keyId: now,
      publicKey: signedPair.publicKey,
      privateKey: signedPair.privateKey,
      createdAt: now,
      expiresAt: now + PRE_KEY_POLICY.signedPreKeyTtlMs,
      signature: await this.cipher.sign(signedPub, this._signingKeyPair.privateKey)
    };
    this.localOneTimePreKeys.clear();
    this.nextOneTimePreKeyId = 1;
    await this.generateMoreOneTimePreKeys(PRE_KEY_POLICY.targetOneTimePreKeys);
  }
  async rotateLocalSignedPreKey(now = Date.now()) {
    if (!this._signingKeyPair)
      throw new Error("MessageProtocol not initialized with signing keys");
    this.invalidateLocalPreKeyBundleCache();
    const signedPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const signedPub = await this.exportEcdhPublicKey(signedPair.publicKey);
    this.localSignedPreKey = {
      keyId: Math.max(now, (this.localSignedPreKey?.keyId ?? 0) + 1),
      publicKey: signedPair.publicKey,
      privateKey: signedPair.privateKey,
      createdAt: now,
      expiresAt: now + PRE_KEY_POLICY.signedPreKeyTtlMs,
      signature: await this.cipher.sign(signedPub, this._signingKeyPair.privateKey)
    };
  }
  async applyLocalPreKeyLifecyclePolicy(now = Date.now()) {
    const signedDecision = decideSignedPreKeyLifecycle(this.localSignedPreKey, {
      now,
      refreshWindowMs: PRE_KEY_POLICY.signedPreKeyRefreshWindowMs
    });
    if (signedDecision.regenerateAll) {
      await this.generateFreshLocalPreKeys();
      return true;
    }
    let changed = false;
    if (signedDecision.rotateSignedPreKey) {
      await this.rotateLocalSignedPreKey(now);
      changed = true;
    }
    const oneTimePlan = planLocalOneTimePreKeyLifecycle(this.localOneTimePreKeys.values(), {
      now,
      maxAgeMs: PRE_KEY_POLICY.maxOneTimePreKeyAgeMs,
      targetCount: PRE_KEY_POLICY.targetOneTimePreKeys,
      lowWatermark: PRE_KEY_POLICY.lowWatermarkOneTimePreKeys
    });
    if (oneTimePlan.staleKeyIds.length > 0) {
      for (const keyId of oneTimePlan.staleKeyIds) {
        this.localOneTimePreKeys.delete(keyId);
      }
      this.invalidateLocalPreKeyBundleCache();
      changed = true;
    }
    if (this.localOneTimePreKeys.size > PRE_KEY_POLICY.targetOneTimePreKeys) {
      const keyIdsToRemove = Array.from(this.localOneTimePreKeys.values()).sort((a, b) => b.keyId - a.keyId).slice(PRE_KEY_POLICY.targetOneTimePreKeys).map((record) => record.keyId);
      for (const keyId of keyIdsToRemove) {
        this.localOneTimePreKeys.delete(keyId);
      }
      this.invalidateLocalPreKeyBundleCache();
      changed = true;
    }
    if (oneTimePlan.replenishCount > 0) {
      await this.generateMoreOneTimePreKeys(oneTimePlan.replenishCount);
      changed = true;
    }
    return changed;
  }
  async generateMoreOneTimePreKeys(count) {
    if (count > 0) {
      this.invalidateLocalPreKeyBundleCache();
    }
    for (let i = 0;i < count; i++) {
      const keyId = this.nextOneTimePreKeyId++;
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      this.localOneTimePreKeys.set(keyId, {
        keyId,
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        createdAt: Date.now()
      });
    }
  }
  async snapshotLocalPreKeyBundle() {
    if (!this.localSignedPreKey || !this._signingKeyPair) {
      throw new Error("Local pre-key state unavailable");
    }
    const oneTimePreKeys = await Promise.all(Array.from(this.localOneTimePreKeys.values()).sort((a, b) => a.keyId - b.keyId).map(async (record) => ({
      keyId: record.keyId,
      publicKey: await this.exportEcdhPublicKey(record.publicKey),
      createdAt: record.createdAt
    })));
    return {
      version: PRE_KEY_BUNDLE_VERSION,
      peerId: this.myPeerId,
      generatedAt: Date.now(),
      signingPublicKey: await this.cryptoManager.exportPublicKey(this._signingKeyPair.publicKey),
      signedPreKey: {
        keyId: this.localSignedPreKey.keyId,
        publicKey: await this.exportEcdhPublicKey(this.localSignedPreKey.publicKey),
        signature: this.localSignedPreKey.signature,
        createdAt: this.localSignedPreKey.createdAt,
        expiresAt: this.localSignedPreKey.expiresAt
      },
      oneTimePreKeys
    };
  }
  async persistLocalPreKeyState() {
    if (!this.persistence?.saveLocalPreKeyState || !this.localSignedPreKey)
      return;
    try {
      const state = {
        version: PRE_KEY_BUNDLE_VERSION,
        generatedAt: Date.now(),
        signedPreKey: {
          keyId: this.localSignedPreKey.keyId,
          publicKey: await this.exportEcdhPublicKey(this.localSignedPreKey.publicKey),
          privateKey: await this.exportEcdhPrivateKey(this.localSignedPreKey.privateKey),
          signature: this.localSignedPreKey.signature,
          createdAt: this.localSignedPreKey.createdAt,
          expiresAt: this.localSignedPreKey.expiresAt
        },
        oneTimePreKeys: await Promise.all(Array.from(this.localOneTimePreKeys.values()).sort((a, b) => a.keyId - b.keyId).map(async (record) => ({
          keyId: record.keyId,
          publicKey: await this.exportEcdhPublicKey(record.publicKey),
          privateKey: await this.exportEcdhPrivateKey(record.privateKey),
          createdAt: record.createdAt
        }))),
        nextOneTimePreKeyId: this.nextOneTimePreKeyId
      };
      await this.persistence.saveLocalPreKeyState(this.myPeerId, state);
    } catch (e) {
      console.warn("[PreKey] Failed to persist local pre-key state:", e);
    }
  }
  async persistPeerPreKeyBundle(peerId, bundle, context = "peer bundle") {
    if (!this.persistence?.savePreKeyBundle)
      return;
    try {
      await this.persistence.savePreKeyBundle(peerId, bundle);
    } catch (e) {
      console.warn(`[PreKey] Failed to persist ${context} for ${peerId.slice(0, 8)}:`, e);
    }
  }
  invalidateLocalPreKeyBundleCache() {
    this.localPreKeyBundleCache = null;
  }
  normalizePeerPreKeyBundle(bundle, now = Date.now()) {
    return normalizePeerPreKeyBundle(bundle, {
      now,
      expectedVersion: PRE_KEY_BUNDLE_VERSION,
      maxBundleAgeMs: PRE_KEY_POLICY.maxPeerBundleAgeMs,
      maxOneTimePreKeyAgeMs: PRE_KEY_POLICY.maxOneTimePreKeyAgeMs
    });
  }
  hasPeerBundleChanged(before, after) {
    return hasPeerPreKeyBundleChanged(before, after);
  }
  async sanitizeAndVerifyPeerPreKeyBundle(peerId, bundle) {
    const normalized = this.normalizePeerPreKeyBundle(bundle);
    if (!normalized)
      return null;
    if (normalized.peerId !== peerId)
      return null;
    try {
      const signingKey = await this.cryptoManager.importSigningPublicKey(normalized.signingPublicKey);
      const isValid = await this.cipher.verify(normalized.signedPreKey.publicKey, normalized.signedPreKey.signature, signingKey);
      if (!isValid)
        return null;
      await this.importEcdhPublicKey(normalized.signedPreKey.publicKey);
      for (const entry of normalized.oneTimePreKeys) {
        await this.importEcdhPublicKey(entry.publicKey);
      }
      return normalized;
    } catch {
      return null;
    }
  }
  async exportEcdhPublicKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase642(raw);
  }
  async exportEcdhPrivateKey(key) {
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", key);
    return arrayBufferToBase642(pkcs8);
  }
  async importEcdhPublicKey(rawBase64) {
    return crypto.subtle.importKey("raw", base64ToArrayBuffer2(rawBase64), { name: "ECDH", namedCurve: "P-256" }, true, []);
  }
  async importEcdhPrivateKey(pkcs8Base64) {
    return crypto.subtle.importKey("pkcs8", base64ToArrayBuffer2(pkcs8Base64), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  }
  generateMessageId() {
    return crypto.randomUUID();
  }
}
function arrayBufferToBase642(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0;i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToArrayBuffer2(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0;i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// src/peer/SyncProtocol.ts
var DEFAULT_CAPABILITY_WAIT_MS = 800;
var DEFAULT_NEGENTROPY_BATCH_SIZE = 50;

class SyncProtocol2 {
  workspaceManager;
  messageStore;
  sendFn;
  onEvent;
  myPeerId;
  serverDiscovery;
  enableNegentropy;
  capabilityWaitMs;
  negentropyBatchSize;
  peerCapabilities = new Map;
  pendingCapabilityFallback = new Map;
  pendingNegentropyResponse = new Map;
  pendingNegentropyBatches = new Map;
  constructor(workspaceManager, messageStore, sendFn, onEvent, myPeerId, serverDiscovery, options = {}) {
    this.workspaceManager = workspaceManager;
    this.messageStore = messageStore;
    this.sendFn = sendFn;
    this.onEvent = onEvent;
    this.myPeerId = myPeerId;
    this.serverDiscovery = serverDiscovery;
    this.enableNegentropy = options.enableNegentropy ?? true;
    this.capabilityWaitMs = options.capabilityWaitMs ?? DEFAULT_CAPABILITY_WAIT_MS;
    this.negentropyBatchSize = options.negentropyBatchSize ?? DEFAULT_NEGENTROPY_BATCH_SIZE;
  }
  async handleMessage(fromPeerId, msg) {
    switch (msg.type) {
      case "sync-capabilities":
        this.handleCapabilities(fromPeerId, msg);
        break;
      case "negentropy-query":
        await this.handleNegentropyQuery(fromPeerId, msg);
        break;
      case "negentropy-response":
        this.handleNegentropyResponse(fromPeerId, msg);
        break;
      case "negentropy-request-messages":
        this.handleNegentropyRequestMessages(fromPeerId, msg);
        break;
      case "negentropy-message-batch":
        this.handleNegentropyMessageBatch(fromPeerId, msg);
        break;
      case "join-request":
        this.handleJoinRequest(fromPeerId, msg);
        break;
      case "join-accepted":
        await this.handleJoinAccepted(fromPeerId, msg);
        break;
      case "join-rejected":
        this.onEvent({ type: "join-rejected", reason: msg.reason });
        break;
      case "member-joined":
        this.handleMemberJoined(msg);
        break;
      case "member-left":
        this.handleMemberLeft(msg);
        break;
      case "channel-created":
        this.handleChannelCreated(msg);
        break;
      case "channel-removed":
        this.handleChannelRemoved(msg);
        break;
      case "workspace-deleted":
        this.handleWorkspaceDeleted(msg);
        break;
      case "channel-message":
        await this.handleChannelMessage(fromPeerId, msg);
        break;
      case "sync-request":
        this.handleSyncRequest(fromPeerId, msg);
        break;
      case "sync-response":
        await this.handleSyncResponse(msg);
        break;
      case "peer-exchange":
        this.handlePeerExchange(msg);
        break;
      default:
        break;
    }
  }
  requestJoin(targetPeerId, inviteCode, myMember, inviteId) {
    const msg = {
      type: "join-request",
      inviteCode,
      member: myMember,
      inviteId,
      pexServers: this.serverDiscovery?.getHandshakeServers()
    };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  broadcastMemberJoined(workspaceId, member, connectedPeerIds) {
    const msg = { type: "member-joined", member };
    for (const peerId of connectedPeerIds) {
      if (peerId !== member.peerId && peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastChannelCreated(workspaceId, channel, connectedPeerIds) {
    const msg = { type: "channel-created", channel };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastWorkspaceDeleted(workspaceId, deletedBy, connectedPeerIds) {
    const msg = { type: "workspace-deleted", workspaceId, deletedBy };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg, workspaceId });
      }
    }
  }
  broadcastMessage(channelId, message, connectedPeerIds) {
    const msg = { type: "channel-message", channelId, message };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg });
      }
    }
  }
  requestSync(targetPeerId, workspaceId) {
    if (!this.enableNegentropy) {
      this.sendLegacySyncRequest(targetPeerId, workspaceId);
      return;
    }
    const known = this.peerCapabilities.get(targetPeerId);
    if (known?.negentropy) {
      this.startNegentropySyncSafely(targetPeerId, workspaceId);
      return;
    }
    this.sendCapabilities(targetPeerId, workspaceId);
    const key = `${targetPeerId}:${workspaceId}`;
    const existing = this.pendingCapabilityFallback.get(key);
    if (existing)
      clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingCapabilityFallback.delete(key);
      const current = this.peerCapabilities.get(targetPeerId);
      if (current?.negentropy) {
        this.startNegentropySyncSafely(targetPeerId, workspaceId);
      } else {
        this.sendLegacySyncRequest(targetPeerId, workspaceId);
      }
    }, this.capabilityWaitMs);
    this.pendingCapabilityFallback.set(key, timer);
  }
  broadcastPeerExchange(connectedPeerIds) {
    if (!this.serverDiscovery)
      return;
    const msg = {
      type: "peer-exchange",
      servers: this.serverDiscovery.getHandshakeServers()
    };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: "workspace-sync", sync: msg });
      }
    }
  }
  getServerDiscovery() {
    return this.serverDiscovery;
  }
  sendCapabilities(peerId, workspaceId, response = false) {
    const msg = {
      type: "sync-capabilities",
      workspaceId,
      response,
      features: { negentropy: this.enableNegentropy }
    };
    this.sendFn(peerId, { type: "workspace-sync", sync: msg });
  }
  handleCapabilities(fromPeerId, msg) {
    this.peerCapabilities.set(fromPeerId, {
      negentropy: Boolean(msg.features?.negentropy),
      updatedAt: Date.now()
    });
    if (!msg.response) {
      this.sendCapabilities(fromPeerId, msg.workspaceId, true);
    }
    const key = `${fromPeerId}:${msg.workspaceId}`;
    const pending = this.pendingCapabilityFallback.get(key);
    if (!pending)
      return;
    clearTimeout(pending);
    this.pendingCapabilityFallback.delete(key);
    if (msg.features?.negentropy && this.enableNegentropy) {
      this.startNegentropySyncSafely(fromPeerId, msg.workspaceId);
    } else {
      this.sendLegacySyncRequest(fromPeerId, msg.workspaceId);
    }
  }
  startNegentropySyncSafely(targetPeerId, workspaceId) {
    this.startNegentropySync(targetPeerId, workspaceId).catch(() => {
      this.sendLegacySyncRequest(targetPeerId, workspaceId);
    });
  }
  async startNegentropySync(targetPeerId, workspaceId) {
    console.log(`[decentchat-peer] startNegentropySync called: target=${targetPeerId} ws=${workspaceId}`);
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      console.log(`[decentchat-peer] startNegentropySync: workspace ${workspaceId} not found, available: ${this.workspaceManager.getAllWorkspaces().map((w) => w.id).join(", ")}`);
      return;
    }
    console.log(`[decentchat-peer] starting negentropy sync with ${targetPeerId} for workspace ${workspaceId}`);
    for (const channel of workspace.channels) {
      await this.syncChannelWithNegentropy(targetPeerId, workspaceId, channel.id);
    }
    this.onEvent({ type: "sync-complete", workspaceId });
  }
  async syncChannelWithNegentropy(targetPeerId, workspaceId, channelId) {
    const localMessages = this.messageStore.getMessages(channelId);
    console.log(`[decentchat-peer] negentropy sync channel ${channelId} with ${targetPeerId}: ${localMessages.length} local`);
    const negentropy = new Negentropy;
    await negentropy.build(localMessages.map((message) => ({ id: message.id, timestamp: message.timestamp })));
    const needResult = await negentropy.reconcile(async (query) => {
      return this.sendNegentropyQuery(targetPeerId, workspaceId, channelId, query);
    });
    console.log(`[decentchat-peer] negentropy result for ${channelId}: need ${needResult.need.length} messages from ${targetPeerId}`);
    if (needResult.need.length === 0)
      return;
    const fetched = await this.requestMissingMessages(targetPeerId, workspaceId, channelId, needResult.need);
    console.log(`[decentchat-peer] fetched ${fetched.length} messages from ${targetPeerId} for ${channelId}`);
    if (fetched.length === 0)
      return;
    await this.mergeSyncedMessages(channelId, fetched);
  }
  async sendNegentropyQuery(targetPeerId, workspaceId, channelId, query) {
    const key = `${targetPeerId}:${workspaceId}:${channelId}`;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingNegentropyResponse.delete(key);
        reject(new Error(`Negentropy response timeout from ${targetPeerId}`));
      }, 5000);
      this.pendingNegentropyResponse.set(key, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      const msg = {
        type: "negentropy-query",
        workspaceId,
        channelId,
        query
      };
      const sent = this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
      if (!sent) {
        clearTimeout(timeout);
        this.pendingNegentropyResponse.delete(key);
        reject(new Error(`Failed to send negentropy query to ${targetPeerId}`));
      }
    });
  }
  async handleNegentropyQuery(fromPeerId, msg) {
    const localMessages = this.messageStore.getMessages(msg.channelId);
    const negentropy = new Negentropy;
    await negentropy.build(localMessages.map((message) => ({ id: message.id, timestamp: message.timestamp })));
    const response = await negentropy.processQuery(msg.query);
    const payload = {
      type: "negentropy-response",
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      response
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: payload });
  }
  handleNegentropyResponse(fromPeerId, msg) {
    const key = `${fromPeerId}:${msg.workspaceId}:${msg.channelId}`;
    const resolver = this.pendingNegentropyResponse.get(key);
    if (!resolver)
      return;
    this.pendingNegentropyResponse.delete(key);
    resolver(msg.response);
  }
  async requestMissingMessages(targetPeerId, workspaceId, channelId, ids) {
    const key = `${targetPeerId}:${workspaceId}:${channelId}`;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingNegentropyBatches.delete(key);
        reject(new Error(`Negentropy message batch timeout from ${targetPeerId}`));
      }, 5000);
      this.pendingNegentropyBatches.set(key, {
        resolve,
        reject,
        timer: timeout,
        messages: []
      });
      const msg = {
        type: "negentropy-request-messages",
        workspaceId,
        channelId,
        ids
      };
      const sent = this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
      if (!sent) {
        clearTimeout(timeout);
        this.pendingNegentropyBatches.delete(key);
        reject(new Error(`Failed to request missing messages from ${targetPeerId}`));
      }
    });
  }
  handleNegentropyRequestMessages(fromPeerId, msg) {
    const requested = new Set(msg.ids);
    const messages = this.messageStore.getMessages(msg.channelId).filter((message) => requested.has(message.id)).map((message) => {
      const { content, ...safe } = message;
      return safe;
    }).sort((a, b) => a.timestamp - b.timestamp);
    if (messages.length === 0) {
      const emptyDone = {
        type: "negentropy-message-batch",
        workspaceId: msg.workspaceId,
        channelId: msg.channelId,
        messages: [],
        done: true
      };
      this.sendFn(fromPeerId, { type: "workspace-sync", sync: emptyDone });
      return;
    }
    for (let i = 0;i < messages.length; i += this.negentropyBatchSize) {
      const batch = messages.slice(i, i + this.negentropyBatchSize);
      const payload = {
        type: "negentropy-message-batch",
        workspaceId: msg.workspaceId,
        channelId: msg.channelId,
        messages: batch,
        done: i + this.negentropyBatchSize >= messages.length
      };
      this.sendFn(fromPeerId, { type: "workspace-sync", sync: payload });
    }
  }
  handleNegentropyMessageBatch(fromPeerId, msg) {
    const key = `${fromPeerId}:${msg.workspaceId}:${msg.channelId}`;
    const pending = this.pendingNegentropyBatches.get(key);
    if (!pending)
      return;
    pending.messages.push(...msg.messages);
    if (!msg.done)
      return;
    clearTimeout(pending.timer);
    this.pendingNegentropyBatches.delete(key);
    pending.resolve(pending.messages);
  }
  async mergeSyncedMessages(channelId, incoming) {
    const existing = this.messageStore.getMessages(channelId);
    const merged = new Map;
    for (const message of existing) {
      const { content, ...safe } = message;
      merged.set(message.id, safe);
    }
    const newMessages = [];
    for (const message of incoming) {
      if (!merged.has(message.id)) {
        merged.set(message.id, { ...message });
        newMessages.push(message);
      }
    }
    const sorted = Array.from(merged.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp)
        return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });
    await this.messageStore.importMessages(channelId, sorted);
    for (const message of newMessages) {
      this.onEvent({ type: "message-received", channelId, message });
    }
  }
  sendLegacySyncRequest(targetPeerId, workspaceId) {
    const msg = { type: "sync-request", workspaceId };
    this.sendFn(targetPeerId, { type: "workspace-sync", sync: msg });
  }
  handleJoinRequest(fromPeerId, msg) {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }
    const workspace = this.workspaceManager.validateInviteCode(msg.inviteCode);
    if (!workspace) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: "Invalid invite code" }
      });
      return;
    }
    if (msg.inviteId && this.workspaceManager.isInviteRevoked(workspace.id, msg.inviteId)) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: "This invite link has been revoked by an admin" }
      });
      return;
    }
    const result = this.workspaceManager.addMember(workspace.id, msg.member);
    if (!result.success) {
      this.sendFn(fromPeerId, {
        type: "workspace-sync",
        sync: { type: "join-rejected", reason: result.error || "Failed to join" }
      });
      return;
    }
    const messageHistory = {};
    for (const channel of workspace.channels) {
      const msgs = this.messageStore.getMessages(channel.id);
      if (msgs.length > 0) {
        messageHistory[channel.id] = msgs.map((message) => {
          const { content, ...safeMsg } = message;
          return safeMsg;
        });
      }
    }
    const acceptMsg = {
      type: "join-accepted",
      workspace: this.workspaceManager.exportWorkspace(workspace.id),
      messageHistory,
      pexServers: this.serverDiscovery?.getHandshakeServers()
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: acceptMsg });
    this.onEvent({ type: "member-joined", workspaceId: workspace.id, member: msg.member });
  }
  async handleJoinAccepted(fromPeerId, msg) {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }
    this.workspaceManager.importWorkspace(msg.workspace);
    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.mergeSyncedMessages(channelId, messages);
    }
    this.onEvent({
      type: "workspace-joined",
      workspace: msg.workspace,
      messageHistory: msg.messageHistory
    });
    console.log(`[decentchat-peer] handleJoinAccepted: triggering sync with ${fromPeerId} ws=${msg.workspace.id} allWs=${this.workspaceManager.getAllWorkspaces().map((w) => w.id).join(",")}`);
    this.startNegentropySyncSafely(fromPeerId, msg.workspace.id);
  }
  handleMemberJoined(msg) {
    if (!msg.workspaceId)
      return;
    const result = this.workspaceManager.addMember(msg.workspaceId, msg.member);
    if (result.success) {
      this.onEvent({ type: "member-joined", workspaceId: msg.workspaceId, member: msg.member });
    }
  }
  handleMemberLeft(msg) {
    if (!msg.workspaceId)
      return;
    this.onEvent({ type: "member-left", workspaceId: msg.workspaceId, peerId: msg.peerId });
  }
  handleChannelCreated(msg) {
    const targetWsId = msg.workspaceId || msg.channel.workspaceId;
    if (!targetWsId)
      return;
    const ws = this.workspaceManager.getWorkspace(targetWsId);
    if (!ws)
      return;
    const existing = ws.channels.find((channel) => channel.id === msg.channel.id);
    if (!existing) {
      ws.channels.push(msg.channel);
      this.onEvent({ type: "channel-created", workspaceId: ws.id, channel: msg.channel });
    }
  }
  handleChannelRemoved(msg) {
    if (!msg.workspaceId)
      return;
    const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!ws)
      return;
    const index = ws.channels.findIndex((channel) => channel.id === msg.channelId && channel.type === "channel");
    if (index >= 0) {
      ws.channels.splice(index, 1);
      this.onEvent({ type: "channel-removed", workspaceId: ws.id, channelId: msg.channelId });
    }
  }
  handleWorkspaceDeleted(msg) {
    const workspaceId = msg.workspaceId;
    if (!workspaceId)
      return;
    this.workspaceManager.removeWorkspace(workspaceId);
    this.onEvent({ type: "workspace-deleted", workspaceId, deletedBy: msg.deletedBy });
  }
  async handleChannelMessage(fromPeerId, msg) {
    const message = msg.message;
    const result = await this.messageStore.addMessage(message);
    if (result.success) {
      this.onEvent({ type: "message-received", channelId: msg.channelId, message });
    } else {
      console.warn("Rejected message from", fromPeerId, ":", result.error);
    }
  }
  handleSyncRequest(fromPeerId, msg) {
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!workspace)
      return;
    const messageHistory = {};
    for (const channel of workspace.channels) {
      const messages = this.messageStore.getMessages(channel.id);
      if (messages.length > 0) {
        messageHistory[channel.id] = messages.map((message) => {
          const { content, ...safeMsg } = message;
          return safeMsg;
        });
      }
    }
    const response = {
      type: "sync-response",
      workspace,
      messageHistory
    };
    this.sendFn(fromPeerId, { type: "workspace-sync", sync: response });
  }
  async handleSyncResponse(msg) {
    this.workspaceManager.importWorkspace(msg.workspace);
    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.messageStore.importMessages(channelId, messages);
    }
    this.onEvent({ type: "sync-complete", workspaceId: msg.workspace.id });
  }
  handlePeerExchange(msg) {
    if (this.serverDiscovery && msg.servers) {
      this.serverDiscovery.mergeReceivedServers(msg.servers);
    }
  }
}

// src/huddle/BotHuddleManager.ts
import ndc from "node-datachannel";

// src/huddle/AudioPipeline.ts
import OpusScript from "opusscript";

class AudioPipeline {
  decoder;
  sampleRate;
  channels;
  frameDuration;
  vadThreshold;
  vadSilenceMs;
  onSpeechStart;
  onSpeechEnd;
  log;
  isSpeaking = false;
  pcmChunks = [];
  silenceStart = null;
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.channels = opts.channels ?? 1;
    this.frameDuration = opts.frameDuration ?? 20;
    this.vadThreshold = opts.vadThreshold ?? 0.02;
    this.vadSilenceMs = opts.vadSilenceMs ?? 500;
    this.onSpeechStart = opts.onSpeechStart;
    this.onSpeechEnd = opts.onSpeechEnd;
    this.log = opts.log;
    this.decoder = new OpusScript(this.sampleRate, this.channels, OpusScript.Application.AUDIO);
  }
  feedRtpPacket(buf) {
    const opusPayload = this.stripRtpHeader(buf);
    if (!opusPayload || opusPayload.length === 0)
      return;
    const pcm = this.decoder.decode(opusPayload);
    if (!pcm || pcm.length === 0)
      return;
    const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    const rms = this.computeRMS(samples);
    const now = Date.now();
    if (rms >= this.vadThreshold) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.log?.info(`[AudioPipeline] Speech started (RMS=${rms.toFixed(4)})`);
        this.onSpeechStart?.();
      }
      this.silenceStart = null;
      this.pcmChunks.push(pcmBuf);
    } else {
      if (this.isSpeaking) {
        this.pcmChunks.push(pcmBuf);
        if (this.silenceStart === null) {
          this.silenceStart = now;
        } else if (now - this.silenceStart >= this.vadSilenceMs) {
          this.log?.info(`[AudioPipeline] Speech ended after ${this.vadSilenceMs}ms silence`);
          const fullPcm = Buffer.concat(this.pcmChunks);
          this.isSpeaking = false;
          this.pcmChunks = [];
          this.silenceStart = null;
          this.onSpeechEnd?.(fullPcm);
        }
      }
    }
  }
  stripRtpHeader(buf) {
    if (buf.length < 12)
      return null;
    const byte0 = buf[0];
    const cc = byte0 & 15;
    const hasExtension = byte0 >> 4 & 1;
    const hasPadding = byte0 >> 5 & 1;
    let offset = 12 + cc * 4;
    if (offset > buf.length)
      return null;
    if (hasExtension) {
      if (offset + 4 > buf.length)
        return null;
      const extLength = buf.readUInt16BE(offset + 2);
      offset += 4 + extLength * 4;
    }
    if (offset > buf.length)
      return null;
    let payloadEnd = buf.length;
    if (hasPadding && buf.length > offset) {
      const paddingLength = buf[buf.length - 1];
      payloadEnd -= paddingLength;
    }
    if (payloadEnd <= offset)
      return null;
    return buf.subarray(offset, payloadEnd);
  }
  computeRMS(pcm) {
    if (pcm.length === 0)
      return 0;
    let sumSquares = 0;
    for (let i = 0;i < pcm.length; i++) {
      const normalized = pcm[i] / 32768;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / pcm.length);
  }
  reset() {
    this.isSpeaking = false;
    this.pcmChunks = [];
    this.silenceStart = null;
  }
  destroy() {
    this.reset();
    this.decoder.delete();
  }
}

// src/huddle/SpeechToText.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { randomBytes as randomBytes2 } from "crypto";
import { join as join2 } from "path";
import { tmpdir } from "os";
var execFileAsync = promisify(execFile);
var DEFAULT_MODEL = "base.en";
var DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
var UNSUPPORTED_GEMINI_MODELS = new Set([
  "gemini-2.0-flash"
]);
var MODEL_DIR = "/opt/homebrew/share/whisper-cpp/models";
var WHISPER_BIN = "whisper-cli";
var EXEC_TIMEOUT = 30000;

class SpeechToText {
  engine;
  modelPath;
  model;
  language;
  apiKey;
  log;
  constructor(opts) {
    this.engine = opts?.engine ?? "whisper-cpp";
    this.model = opts?.model ?? (this.engine === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_MODEL);
    if (this.engine === "gemini") {
      this.assertSupportedGeminiModel(this.model);
    }
    this.modelPath = join2(MODEL_DIR, `ggml-${this.model}.bin`);
    this.language = opts?.language;
    this.apiKey = opts?.apiKey;
    this.log = opts?.log;
  }
  async transcribe(pcmBuffer, sampleRate = 48000) {
    if (this.engine === "gemini") {
      return this.transcribeGemini(pcmBuffer, sampleRate);
    }
    if (this.engine === "openai" || this.engine === "groq") {
      return this.transcribeCloud(pcmBuffer, sampleRate);
    }
    return this.transcribeLocal(pcmBuffer, sampleRate);
  }
  async transcribeGemini(pcmBuffer, sampleRate) {
    const key = this.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    if (!key) {
      this.log?.warn?.("[STT] No API key for gemini — set GEMINI_API_KEY or GOOGLE_API_KEY");
      return "";
    }
    const model = this.model || DEFAULT_GEMINI_MODEL;
    this.assertSupportedGeminiModel(model);
    const wavBuffer = this.createWavBuffer(pcmBuffer, sampleRate);
    const audioB64 = wavBuffer.toString("base64");
    const duration = (pcmBuffer.length / 2 / sampleRate).toFixed(1);
    this.log?.info(`[STT] gemini transcribe: ${duration}s audio, model=${model}${this.language ? ", lang=" + this.language : ""}`);
    const start = Date.now();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            {
              text: this.language ? `Transcribe this audio to plain text only. Language: ${this.language}. Do not add commentary.` : "Transcribe this audio to plain text only. Do not add commentary."
            },
            {
              inlineData: {
                mimeType: "audio/wav",
                data: audioB64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0
        }
      })
    });
    const elapsed = Date.now() - start;
    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      this.log?.warn?.(`[STT] gemini error ${response.status}: ${err}`);
      return "";
    }
    const payload = await response.json().catch(() => ({}));
    const text = this.extractGeminiText(payload).trim();
    this.log?.info(`[STT] gemini transcribed in ${elapsed}ms: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    return text;
  }
  async transcribeCloud(pcmBuffer, sampleRate) {
    const wavBuffer = this.createWavBuffer(pcmBuffer, sampleRate);
    const duration = (pcmBuffer.length / 2 / sampleRate).toFixed(1);
    const isGroq = this.engine === "groq";
    const baseUrl = isGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
    const isCloudModel = this.model.includes("whisper");
    const model = isGroq ? isCloudModel ? this.model : "whisper-large-v3-turbo" : isCloudModel ? this.model : "whisper-1";
    const key = this.apiKey ?? (isGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY) ?? "";
    if (!key) {
      this.log?.warn?.(`[STT] No API key for ${this.engine} — set ${isGroq ? "GROQ_API_KEY" : "OPENAI_API_KEY"}`);
      return "";
    }
    this.log?.info(`[STT] ${this.engine} transcribe: ${duration}s audio, model=${model}${this.language ? ", lang=" + this.language : ""}`);
    const start = Date.now();
    const boundary = "----STTBoundary" + randomBytes2(8).toString("hex");
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="file"; filename="audio.wav"\r
Content-Type: audio/wav\r
\r
`));
    parts.push(wavBuffer);
    parts.push(Buffer.from(`\r
`));
    parts.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="model"\r
\r
${model}\r
`));
    if (this.language) {
      parts.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="language"\r
\r
${this.language}\r
`));
    }
    parts.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="response_format"\r
\r
text\r
`));
    parts.push(Buffer.from(`--${boundary}--\r
`));
    const body = Buffer.concat(parts);
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const elapsed = Date.now() - start;
    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      this.log?.warn?.(`[STT] ${this.engine} error ${response.status}: ${err}`);
      return "";
    }
    const text = (await response.text()).trim();
    this.log?.info(`[STT] ${this.engine} transcribed in ${elapsed}ms: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    return text;
  }
  extractGeminiText(payload) {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    const parts = candidates.flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []);
    return parts.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join(`
`).trim();
  }
  assertSupportedGeminiModel(model) {
    const normalizedModel = model.trim().toLowerCase();
    if (!UNSUPPORTED_GEMINI_MODELS.has(normalizedModel))
      return;
    throw new Error(`[STT] Gemini model "${model}" is no longer supported for new users. Use "${DEFAULT_GEMINI_MODEL}" or another currently supported Gemini STT model.`);
  }
  async transcribeLocal(pcmBuffer, sampleRate) {
    const id = randomBytes2(6).toString("hex");
    const tmp = tmpdir();
    const inputWav = join2(tmp, `stt-${id}.wav`);
    const resampledWav = join2(tmp, `stt-${id}-16k.wav`);
    const outputBase = join2(tmp, `stt-${id}-out`);
    const outputTxt = `${outputBase}.txt`;
    const tempFiles = [inputWav, resampledWav, outputTxt];
    try {
      const wavBuffer = this.createWavBuffer(pcmBuffer, sampleRate);
      await writeFile(inputWav, wavBuffer);
      this.log?.info(`[STT] Wrote ${wavBuffer.length} bytes WAV → ${inputWav}`);
      await execFileAsync("ffmpeg", [
        "-i",
        inputWav,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        resampledWav
      ], { timeout: EXEC_TIMEOUT });
      this.log?.info(`[STT] Resampled to 16 kHz → ${resampledWav}`);
      const args = [
        "--model",
        this.modelPath,
        "--output-txt",
        "--output-file",
        outputBase,
        "--no-timestamps"
      ];
      if (this.language) {
        args.push("--language", this.language);
      }
      args.push(resampledWav);
      this.log?.info(`[STT] whisper-cli args: ${args.join(" ")}`);
      await execFileAsync(WHISPER_BIN, args, { timeout: EXEC_TIMEOUT });
      this.log?.info(`[STT] whisper-cli finished`);
      const text = await readFile(outputTxt, "utf-8");
      return text.trim();
    } finally {
      await Promise.all(tempFiles.map((f) => unlink(f).catch(() => {})));
      this.log?.info(`[STT] Cleaned up temp files`);
    }
  }
  createWavBuffer(pcm, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcm.length;
    const headerSize = 44;
    const header = Buffer.alloc(headerSize);
    let offset = 0;
    header.write("RIFF", offset);
    offset += 4;
    header.writeUInt32LE(dataSize + headerSize - 8, offset);
    offset += 4;
    header.write("WAVE", offset);
    offset += 4;
    header.write("fmt ", offset);
    offset += 4;
    header.writeUInt32LE(16, offset);
    offset += 4;
    header.writeUInt16LE(1, offset);
    offset += 2;
    header.writeUInt16LE(numChannels, offset);
    offset += 2;
    header.writeUInt32LE(sampleRate, offset);
    offset += 4;
    header.writeUInt32LE(byteRate, offset);
    offset += 4;
    header.writeUInt16LE(blockAlign, offset);
    offset += 2;
    header.writeUInt16LE(bitsPerSample, offset);
    offset += 2;
    header.write("data", offset);
    offset += 4;
    header.writeUInt32LE(dataSize, offset);
    offset += 4;
    return Buffer.concat([header, pcm]);
  }
}

// src/huddle/TextToSpeech.ts
import OpusScript2 from "opusscript";
var DEFAULT_PROVIDER = "elevenlabs";
var DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
var DEFAULT_MODEL2 = "eleven_turbo_v2_5";
var DEFAULT_GEMINI_MODEL2 = "gemini-2.5-flash-preview-tts";
var DEFAULT_SAMPLE_RATE = 48000;
var ELEVENLABS_PCM_RATE = 24000;
var FRAME_DURATION_MS = 20;
var OPUS_PT = 111;
var DEFAULT_SSRC = 1234;

class TextToSpeech {
  provider;
  apiKey;
  voiceId;
  model;
  language;
  sampleRate;
  log;
  encoder;
  constructor(opts) {
    this.provider = opts.provider ?? DEFAULT_PROVIDER;
    this.apiKey = opts.apiKey;
    this.voiceId = opts.voiceId ?? (this.provider === "gemini" ? "Kore" : DEFAULT_VOICE_ID);
    this.model = opts.model ?? (this.provider === "gemini" ? DEFAULT_GEMINI_MODEL2 : DEFAULT_MODEL2);
    this.language = opts.language;
    this.sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.log = opts.log;
    this.encoder = new OpusScript2(this.sampleRate, 2, OpusScript2.Application.AUDIO);
  }
  async speak(text) {
    this.log?.info(`TTS: synthesizing "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    const { pcm, sampleRate } = await this.fetchPcmFromProvider(text);
    this.log?.info(`TTS: received ${pcm.length} bytes of PCM @ ${sampleRate}Hz (${this.provider})`);
    const pcmEven = pcm.length % 2 !== 0 ? pcm.subarray(0, pcm.length - 1) : pcm;
    const pcm48k = this.resample(pcmEven, sampleRate, this.sampleRate);
    this.log?.info(`TTS: resampled to ${pcm48k.length} bytes @ ${this.sampleRate}Hz`);
    const samplesPerFrame = this.sampleRate * FRAME_DURATION_MS / 1000;
    const bytesPerFrame = samplesPerFrame * 2;
    const packets = [];
    let seq = 0;
    let timestamp = 0;
    for (let offset = 0;offset + bytesPerFrame <= pcm48k.length; offset += bytesPerFrame) {
      const pcmFrame = pcm48k.subarray(offset, offset + bytesPerFrame);
      const stereoPcm = Buffer.alloc(pcmFrame.length * 2);
      for (let i = 0;i < samplesPerFrame; i++) {
        const sample = pcmFrame.readInt16LE(i * 2);
        stereoPcm.writeInt16LE(sample, i * 4);
        stereoPcm.writeInt16LE(sample, i * 4 + 2);
      }
      const opusFrame = this.encoder.encode(stereoPcm, samplesPerFrame);
      const rtpPacket = this.createRtpPacket(Buffer.from(opusFrame), seq, timestamp, DEFAULT_SSRC, OPUS_PT, seq === 0);
      packets.push(rtpPacket);
      seq++;
      timestamp += samplesPerFrame;
    }
    this.log?.info(`TTS: encoded ${packets.length} RTP packets (${(packets.length * FRAME_DURATION_MS / 1000).toFixed(1)}s)`);
    return packets;
  }
  async speakRaw(text) {
    this.log?.info(`TTS: synthesizing (raw) "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    const { pcm, sampleRate } = await this.fetchPcmFromProvider(text);
    this.log?.info(`TTS: received ${pcm.length} bytes of PCM @ ${sampleRate}Hz (${this.provider})`);
    if (!pcm || pcm.length === 0)
      return [];
    const pcmEven = pcm.length % 2 !== 0 ? pcm.subarray(0, pcm.length - 1) : pcm;
    const pcm48k = this.resample(pcmEven, sampleRate, this.sampleRate);
    this.log?.info(`TTS: resampled to ${pcm48k.length} bytes @ ${this.sampleRate}Hz (raw mode)`);
    const samplesPerFrame = this.sampleRate * FRAME_DURATION_MS / 1000;
    const bytesPerFrame = samplesPerFrame * 2;
    const frames = [];
    const OpusScript3 = (await import("opusscript")).default;
    const freshEncoder = new OpusScript3(this.sampleRate, 2, OpusScript3.Application.AUDIO);
    for (let offset = 0;offset + bytesPerFrame <= pcm48k.length; offset += bytesPerFrame) {
      const pcmFrame = pcm48k.subarray(offset, offset + bytesPerFrame);
      const stereoPcm = Buffer.alloc(pcmFrame.length * 2);
      for (let i = 0;i < samplesPerFrame; i++) {
        const sample = pcmFrame.readInt16LE(i * 2);
        stereoPcm.writeInt16LE(sample, i * 4);
        stereoPcm.writeInt16LE(sample, i * 4 + 2);
      }
      const opusFrame = freshEncoder.encode(stereoPcm, samplesPerFrame);
      frames.push(Buffer.from(opusFrame));
    }
    freshEncoder.delete();
    this.log?.info(`TTS: encoded ${frames.length} raw Opus frames (${(frames.length * FRAME_DURATION_MS / 1000).toFixed(1)}s)`);
    try {
      const fs = await import("fs");
      fs.writeFileSync("/tmp/tts_debug_pcm48k.raw", pcm48k);
      fs.writeFileSync("/tmp/tts_debug_frames.json", JSON.stringify(frames.map((f) => Buffer.from(f).toString("base64"))));
      this.log?.info(`TTS: DIAG dumped ${pcm48k.length}b PCM + ${frames.length} frames to /tmp/tts_debug_*`);
    } catch {}
    return frames;
  }
  async fetchPcmFromProvider(text) {
    if (this.provider === "gemini") {
      return this.fetchPcmFromGemini(text);
    }
    const pcm = await this.fetchPcmFromElevenLabs(text);
    return { pcm, sampleRate: ELEVENLABS_PCM_RATE };
  }
  async fetchPcmFromGemini(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceId || "Kore"
              }
            }
          }
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Gemini TTS API error ${response.status}: ${errorText}`);
    }
    const payload = await response.json().catch(() => ({}));
    const audioPart = this.extractGeminiAudioPart(payload);
    if (!audioPart?.data) {
      throw new Error("Gemini TTS response did not include inline audio data");
    }
    const rawAudio = Buffer.from(audioPart.data, "base64");
    const mimeType = (audioPart.mimeType ?? "").toLowerCase();
    if (mimeType.includes("wav")) {
      return this.extractWavPcm(rawAudio);
    }
    return {
      pcm: rawAudio,
      sampleRate: ELEVENLABS_PCM_RATE
    };
  }
  extractGeminiAudioPart(payload) {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const inline = part?.inlineData ?? part?.inline_data;
        const data = typeof inline?.data === "string" ? inline.data : undefined;
        const mimeType = typeof inline?.mimeType === "string" ? inline.mimeType : typeof inline?.mime_type === "string" ? inline.mime_type : undefined;
        if (data)
          return { data, mimeType };
      }
    }
    return;
  }
  extractWavPcm(wav) {
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
      return { pcm: wav, sampleRate: ELEVENLABS_PCM_RATE };
    }
    let offset = 12;
    let sampleRate = ELEVENLABS_PCM_RATE;
    let channels = 1;
    let bitsPerSample = 16;
    let dataChunkStart = -1;
    let dataChunkLength = 0;
    while (offset + 8 <= wav.length) {
      const chunkId = wav.toString("ascii", offset, offset + 4);
      const chunkSize = wav.readUInt32LE(offset + 4);
      const chunkDataStart = offset + 8;
      const nextChunk = chunkDataStart + chunkSize + chunkSize % 2;
      if (nextChunk > wav.length)
        break;
      if (chunkId === "fmt " && chunkSize >= 16) {
        channels = wav.readUInt16LE(chunkDataStart + 2);
        sampleRate = wav.readUInt32LE(chunkDataStart + 4);
        bitsPerSample = wav.readUInt16LE(chunkDataStart + 14);
      } else if (chunkId === "data") {
        dataChunkStart = chunkDataStart;
        dataChunkLength = chunkSize;
        break;
      }
      offset = nextChunk;
    }
    if (dataChunkStart < 0 || bitsPerSample !== 16) {
      return { pcm: wav, sampleRate: ELEVENLABS_PCM_RATE };
    }
    const pcm = wav.subarray(dataChunkStart, Math.min(dataChunkStart + dataChunkLength, wav.length));
    if (channels <= 1) {
      return { pcm, sampleRate };
    }
    return {
      pcm: this.downmixPcm16ToMono(pcm, channels),
      sampleRate
    };
  }
  downmixPcm16ToMono(interleavedPcm, channels) {
    if (channels <= 1)
      return interleavedPcm;
    const frameBytes = channels * 2;
    const frameCount = Math.floor(interleavedPcm.length / frameBytes);
    const mono = Buffer.alloc(frameCount * 2);
    for (let i = 0;i < frameCount; i++) {
      let sum = 0;
      for (let ch = 0;ch < channels; ch++) {
        sum += interleavedPcm.readInt16LE(i * frameBytes + ch * 2);
      }
      const averaged = Math.round(sum / channels);
      mono.writeInt16LE(Math.max(-32768, Math.min(32767, averaged)), i * 2);
    }
    return mono;
  }
  async fetchPcmFromElevenLabs(text) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=pcm_24000`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        ...this.language ? { language_code: this.language } : {}
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
    }
    const chunks = [];
    const reader = response.body?.getReader();
    if (!reader)
      throw new Error("No response body from ElevenLabs");
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value)
        chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = Buffer.alloc(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }
    return result;
  }
  resample(input, fromRate, toRate) {
    if (fromRate === toRate)
      return input;
    const safeInput = input.length % 2 !== 0 ? input.subarray(0, input.length - 1) : input;
    const inputSamples = safeInput.length / 2;
    const ratio = fromRate / toRate;
    const outputSamples = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputSamples * 2);
    for (let i = 0;i < outputSamples; i++) {
      const srcPos = i * ratio;
      const srcIndex = Math.floor(srcPos);
      const frac = srcPos - srcIndex;
      const s0 = safeInput.readInt16LE(srcIndex * 2);
      const s1 = srcIndex + 1 < inputSamples ? safeInput.readInt16LE((srcIndex + 1) * 2) : s0;
      const interpolated = Math.round(s0 + frac * (s1 - s0));
      const clamped = Math.max(-32768, Math.min(32767, interpolated));
      output.writeInt16LE(clamped, i * 2);
    }
    return output;
  }
  createRtpPacket(payload, seq, timestamp, ssrc, pt, marker = false) {
    const header = Buffer.alloc(12);
    header[0] = 128;
    header[1] = (marker ? 128 : 0) | pt & 127;
    header.writeUInt16BE(seq & 65535, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(ssrc >>> 0, 8);
    return Buffer.concat([header, payload]);
  }
  destroy() {
    try {
      this.encoder.delete();
    } catch {}
  }
}

// src/huddle/BotHuddleManager.ts
class BotHuddleManager {
  state = "inactive";
  activeChannelId = null;
  myPeerId;
  callbacks;
  participants = new Map;
  autoJoin;
  peerConnections = new Map;
  audioTracks = new Map;
  sendTracks = new Map;
  audioPipeline;
  stt;
  tts = null;
  ttsFallback = null;
  currentSpeakerPeerId = null;
  isProcessing = false;
  abortSending = false;
  constructor(myPeerId, callbacks, opts) {
    this.myPeerId = myPeerId;
    this.callbacks = callbacks;
    this.autoJoin = opts?.autoJoin ?? true;
    this.audioPipeline = new AudioPipeline({
      sampleRate: 48000,
      channels: 1,
      vadThreshold: opts?.vadThreshold ?? 0.02,
      vadSilenceMs: opts?.vadSilenceMs ?? 500,
      onSpeechStart: () => {
        if (this.isProcessing) {
          this.log("info", "[bot-huddle] barge-in detected — aborting current response");
          this.abortSending = true;
          this.emitStatus("interrupted");
        } else {
          this.emitStatus("hearing");
        }
      },
      onSpeechEnd: (pcm) => this.handleSpeechEnd(pcm),
      log: callbacks.log
    });
    const sttEngine = opts?.sttEngine ?? "whisper-cpp";
    this.stt = new SpeechToText({
      engine: sttEngine,
      model: opts?.whisperModel ?? (sttEngine === "gemini" ? undefined : "medium"),
      language: opts?.sttLanguage,
      apiKey: opts?.sttApiKey,
      log: callbacks.log
    });
    const preferredTtsEngine = opts?.ttsEngine ?? (opts?.sttEngine === "gemini" ? "gemini" : "elevenlabs");
    const geminiKey = opts?.ttsApiKey ?? opts?.sttApiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (preferredTtsEngine === "gemini") {
      if (geminiKey) {
        this.tts = this.createGeminiTts(geminiKey, opts);
      } else {
        this.log("warn", "[bot-huddle] Gemini TTS selected but no GEMINI_API_KEY/GOOGLE_API_KEY/sttApiKey/ttsApiKey configured");
      }
      if (elevenLabsKey) {
        if (this.tts) {
          this.ttsFallback = this.createElevenLabsTts(elevenLabsKey, opts);
        } else {
          this.tts = this.createElevenLabsTts(elevenLabsKey, opts);
        }
      }
    } else {
      if (elevenLabsKey) {
        this.tts = this.createElevenLabsTts(elevenLabsKey, opts);
      } else {
        this.log("warn", "[bot-huddle] ELEVENLABS_API_KEY not set — ElevenLabs TTS unavailable");
      }
      if (geminiKey) {
        if (this.tts) {
          this.ttsFallback = this.createGeminiTts(geminiKey, opts);
        } else {
          this.tts = this.createGeminiTts(geminiKey, opts);
        }
      }
    }
    if (!this.tts) {
      this.log("warn", "[bot-huddle] TTS disabled (no usable engine/key found)");
    }
  }
  getState() {
    return this.state;
  }
  getActiveChannelId() {
    return this.activeChannelId;
  }
  getParticipants() {
    return Array.from(this.participants.values());
  }
  async handleSignal(fromPeerId, data) {
    const type = data?.type;
    if (!type)
      return;
    switch (type) {
      case "huddle-announce":
        this.handleAnnounce(fromPeerId, data);
        break;
      case "huddle-join":
        this.handleJoin(fromPeerId, data);
        break;
      case "huddle-leave":
        this.handleLeave(fromPeerId, data);
        break;
      case "huddle-offer":
        this.handleOffer(fromPeerId, data);
        break;
      case "huddle-answer":
        this.handleAnswer(fromPeerId, data);
        break;
      case "huddle-ice":
        this.handleIce(fromPeerId, data);
        break;
      case "huddle-stats":
        this.log("info", `[bot-huddle] stats from ${fromPeerId.slice(0, 8)}: ${JSON.stringify(data.stats).slice(0, 200)}`);
        break;
      case "huddle-mute":
        this.handleMute(fromPeerId, data);
        break;
      default:
        this.log("warn", `[bot-huddle] unknown huddle signal: ${type}`);
    }
  }
  join(channelId) {
    if (this.state === "in-call")
      return;
    this.activeChannelId = channelId;
    this.state = "in-call";
    this.callbacks.broadcastSignal({
      type: "huddle-join",
      channelId,
      peerId: this.myPeerId
    });
    this.log("info", `[bot-huddle] joined huddle in ${channelId}`);
    this.emitStatus("listening");
  }
  leave() {
    if (this.state === "inactive")
      return;
    const channelId = this.activeChannelId;
    for (const [peerId] of this.peerConnections) {
      this.cleanupPeer(peerId);
    }
    this.participants.clear();
    this.state = "inactive";
    this.activeChannelId = null;
    this.audioPipeline.reset();
    if (channelId) {
      this.callbacks.broadcastSignal({
        type: "huddle-leave",
        channelId,
        peerId: this.myPeerId
      });
    }
    this.log("info", `[bot-huddle] left huddle in ${channelId ?? "(none)"}`);
  }
  handleAnnounce(fromPeerId, data) {
    const channelId = data.channelId;
    this.log("info", `[bot-huddle] huddle-announce from ${fromPeerId} in ${channelId}`);
    this.participants.set(fromPeerId, {
      peerId: fromPeerId,
      displayName: this.callbacks.getDisplayName(fromPeerId),
      muted: false
    });
    if (this.autoJoin && this.state === "inactive") {
      this.activeChannelId = channelId;
      this.state = "in-call";
      this.callbacks.broadcastSignal({
        type: "huddle-join",
        channelId,
        peerId: this.myPeerId
      });
      this.log("info", `[bot-huddle] auto-joined huddle in ${channelId}`);
      this.emitStatus("listening");
    } else if (this.state === "in-call" && this.activeChannelId === channelId) {
      this.log("info", `[bot-huddle] already in-call, notifying announcer ${fromPeerId}`);
      this.callbacks.sendSignal(fromPeerId, {
        type: "huddle-join",
        channelId,
        peerId: this.myPeerId
      });
    }
  }
  handleJoin(fromPeerId, data) {
    const channelId = data.channelId;
    this.log("info", `[bot-huddle] huddle-join from ${fromPeerId} in ${channelId}`);
    this.participants.set(fromPeerId, {
      peerId: fromPeerId,
      displayName: this.callbacks.getDisplayName(fromPeerId),
      muted: false
    });
    if (this.state === "in-call" && this.activeChannelId === channelId) {
      this.log("info", `[bot-huddle] notifying new peer ${fromPeerId} of our presence`);
      this.callbacks.sendSignal(fromPeerId, {
        type: "huddle-join",
        channelId,
        peerId: this.myPeerId
      });
    }
  }
  handleLeave(fromPeerId, data) {
    const channelId = data.channelId;
    this.log("info", `[bot-huddle] huddle-leave from ${fromPeerId} in ${channelId}`);
    this.participants.delete(fromPeerId);
    this.cleanupPeer(fromPeerId);
    if (this.state === "in-call" && this.participants.size === 0) {
      this.state = "inactive";
      this.activeChannelId = null;
      this.audioPipeline.reset();
      this.log("info", `[bot-huddle] all participants left, going inactive`);
    }
  }
  handleOffer(fromPeerId, data) {
    this.log("info", `[bot-huddle] received offer from ${fromPeerId}`);
    this.cleanupPeer(fromPeerId);
    try {
      const pc = new ndc.PeerConnection("bot-huddle", {
        iceServers: ["stun:stun.l.google.com:19302"]
      });
      const peerState = { pc, track: null };
      this.peerConnections.set(fromPeerId, peerState);
      const offerSdp = typeof data.sdp === "object" ? data.sdp.sdp : data.sdp;
      const opusPt = this.extractOpusPayloadType(offerSdp);
      this.log("info", `[bot-huddle] browser Opus PT = ${opusPt}`);
      const audio = new ndc.Audio("0", "SendRecv");
      audio.addOpusCodec(opusPt);
      audio.addSSRC(1234, "bot-audio", "bot-stream", "audio-track");
      const track = pc.addTrack(audio);
      const rtpCfg = new ndc.RtpPacketizationConfig(1234, "bot-audio", opusPt, 48000);
      const srReporter = new ndc.RtcpSrReporter(rtpCfg);
      srReporter.addToChain(new ndc.RtcpReceivingSession);
      track.setMediaHandler(srReporter);
      const manualRtp = {
        ssrc: 1234,
        payloadType: opusPt,
        sequenceNumber: Math.floor(Math.random() * 65535),
        timestamp: Math.floor(Math.random() * 4294967295)
      };
      peerState.rtpConfig = manualRtp;
      peerState.track = track;
      this.audioTracks.set(fromPeerId, track);
      this.sendTracks.set(fromPeerId, track);
      let msgCount = 0;
      track.onMessage((buf) => {
        const copy = Buffer.from(buf);
        msgCount++;
        const n = msgCount;
        setImmediate(() => {
          try {
            if (n <= 3 || n % 500 === 0) {
              this.log("info", `[bot-huddle] track.onMessage #${n} from ${fromPeerId}, ${copy.length} bytes`);
            }
            this.currentSpeakerPeerId = fromPeerId;
            this.audioPipeline.feedRtpPacket(copy);
          } catch (err) {
            this.log("error", `[bot-huddle] feedRtpPacket error: ${String(err)}`);
          }
        });
      });
      track.onOpen(() => {
        this.log("info", `[bot-huddle] audio track opened for ${fromPeerId}`);
        this.sendTracks.set(fromPeerId, track);
      });
      track.onClosed(() => {
        this.log("info", `[bot-huddle] audio track closed for ${fromPeerId}`);
      });
      track.onError((err) => {
        this.log("error", `[bot-huddle] audio track error for ${fromPeerId}: ${err}`);
      });
      pc.onLocalDescription((sdp, type) => {
        const lowerType = type.toLowerCase();
        this.log("info", `[bot-huddle] onLocalDescription type=${lowerType} for ${fromPeerId} (${sdp.length} chars)
${sdp}`);
        if (lowerType !== "answer") {
          this.log("warn", `[bot-huddle] unexpected non-answer SDP (type=${lowerType}), ignoring`);
          return;
        }
        this.callbacks.sendSignal(fromPeerId, {
          type: "huddle-answer",
          sdp: { sdp, type: lowerType },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId
        });
      });
      pc.onLocalCandidate((candidate, mid) => {
        this.callbacks.sendSignal(fromPeerId, {
          type: "huddle-ice",
          candidate: { candidate, sdpMid: mid },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId
        });
      });
      pc.onStateChange((state) => {
        this.log("info", `[bot-huddle] PC state for ${fromPeerId}: ${state}`);
        if (state === "disconnected" || state === "failed" || state === "closed") {
          this.cleanupPeer(fromPeerId);
        }
      });
      let sdpString;
      let sdpType;
      if (typeof data.sdp === "object" && data.sdp !== null) {
        sdpString = data.sdp.sdp;
        sdpType = data.sdp.type || "offer";
      } else if (typeof data.sdp === "string") {
        sdpString = data.sdp;
        sdpType = "offer";
      } else {
        this.log("error", `[bot-huddle] invalid SDP in offer from ${fromPeerId}`);
        return;
      }
      const normalizedType = sdpType.charAt(0).toUpperCase() + sdpType.slice(1).toLowerCase();
      this.log("info", `[bot-huddle] setting remote description (type=${normalizedType}, sdp=${sdpString.length} chars)
${sdpString}`);
      pc.setRemoteDescription(sdpString, normalizedType);
    } catch (err) {
      this.log("error", `[bot-huddle] failed to handle offer from ${fromPeerId}: ${String(err)}`);
      this.cleanupPeer(fromPeerId);
    }
  }
  handleAnswer(fromPeerId, data) {
    this.log("info", `[bot-huddle] received answer from ${fromPeerId}`);
    const peerState = this.peerConnections.get(fromPeerId);
    if (!peerState) {
      this.log("warn", `[bot-huddle] no PC found for answer from ${fromPeerId}`);
      return;
    }
    try {
      let sdpString;
      let sdpType;
      if (typeof data.sdp === "object" && data.sdp !== null) {
        sdpString = data.sdp.sdp;
        sdpType = data.sdp.type || "answer";
      } else if (typeof data.sdp === "string") {
        sdpString = data.sdp;
        sdpType = "answer";
      } else {
        this.log("error", `[bot-huddle] invalid SDP in answer from ${fromPeerId}`);
        return;
      }
      const normalizedType = sdpType.charAt(0).toUpperCase() + sdpType.slice(1).toLowerCase();
      peerState.pc.setRemoteDescription(sdpString, normalizedType);
    } catch (err) {
      this.log("error", `[bot-huddle] failed to set answer from ${fromPeerId}: ${String(err)}`);
    }
  }
  handleIce(fromPeerId, data) {
    const peerState = this.peerConnections.get(fromPeerId);
    if (!peerState) {
      this.log("warn", `[bot-huddle] no PC found for ICE from ${fromPeerId}`);
      return;
    }
    try {
      let candidateStr;
      let mid;
      if (typeof data.candidate === "object" && data.candidate !== null) {
        candidateStr = data.candidate.candidate;
        mid = data.candidate.sdpMid ?? "0";
      } else if (typeof data.candidate === "string") {
        candidateStr = data.candidate;
        mid = data.sdpMid ?? "0";
      } else {
        this.log("warn", `[bot-huddle] invalid ICE candidate from ${fromPeerId}`);
        return;
      }
      peerState.pc.addRemoteCandidate(candidateStr, mid);
    } catch (err) {
      this.log("error", `[bot-huddle] failed to add ICE from ${fromPeerId}: ${String(err)}`);
    }
  }
  handleMute(fromPeerId, data) {
    const muted = data.muted;
    const participant = this.participants.get(fromPeerId);
    if (participant) {
      participant.muted = muted;
      this.participants.set(fromPeerId, participant);
      this.log("info", `[bot-huddle] ${fromPeerId} ${muted ? "muted" : "unmuted"}`);
    }
  }
  initiateConnectionTo(peerId) {
    const existing = this.peerConnections.get(peerId);
    if (existing) {
      this.log("info", `[bot-huddle] already have PC for ${peerId}, skipping initiation`);
      return;
    }
    this.log("info", `[bot-huddle] initiating WebRTC connection to ${peerId}`);
    try {
      const pc = new ndc.PeerConnection("bot-huddle-init", {
        iceServers: ["stun:stun.l.google.com:19302"]
      });
      const peerState = { pc, track: null };
      this.peerConnections.set(peerId, peerState);
      const opusPt = 111;
      const audio = new ndc.Audio("0", "SendRecv");
      audio.addOpusCodec(opusPt);
      audio.addSSRC(1234, "bot-audio", "bot-stream", "audio-track");
      const track = pc.addTrack(audio);
      const rtpCfg = new ndc.RtpPacketizationConfig(1234, "bot-audio", opusPt, 48000);
      const srReporter = new ndc.RtcpSrReporter(rtpCfg);
      srReporter.addToChain(new ndc.RtcpReceivingSession);
      track.setMediaHandler(srReporter);
      const manualRtp = {
        ssrc: 1234,
        payloadType: opusPt,
        sequenceNumber: Math.floor(Math.random() * 65535),
        timestamp: Math.floor(Math.random() * 4294967295)
      };
      peerState.rtpConfig = manualRtp;
      peerState.track = track;
      this.audioTracks.set(peerId, track);
      this.sendTracks.set(peerId, track);
      let msgCount = 0;
      track.onMessage((buf) => {
        const copy = Buffer.from(buf);
        msgCount++;
        const n = msgCount;
        setImmediate(() => {
          try {
            if (n <= 3 || n % 500 === 0) {
              this.log("info", `[bot-huddle] track.onMessage #${n} from ${peerId}, ${copy.length} bytes`);
            }
            this.currentSpeakerPeerId = peerId;
            this.audioPipeline.feedRtpPacket(copy);
          } catch (err) {
            this.log("error", `[bot-huddle] feedRtpPacket error: ${String(err)}`);
          }
        });
      });
      track.onOpen(() => {
        this.log("info", `[bot-huddle] audio track opened for ${peerId} (initiated)`);
        this.sendTracks.set(peerId, track);
      });
      track.onClosed(() => {
        this.log("info", `[bot-huddle] audio track closed for ${peerId} (initiated)`);
      });
      track.onError((err) => {
        this.log("error", `[bot-huddle] audio track error for ${peerId}: ${err}`);
      });
      pc.onLocalDescription((sdp, type) => {
        const lowerType = type.toLowerCase();
        this.log("info", `[bot-huddle] onLocalDescription (initiate) type=${lowerType} for ${peerId} (${sdp.length} chars)`);
        if (lowerType !== "offer") {
          this.log("info", `[bot-huddle] ignoring non-offer SDP (type=${lowerType}) during initiation`);
          return;
        }
        this.callbacks.sendSignal(peerId, {
          type: "huddle-offer",
          sdp: { sdp, type: lowerType },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId
        });
      });
      pc.onLocalCandidate((candidate, mid) => {
        this.callbacks.sendSignal(peerId, {
          type: "huddle-ice",
          candidate: { candidate, sdpMid: mid },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId
        });
      });
      pc.onStateChange((state) => {
        this.log("info", `[bot-huddle] PC state (initiated) for ${peerId}: ${state}`);
        if (state === "connected") {
          this.log("info", `[bot-huddle] WebRTC connected to ${peerId} (bot-initiated)`);
        } else if (state === "disconnected" || state === "failed" || state === "closed") {
          this.cleanupPeer(peerId);
        }
      });
      pc.setLocalDescription();
    } catch (err) {
      this.log("error", `[bot-huddle] failed to initiate connection to ${peerId}: ${String(err)}`);
      this.cleanupPeer(peerId);
    }
  }
  async handleSpeechEnd(pcm) {
    if (this.isProcessing) {
      this.log("info", "[bot-huddle] already processing speech, skipping");
      return;
    }
    this.isProcessing = true;
    this.abortSending = false;
    const speakerPeerId = this.currentSpeakerPeerId ?? "unknown";
    const channelId = this.activeChannelId ?? "";
    const pipelineStart = Date.now();
    try {
      this.emitStatus("transcribing");
      const sttStart = Date.now();
      const text = await this.stt.transcribe(pcm, 48000);
      const sttMs = Date.now() - sttStart;
      if (!text || text.length < 2) {
        this.log("info", "[bot-huddle] STT returned empty/noise, skipping");
        return;
      }
      this.log("info", `[bot-huddle] heard from ${speakerPeerId.slice(0, 8)}: "${text}" (STT: ${sttMs}ms)`);
      this.emitStatus("thinking");
      const llmStart = Date.now();
      let response;
      try {
        response = await this.callbacks.onTranscription?.(text, speakerPeerId, channelId);
      } catch (llmErr) {
        this.log("error", `[bot-huddle] LLM call failed: ${String(llmErr)}`);
      }
      if (!response) {
        response = `I heard you say: ${text}`;
        this.log("info", `[bot-huddle] LLM unavailable, using echo response`);
      }
      const llmMs = Date.now() - llmStart;
      const speakableText = response.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
      if (speakableText.length < 3) {
        this.log("info", `[bot-huddle] response too short for TTS ("${response}"), skipping`);
        return;
      }
      this.log("info", `[bot-huddle] responding (LLM: ${llmMs}ms): "${response.slice(0, 100)}${response.length > 100 ? "..." : ""}"`);
      if (!this.tts) {
        this.log("warn", "[bot-huddle] TTS not available");
        return;
      }
      const sentences = this.splitIntoSentences(speakableText);
      this.log("info", `[bot-huddle] streaming ${sentences.length} sentence(s)`);
      this.emitStatus("speaking");
      const ttsStart = Date.now();
      let totalFrames = 0;
      for (const sentence of sentences) {
        if (sentence.length < 2)
          continue;
        if (this.abortSending) {
          this.log("info", `[bot-huddle] barge-in: stopped after ${totalFrames} frames`);
          break;
        }
        const frames = await this.speakWithFallback(sentence);
        totalFrames += frames.length;
        if (this.abortSending) {
          this.log("info", `[bot-huddle] barge-in: skipping send after TTS`);
          break;
        }
        await this.sendFramesToAllPeers(frames, totalFrames === frames.length);
      }
      const ttsMs = Date.now() - ttsStart;
      const totalMs = Date.now() - pipelineStart;
      this.log("info", `[bot-huddle] pipeline done: STT=${sttMs}ms LLM=${llmMs}ms TTS+send=${ttsMs}ms total=${totalMs}ms (${totalFrames} frames, ${(totalFrames * 0.02).toFixed(1)}s audio)`);
    } catch (err) {
      this.log("error", `[bot-huddle] voice pipeline error: ${String(err)}`);
    } finally {
      this.isProcessing = false;
      this.abortSending = false;
      this.emitStatus("listening");
    }
  }
  splitIntoSentences(text) {
    const raw = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
    const sentences = [];
    let buffer = "";
    for (const s of raw) {
      buffer += s;
      if (buffer.length >= 60 || s === raw[raw.length - 1]) {
        sentences.push(buffer.trim());
        buffer = "";
      }
    }
    if (buffer.trim())
      sentences.push(buffer.trim());
    return sentences;
  }
  async sendFramesToAllPeers(frames, isFirstBatch) {
    const SAMPLES_PER_FRAME = 960;
    for (const [peerId, track] of this.sendTracks) {
      if (!track.isOpen()) {
        this.log("warn", `[bot-huddle] track NOT open for ${peerId.slice(0, 8)}, skip`);
        continue;
      }
      let sentOk = 0, sentFail = 0;
      const peerState = this.peerConnections.get(peerId);
      const rtpConfig = peerState?.rtpConfig;
      for (const frame of frames) {
        if (this.abortSending) {
          this.log("info", `[bot-huddle] barge-in: stopped mid-send at frame ${sentOk}/${frames.length}`);
          break;
        }
        if (rtpConfig) {
          rtpConfig.sequenceNumber = rtpConfig.sequenceNumber + 1 & 65535;
          rtpConfig.timestamp = rtpConfig.timestamp + SAMPLES_PER_FRAME >>> 0;
        }
        const rtpHeader = Buffer.alloc(12);
        const isFirst = isFirstBatch && sentOk + sentFail === 0;
        rtpHeader[0] = 128;
        rtpHeader[1] = (isFirst ? 128 : 0) | (rtpConfig?.payloadType ?? 111);
        rtpHeader.writeUInt16BE(rtpConfig?.sequenceNumber ?? 0, 2);
        rtpHeader.writeUInt32BE(rtpConfig?.timestamp ?? 0, 4);
        rtpHeader.writeUInt32BE(rtpConfig?.ssrc ?? 1234, 8);
        const ok = track.sendMessageBinary(Buffer.concat([rtpHeader, frame]));
        if (ok)
          sentOk++;
        else
          sentFail++;
        if (sentOk + sentFail <= 2 && isFirstBatch) {
          this.log("info", `[bot-huddle] send #${sentOk + sentFail}: seq=${rtpConfig?.sequenceNumber}, ts=${rtpConfig?.timestamp}`);
        }
        await new Promise((r) => setTimeout(r, 18));
      }
      this.log("info", `[bot-huddle] sent ${sentOk}/${frames.length} frames to ${peerId.slice(0, 8)}`);
    }
  }
  cleanupPeer(peerId) {
    const peerState = this.peerConnections.get(peerId);
    if (peerState) {
      try {
        peerState.track?.close();
      } catch {}
      try {
        peerState.pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
      this.audioTracks.delete(peerId);
      this.sendTracks.delete(peerId);
      this.log("info", `[bot-huddle] cleaned up PC for ${peerId}`);
    }
  }
  destroy() {
    this.leave();
    this.audioPipeline.destroy();
    this.tts?.destroy();
    this.ttsFallback?.destroy();
  }
  createElevenLabsTts(apiKey, opts) {
    return new TextToSpeech({
      provider: "elevenlabs",
      apiKey,
      voiceId: this.resolveVoiceId(opts?.ttsVoice),
      model: opts?.ttsModel,
      language: opts?.sttLanguage,
      log: this.callbacks.log
    });
  }
  createGeminiTts(apiKey, opts) {
    return new TextToSpeech({
      provider: "gemini",
      apiKey,
      voiceId: opts?.ttsVoice,
      model: opts?.ttsModel,
      language: opts?.sttLanguage,
      log: this.callbacks.log
    });
  }
  async speakWithFallback(text) {
    if (!this.tts)
      return [];
    try {
      return await this.tts.speakRaw(text);
    } catch (primaryErr) {
      if (!this.ttsFallback)
        throw primaryErr;
      this.log("warn", `[bot-huddle] primary TTS failed; trying fallback (${String(primaryErr)})`);
      return this.ttsFallback.speakRaw(text);
    }
  }
  resolveVoiceId(voiceName) {
    if (!voiceName)
      return;
    const voiceMap = {
      rachel: "EXAVITQu4vr4xnSDxMaL",
      domi: "AZnzlk1XvdvUeBnXmlld",
      bella: "EXAVITQu4vr4xnSDxMaL",
      antoni: "ErXwobaYiN019PkySvjV",
      elli: "MF3mGyEYCl7XYWbV9V6O",
      josh: "TxGEqnHWrfWFTfGW9XjX",
      arnold: "VR6AewLTigWG4xSOukaG",
      adam: "pNInz6obpgDQGcFmaJgB",
      sam: "yoZ06aMxZJJ28mfd3POQ"
    };
    return voiceMap[voiceName.toLowerCase()] ?? voiceName;
  }
  extractOpusPayloadType(sdp) {
    if (!sdp)
      return 111;
    const match = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match)
      return parseInt(match[1], 10);
    return 111;
  }
  emitStatus(status) {
    this.callbacks.broadcastSignal({
      type: "huddle-status",
      channelId: this.activeChannelId,
      peerId: this.myPeerId,
      status
    });
  }
  log(level, msg) {
    if (level === "info") {
      this.callbacks.log?.info(msg);
    } else if (level === "warn") {
      (this.callbacks.log?.warn ?? this.callbacks.log?.info)?.(msg);
    } else {
      (this.callbacks.log?.error ?? this.callbacks.log?.info)?.(msg);
    }
  }
}

// src/peer/DecentChatNodePeer.ts
async function runDecentChatNodePeerStartupLocked(task) {
  return task();
}
function buildMessageMetadata(model) {
  if (!model)
    return;
  const hasAssistantModel = Boolean(model.modelId || model.modelName || model.modelAlias || model.modelLabel);
  if (!hasAssistantModel)
    return;
  return {
    assistant: {
      ...model.modelId ? { modelId: model.modelId } : {},
      ...model.modelName ? { modelName: model.modelName } : {},
      ...model.modelAlias ? { modelAlias: model.modelAlias } : {},
      ...model.modelLabel ? { modelLabel: model.modelLabel } : {}
    }
  };
}
function isRecord3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
class DecentChatNodePeer {
  static CUSTODIAN_REPLICATION_TARGET = 2;
  static PRE_KEY_FETCH_TIMEOUT_MS = 2500;
  static DECRYPT_RECOVERY_HANDSHAKE_COOLDOWN_MS = 5000;
  static CONNECT_HANDSHAKE_COOLDOWN_MS = 60000;
  static INBOUND_HANDSHAKE_COOLDOWN_MS = 5000;
  static PEER_MAINTENANCE_RETRY_BASE_MS = 30000;
  static PEER_MAINTENANCE_RETRY_MAX_MS = 60 * 60000;
  static PEER_MAINTENANCE_MAX_CONSECUTIVE_FAILURES = 20;
  static TRANSPORT_ERROR_LOG_WINDOW_MS = 30000;
  static GOSSIP_TTL = 2;
  store;
  workspaceManager;
  messageStore;
  cryptoManager;
  transport = null;
  syncProtocol = null;
  messageProtocol = null;
  signingKeyPair = null;
  myPeerId = "";
  startedAt = Date.now();
  myPublicKey = "";
  destroyed = false;
  _maintenanceInterval = null;
  offlineQueue;
  custodyStore;
  manifestStore;
  custodianInbox = new Map;
  pendingCustodyOffers = new Map;
  opts;
  pendingMediaRequests = new Map;
  pendingPreKeyBundleFetches = new Map;
  publishedPreKeyVersionByWorkspace = new Map;
  decryptRecoveryAtByPeer = new Map;
  connectHandshakeAtByPeer = new Map;
  inboundHandshakeAtByPeer = new Map;
  peerMaintenanceRetryAtByPeer = new Map;
  peerMaintenanceAttemptsByPeer = new Map;
  throttledTransportErrors = new Map;
  syncImportFailLastLogAt = new Map;
  static SYNC_IMPORT_FAIL_LOG_INTERVAL_MS = 10 * 60000;
  unverifiedSurfacedIds = new Set;
  static UNVERIFIED_SURFACED_MAX = 5000;
  static UNVERIFIED_SURFACED_STORE_KEY = "unverified-surfaced-msg-ids";
  unverifiedSurfacedTsByChannel = new Map;
  static UNVERIFIED_SURFACED_TS_STORE_KEY = "unverified-surfaced-ts-by-channel";
  _gossipSeen = new Map;
  _gossipCleanupInterval = null;
  mediaChunkTimeout = 30000;
  manifestPersistTimer = null;
  botHuddle = null;
  constructor(opts) {
    this.opts = opts;
    this.store = new FileStore(opts.account.dataDir);
    this.workspaceManager = new WorkspaceManager;
    this.messageStore = new MessageStore;
    this.cryptoManager = new CryptoManager;
    this.offlineQueue = new OfflineQueue;
    this.custodyStore = new CustodyStore(this.offlineQueue);
    this.manifestStore = new ManifestStore;
    this.manifestStore.setChangeListener(() => this.schedulePersistManifestState());
    this.offlineQueue.setPersistence(async (peerId, data, meta) => {
      const key = this.offlineQueueKey(peerId);
      const seqKey = "offline-queue-seq";
      const seq = this.store.get(seqKey, 1);
      const queue = this.store.get(key, []);
      queue.push({
        id: seq,
        targetPeerId: peerId,
        data,
        createdAt: meta?.createdAt ?? Date.now(),
        attempts: meta?.attempts ?? 0,
        lastAttempt: meta?.lastAttempt,
        ...meta
      });
      this.store.set(key, queue);
      this.store.set(seqKey, seq + 1);
    }, async (peerId) => this.store.get(this.offlineQueueKey(peerId), []), async (id) => {
      for (const key of this.store.keys("offline-queue-")) {
        if (key === "offline-queue-seq")
          continue;
        const queue = this.store.get(key, []);
        const idx = queue.findIndex((msg) => msg?.id === id);
        if (idx < 0)
          continue;
        queue.splice(idx, 1);
        if (queue.length === 0) {
          this.store.delete(key);
        } else {
          this.store.set(key, queue);
        }
        break;
      }
    }, async (peerId) => {
      const key = this.offlineQueueKey(peerId);
      const queue = this.store.get(key, []);
      this.store.delete(key);
      return queue;
    }, async (id, patch) => {
      for (const key of this.store.keys("offline-queue-")) {
        if (key === "offline-queue-seq")
          continue;
        const queue = this.store.get(key, []);
        const idx = queue.findIndex((msg) => msg?.id === id);
        if (idx < 0)
          continue;
        queue[idx] = { ...queue[idx], ...patch };
        this.store.set(key, queue);
        break;
      }
    });
    this.custodyStore.setReceiptPersistence(async (receipt) => {
      const key = this.receiptLogKey(receipt.recipientPeerId);
      const receipts = this.store.get(key, []);
      if (!receipts.some((entry) => entry.receiptId === receipt.receiptId)) {
        receipts.push(receipt);
        receipts.sort((a, b) => a.timestamp - b.timestamp || a.receiptId.localeCompare(b.receiptId));
        this.store.set(key, receipts);
      }
    }, async (peerId) => this.store.get(this.receiptLogKey(peerId), []));
  }
  get peerId() {
    return this.myPeerId;
  }
  hasMyMessageInChannelThread(channelId, threadId) {
    if (!threadId || !channelId)
      return false;
    const msgs = this.messageStore.getMessages(channelId);
    for (const m of msgs) {
      if (m.senderId !== this.myPeerId)
        continue;
      if (m.id === threadId)
        return true;
      if (m.threadId === threadId)
        return true;
    }
    return false;
  }
  async start() {
    const seedPhrase = this.opts.account.seedPhrase;
    if (!seedPhrase) {
      throw new Error("DecentChat seed phrase not configured (channels.decentchat.seedPhrase)");
    }
    const seedMgr = new SeedPhraseManager;
    const validation = seedMgr.validate(seedPhrase);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase in channels.decentchat.seedPhrase: ${validation.error}`);
    }
    await runDecentChatNodePeerStartupLocked(async () => {
      const { peerId, keys: { ecdhKeyPair, ecdsaKeyPair } } = await seedMgr.deriveAll(seedPhrase);
      this.myPeerId = peerId;
      this.cryptoManager.setKeyPair(ecdhKeyPair);
      this.myPublicKey = await this.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);
      this.messageProtocol = new NodeMessageProtocol(this.cryptoManager, this.myPeerId);
      this.messageProtocol.setPersistence({
        save: async (peerId2, state) => this.store.set(`ratchet-${peerId2}`, state),
        load: async (peerId2) => this.store.get(`ratchet-${peerId2}`, null),
        delete: async (peerId2) => this.store.delete(`ratchet-${peerId2}`),
        savePreKeyBundle: async (peerId2, bundle) => this.store.set(`prekey-bundle-${peerId2}`, bundle),
        loadPreKeyBundle: async (peerId2) => this.store.get(`prekey-bundle-${peerId2}`, null),
        deletePreKeyBundle: async (peerId2) => this.store.delete(`prekey-bundle-${peerId2}`),
        saveLocalPreKeyState: async (ownerPeerId, state) => this.store.set(`prekey-state-${ownerPeerId}`, state),
        loadLocalPreKeyState: async (ownerPeerId) => this.store.get(`prekey-state-${ownerPeerId}`, null),
        deleteLocalPreKeyState: async (ownerPeerId) => this.store.delete(`prekey-state-${ownerPeerId}`)
      });
      await this.messageProtocol.init(ecdsaKeyPair);
      this.signingKeyPair = ecdsaKeyPair;
      this.restoreWorkspaces();
      this.restoreMessages();
      this.restoreManifestState();
      this.restoreCustodianInbox();
      try {
        const persistedIds = this.store.get(DecentChatNodePeer.UNVERIFIED_SURFACED_STORE_KEY, []);
        if (Array.isArray(persistedIds)) {
          this.unverifiedSurfacedIds = new Set(persistedIds);
        }
      } catch (err) {
        this.opts.log?.warn?.(`[decentchat-peer] failed to restore unverified-surfaced-msg-ids: ${String(err)}`);
      }
      try {
        const persistedTs = this.store.get(DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY, {});
        if (persistedTs && typeof persistedTs === "object") {
          this.unverifiedSurfacedTsByChannel = new Map(Object.entries(persistedTs));
        }
      } catch (err) {
        this.opts.log?.warn?.(`[decentchat-peer] failed to restore unverified-surfaced-ts-by-channel: ${String(err)}`);
      }
      const configServer = this.opts.account.signalingServer ?? "https://0.peerjs.com/";
      const allServers = [configServer];
      const normalizeUrl = (url) => {
        try {
          const u = new URL(url);
          const defaultPort = u.protocol === "https:" || u.protocol === "wss:" ? "443" : "80";
          if (u.port === defaultPort)
            u.port = "";
          return u.toString();
        } catch {
          return url;
        }
      };
      const normalizedServers = new Set(allServers.map(normalizeUrl));
      for (const inviteUri of this.opts.account.invites ?? []) {
        try {
          const invite = InviteURI.decode(inviteUri);
          const scheme = invite.secure ? "https" : "http";
          const inviteServer = `${scheme}://${invite.host}:${invite.port}${invite.path}`;
          if (!normalizedServers.has(normalizeUrl(inviteServer))) {
            normalizedServers.add(normalizeUrl(inviteServer));
            allServers.push(inviteServer);
          }
        } catch {}
      }
      this.transport = new PeerTransport({
        signalingServers: allServers
      });
      this.opts.log?.info(`[decentchat-peer] signaling servers: ${allServers.join(", ")}`);
      this.syncProtocol = new SyncProtocol2(this.workspaceManager, this.messageStore, (peerId2, data) => this.transport?.send(peerId2, data) ?? false, (event) => {
        this.handleSyncEvent(event);
      }, this.myPeerId);
      this.transport.onConnect = (peerId2) => {
        this.handlePeerConnect(peerId2);
      };
      this.transport.onDisconnect = (peerId2) => {
        this.opts.log?.info(`[decentchat-peer] peer disconnected: ${peerId2}`);
        this.messageProtocol?.clearSharedSecret(peerId2);
        this.inboundHandshakeAtByPeer.delete(peerId2);
        this.decryptRecoveryAtByPeer.delete(peerId2);
      };
      this.transport.onMessage = (fromPeerId, rawData) => {
        this.handlePeerMessage(fromPeerId, rawData);
      };
      this.transport.onError = (err) => {
        this.notePeerMaintenanceFailure(this.extractPeerIdFromTransportError(err), Date.now());
        this.logTransportError(err);
      };
      this.myPeerId = await this.transport.init(this.myPeerId);
      this.opts.log?.info(`[decentchat-peer] online as ${this.myPeerId}, signaling: ${allServers.join(", ")}`);
      this.startPeerMaintenance();
      this.startGossipCleanup();
      const huddleConfig = this.opts.account.huddle;
      if (huddleConfig?.enabled !== false) {
        this.botHuddle = new BotHuddleManager(this.myPeerId, {
          sendSignal: (peerId2, data) => this.transport?.send(peerId2, data) ?? false,
          broadcastSignal: (data) => {
            if (!this.transport)
              return;
            for (const peerId2 of this.transport.getConnectedPeers()) {
              if (peerId2 !== this.myPeerId) {
                this.transport.send(peerId2, data);
              }
            }
          },
          getDisplayName: (peerId2) => this.resolveSenderName("", peerId2),
          onTranscription: async (text, peerId2, channelId) => {
            const senderName = this.resolveSenderName("", peerId2);
            return this.opts.onHuddleTranscription?.(text, peerId2, channelId, senderName);
          },
          log: this.opts.log
        }, {
          autoJoin: huddleConfig?.autoJoin,
          sttEngine: huddleConfig?.sttEngine,
          whisperModel: huddleConfig?.whisperModel,
          sttLanguage: huddleConfig?.sttLanguage,
          sttApiKey: huddleConfig?.sttApiKey,
          ttsEngine: huddleConfig?.ttsEngine,
          ttsModel: huddleConfig?.ttsModel,
          ttsApiKey: huddleConfig?.ttsApiKey,
          ttsVoice: huddleConfig?.ttsVoice,
          vadSilenceMs: huddleConfig?.vadSilenceMs,
          vadThreshold: huddleConfig?.vadThreshold
        });
      }
      for (const inviteUri of this.opts.account.invites ?? []) {
        const invite = (() => {
          try {
            return InviteURI.decode(inviteUri);
          } catch {
            return null;
          }
        })();
        if (!invite || !this.shouldAttemptInviteJoin(invite)) {
          continue;
        }
        this.joinWorkspaceWithRetry(inviteUri, invite);
      }
    });
  }
  shouldAttemptInviteJoin(invite) {
    if (!invite.peerId) {
      return false;
    }
    if (invite.workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(invite.workspaceId);
      if (workspace?.members.some((member) => member.peerId === this.myPeerId)) {
        return !workspace.members.some((member) => member.peerId === invite.peerId);
      }
    }
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const memberPeerIds = new Set(workspace.members.map((member) => member.peerId));
      if (memberPeerIds.has(this.myPeerId) && memberPeerIds.has(invite.peerId)) {
        return false;
      }
    }
    return true;
  }
  async joinWorkspaceWithRetry(inviteUri, decodedInvite = null, maxAttempts = 5) {
    const delays = [5000, 15000, 30000, 60000, 120000];
    const invite = decodedInvite ?? (() => {
      try {
        return InviteURI.decode(inviteUri);
      } catch {
        return null;
      }
    })();
    if (!invite || !this.shouldAttemptInviteJoin(invite)) {
      return;
    }
    for (let attempt = 0;attempt < maxAttempts; attempt++) {
      if (this.destroyed)
        return;
      try {
        await this.joinWorkspace(inviteUri);
        return;
      } catch {}
      if (invite?.peerId && this.transport?.getConnectedPeers().includes(invite.peerId))
        return;
      if (!this.shouldAttemptInviteJoin(invite))
        return;
      if (attempt < maxAttempts - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        this.opts.log?.info?.(`[decentchat-peer] join retry in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  async persistMessageLocally(channelId, workspaceId, content, threadId, replyToId, messageId, model) {
    if (!content.trim())
      return;
    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), "text", threadId);
    if (messageId)
      msg.id = messageId;
    if (model) {
      msg.metadata = buildMessageMetadata(model);
    }
    const added = await this.messageStore.addMessage(msg);
    if (added.success) {
      this.persistMessagesForChannel(channelId);
      this.opts.log?.info?.(`[decentchat-peer] persisted message locally: ${msg.id.slice(0, 8)} (${content.length} chars)`);
    }
  }
  async sendMessage(channelId, workspaceId, content, threadId, replyToId, messageId, model) {
    if (!this.transport || !this.messageProtocol || !content.trim())
      return;
    const modelMeta = buildMessageMetadata(model);
    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), "text", threadId);
    if (messageId)
      msg.id = messageId;
    if (modelMeta) {
      msg.metadata = modelMeta;
    }
    const added = await this.messageStore.addMessage(msg);
    if (added.success) {
      this.persistMessagesForChannel(channelId);
      this.recordManifestDomain("channel-message", workspaceId, {
        channelId,
        itemCount: this.messageStore.getMessages(channelId).length,
        operation: "create",
        subject: msg.id,
        data: { messageId: msg.id, senderId: this.myPeerId }
      });
    }
    const recipients = this.getChannelRecipientPeerIds(channelId, workspaceId);
    const gossipOriginSignature = await this.signGossipOrigin({
      messageId: msg.id,
      channelId,
      content: content.trim(),
      threadId,
      replyToId
    });
    const lazyEncrypt = async () => {
      const enc = await this.encryptMessageWithPreKeyBootstrap(recipients[0], content.trim(), modelMeta, workspaceId);
      enc.channelId = channelId;
      enc.workspaceId = workspaceId;
      enc.senderId = this.myPeerId;
      enc.senderName = this.opts.account.alias;
      enc.messageId = msg.id;
      if (gossipOriginSignature) {
        enc._gossipOriginSignature = gossipOriginSignature;
      }
      if (threadId)
        enc.threadId = threadId;
      if (replyToId)
        enc.replyToId = replyToId;
      return enc;
    };
    for (const peerId of recipients) {
      try {
        const connected = this.transport.getConnectedPeers().includes(peerId);
        if (connected) {
          let accepted = true;
          try {
            const streamModelMeta = modelMeta?.assistant ? {
              ...modelMeta.assistant.modelId ? { modelId: modelMeta.assistant.modelId } : {},
              ...modelMeta.assistant.modelName ? { modelName: modelMeta.assistant.modelName } : {},
              ...modelMeta.assistant.modelAlias ? { modelAlias: modelMeta.assistant.modelAlias } : {},
              ...modelMeta.assistant.modelLabel ? { modelLabel: modelMeta.assistant.modelLabel } : {}
            } : undefined;
            this.transport.send(peerId, {
              type: "stream-start",
              messageId: msg.id,
              channelId,
              senderId: this.myPeerId,
              senderName: this.opts.account.alias,
              ...threadId ? { threadId } : {},
              ...replyToId ? { replyToId } : {},
              ...streamModelMeta ? { modelMeta: streamModelMeta } : {}
            });
            this.transport.send(peerId, {
              type: "stream-delta",
              messageId: msg.id,
              content: content.trim()
            });
            this.transport.send(peerId, {
              type: "stream-done",
              messageId: msg.id
            });
            console.log(`[decentchat-peer] stream→${peerId.slice(0, 8)} msgId=${msg.id.slice(0, 8)} model=${streamModelMeta?.modelLabel || streamModelMeta?.modelId || "none"}`);
          } catch (streamErr) {
            this.opts.log?.warn?.(`[decentchat-peer] stream push to ${peerId.slice(0, 8)} failed: ${String(streamErr)}`);
            accepted = false;
          }
          if (!accepted) {
            const encrypted2 = await lazyEncrypt();
            await this.custodyStore.storeEnvelope({
              envelopeId: typeof encrypted2.id === "string" ? encrypted2.id : undefined,
              opId: msg.id,
              recipientPeerIds: [peerId],
              workspaceId,
              channelId,
              ...threadId ? { threadId } : {},
              domain: "channel-message",
              ciphertext: encrypted2,
              metadata: {
                messageId: msg.id,
                ...this.buildCustodyResendMetadata({
                  content: content.trim(),
                  channelId,
                  workspaceId,
                  senderId: this.myPeerId,
                  senderName: this.opts.account.alias,
                  threadId,
                  replyToId,
                  isDirect: false,
                  gossipOriginSignature,
                  metadata: modelMeta
                })
              }
            });
            await this.replicateToCustodians(peerId, { workspaceId, channelId, opId: msg.id, domain: "channel-message" });
          }
          continue;
        }
        const encrypted = await lazyEncrypt();
        await this.custodyStore.storeEnvelope({
          envelopeId: typeof encrypted.id === "string" ? encrypted.id : undefined,
          opId: msg.id,
          recipientPeerIds: [peerId],
          workspaceId,
          channelId,
          ...threadId ? { threadId } : {},
          domain: "channel-message",
          ciphertext: encrypted,
          metadata: {
            messageId: msg.id,
            ...this.buildCustodyResendMetadata({
              content: content.trim(),
              channelId,
              workspaceId,
              senderId: this.myPeerId,
              senderName: this.opts.account.alias,
              threadId,
              replyToId,
              isDirect: false,
              gossipOriginSignature,
              metadata: modelMeta
            })
          }
        });
        await this.replicateToCustodians(peerId, { workspaceId, channelId, opId: msg.id, domain: "channel-message" });
      } catch (err) {
        this.opts.log?.error?.(`[decentchat-peer] failed to prepare outbound for ${peerId}: ${String(err)}`);
        await this.enqueueOffline(peerId, {
          content: content.trim(),
          channelId,
          workspaceId,
          senderId: this.myPeerId,
          senderName: this.opts.account.alias,
          messageId: msg.id,
          threadId,
          replyToId,
          isDirect: false,
          ...modelMeta ? { metadata: modelMeta } : {}
        });
      }
    }
  }
  startGossipCleanup() {
    if (this._gossipCleanupInterval)
      return;
    const fiveMin = 5 * 60 * 1000;
    this._gossipCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - fiveMin;
      for (const [id, ts] of this._gossipSeen) {
        if (ts < cutoff)
          this._gossipSeen.delete(id);
      }
    }, fiveMin);
  }
  buildGossipOriginPayload(params) {
    const contentHash = createHash("sha256").update(params.content).digest("hex");
    return `v1|${params.messageId}|${params.channelId}|${params.threadId ?? ""}|${params.replyToId ?? ""}|${contentHash}`;
  }
  async signGossipOrigin(params) {
    if (!this.signingKeyPair || !this.messageProtocol || typeof this.messageProtocol.signData !== "function") {
      return;
    }
    return this.messageProtocol.signData(this.buildGossipOriginPayload(params));
  }
  async resolveInboundSenderId(fromPeerId, trustedSenderId, msg, channelId, messageId, content) {
    const gossipSender = typeof msg._gossipOriginalSender === "string" && msg._gossipOriginalSender.length > 0 ? msg._gossipOriginalSender : undefined;
    if (!gossipSender || gossipSender === fromPeerId) {
      return { senderId: trustedSenderId ?? fromPeerId, allowRelay: true, verifiedGossipOrigin: false };
    }
    const originSignature = typeof msg._gossipOriginSignature === "string" && msg._gossipOriginSignature.length > 0 ? msg._gossipOriginSignature : undefined;
    if (!originSignature || !this.messageProtocol || typeof this.messageProtocol.verifyData !== "function") {
      this.opts.log?.warn?.(`[decentchat-peer] unsigned gossip origin claim ${gossipSender.slice(0, 8)} via ${fromPeerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`);
      return { senderId: fromPeerId, allowRelay: false, verifiedGossipOrigin: false };
    }
    let isValid = false;
    try {
      isValid = await this.messageProtocol.verifyData(this.buildGossipOriginPayload({
        messageId,
        channelId,
        content,
        threadId: typeof msg.threadId === "string" ? msg.threadId : undefined,
        replyToId: typeof msg.replyToId === "string" ? msg.replyToId : undefined
      }), originSignature, gossipSender);
    } catch {
      isValid = false;
    }
    if (!isValid) {
      this.opts.log?.warn?.(`[decentchat-peer] invalid gossip origin signature ${gossipSender.slice(0, 8)} via ${fromPeerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`);
      return { senderId: fromPeerId, allowRelay: false, verifiedGossipOrigin: false };
    }
    return { senderId: gossipSender, allowRelay: true, verifiedGossipOrigin: true };
  }
  finalizeGossipRelayEnvelope(relayEnv, originalMsgId, originalSenderId, channelId, workspaceId, hop, envelope) {
    relayEnv.messageId = originalMsgId;
    relayEnv.channelId = channelId;
    relayEnv.workspaceId = workspaceId;
    relayEnv.senderId = originalSenderId;
    if (typeof envelope.senderName === "string" && envelope.senderName.trim()) {
      relayEnv.senderName = envelope.senderName;
    }
    if (envelope.threadId)
      relayEnv.threadId = envelope.threadId;
    if (envelope.replyToId)
      relayEnv.replyToId = envelope.replyToId;
    if (envelope.vectorClock)
      relayEnv.vectorClock = envelope.vectorClock;
    if (envelope.metadata)
      relayEnv.metadata = envelope.metadata;
    if (Array.isArray(envelope.attachments) && envelope.attachments.length > 0) {
      relayEnv.attachments = envelope.attachments;
    }
    if (envelope.threadRootSnapshot)
      relayEnv.threadRootSnapshot = envelope.threadRootSnapshot;
    relayEnv._originalMessageId = originalMsgId;
    relayEnv._gossipOriginalSender = originalSenderId;
    relayEnv._gossipHop = hop;
    if (typeof envelope._gossipOriginSignature === "string" && envelope._gossipOriginSignature.length > 0) {
      relayEnv._gossipOriginSignature = envelope._gossipOriginSignature;
    }
    return relayEnv;
  }
  async gossipRelay(fromPeerId, originalMsgId, originalSenderId, plaintext, channelId, envelope) {
    if (!this.transport || !this.messageProtocol)
      return;
    const hop = (envelope._gossipHop ?? 0) + 1;
    if (hop > DecentChatNodePeer.GOSSIP_TTL)
      return;
    const workspaceId = typeof envelope.workspaceId === "string" && envelope.workspaceId ? envelope.workspaceId : this.findWorkspaceIdForChannel(channelId);
    if (!workspaceId || workspaceId === "direct")
      return;
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws)
      return;
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    for (const member of ws.members) {
      const targetPeerId = member.peerId;
      if (!targetPeerId || targetPeerId === this.myPeerId)
        continue;
      if (targetPeerId === fromPeerId)
        continue;
      if (targetPeerId === originalSenderId)
        continue;
      if (!connectedPeers.has(targetPeerId))
        continue;
      try {
        const encrypted = await this.encryptMessageWithPreKeyBootstrap(targetPeerId, plaintext, envelope.metadata, workspaceId);
        const relayEnv = this.finalizeGossipRelayEnvelope(encrypted, originalMsgId, originalSenderId, channelId, workspaceId, hop, envelope);
        this.transport.send(targetPeerId, relayEnv);
      } catch (error) {
        this.opts.log?.warn?.(`[decentchat-peer] gossip relay to ${targetPeerId.slice(0, 8)} failed: ${String(error?.message ?? error)}`);
      }
    }
  }
  async joinWorkspace(inviteUri) {
    if (!this.syncProtocol || !this.transport)
      return;
    try {
      const invite = InviteURI.decode(inviteUri);
      if (!invite.peerId) {
        this.opts.log?.warn?.("[decentchat-peer] invite missing peer ID; cannot auto-join");
        return;
      }
      if (InviteURI.isExpired(invite)) {
        this.opts.log?.warn?.("[decentchat-peer] invite has expired; skipping join");
        return;
      }
      await this.transport.connect(invite.peerId);
      const member = {
        peerId: this.myPeerId,
        alias: this.opts.account.alias,
        publicKey: this.myPublicKey,
        role: "member",
        isBot: true,
        joinedAt: Date.now()
      };
      this.syncProtocol.requestJoin(invite.peerId, invite.inviteCode, member, invite.inviteId);
      this.opts.log?.info(`[decentchat-peer] join request sent to ${invite.peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] join failed: ${String(err)}`);
    }
  }
  destroy() {
    this.destroyed = true;
    if (this._gossipCleanupInterval) {
      clearInterval(this._gossipCleanupInterval);
      this._gossipCleanupInterval = null;
    }
    if (this._maintenanceInterval) {
      clearInterval(this._maintenanceInterval);
      this._maintenanceInterval = null;
    }
    if (this.manifestPersistTimer) {
      clearTimeout(this.manifestPersistTimer);
      this.manifestPersistTimer = null;
      this.persistManifestState();
    }
    for (const pending of this.pendingMediaRequests.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingMediaRequests.clear();
    for (const pending of this.pendingPreKeyBundleFetches.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingPreKeyBundleFetches.clear();
    this.botHuddle?.destroy();
    this.botHuddle = null;
    this.signingKeyPair = null;
    this.transport?.destroy();
    this.store.close();
    this.opts.log?.info("[decentchat-peer] stopped");
  }
  async requestFullImage(peerId, attachmentId) {
    if (!this.transport)
      return null;
    const storedKey = `media-full:${attachmentId}`;
    const stored = this.store.get(storedKey, null);
    if (stored) {
      try {
        return Buffer.from(stored, "base64");
      } catch {}
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingMediaRequests.delete(attachmentId);
        resolve(null);
      }, this.mediaChunkTimeout);
      this.pendingMediaRequests.set(attachmentId, {
        attachmentId,
        peerId,
        resolve,
        chunks: new Map,
        timeout
      });
      const request = { type: "media-request", attachmentId };
      this.transport?.send(peerId, request);
    });
  }
  startPeerMaintenance() {
    if (this._maintenanceInterval)
      return;
    this._maintenanceInterval = setInterval(() => {
      this.runPeerMaintenancePass();
    }, 30000);
  }
  extractPeerIdFromTransportError(error) {
    const match = /Could not connect to peer ([a-z0-9]+)/i.exec(error.message);
    return match?.[1] ?? null;
  }
  logTransportError(error) {
    const message = error.message || String(error);
    const peerId = this.extractPeerIdFromTransportError(error);
    if (!peerId) {
      this.opts.log?.error?.(`[decentchat-peer] transport error: ${message}`);
      return;
    }
    const now = Date.now();
    const current = this.throttledTransportErrors.get(peerId);
    if (!current || now - current.windowStart >= DecentChatNodePeer.TRANSPORT_ERROR_LOG_WINDOW_MS) {
      if (current && current.suppressed > 0) {
        this.opts.log?.warn?.(`[decentchat-peer] transport error repeats for ${peerId.slice(0, 8)} suppressed=${current.suppressed}`);
      }
      this.throttledTransportErrors.set(peerId, { windowStart: now, suppressed: 0 });
      this.opts.log?.error?.(`[decentchat-peer] transport error: ${message}`);
      return;
    }
    current.suppressed += 1;
    if (current.suppressed % 20 === 0) {
      this.opts.log?.warn?.(`[decentchat-peer] transport error repeats for ${peerId.slice(0, 8)} suppressed=${current.suppressed}`);
    }
  }
  notePeerMaintenanceFailure(peerId, now = Date.now()) {
    if (!peerId || peerId === this.myPeerId)
      return;
    const attempt = (this.peerMaintenanceAttemptsByPeer.get(peerId) ?? 0) + 1;
    this.peerMaintenanceAttemptsByPeer.set(peerId, attempt);
    const delay = Math.min(DecentChatNodePeer.PEER_MAINTENANCE_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), DecentChatNodePeer.PEER_MAINTENANCE_RETRY_MAX_MS);
    this.peerMaintenanceRetryAtByPeer.set(peerId, now + delay);
  }
  clearPeerMaintenanceFailure(peerId) {
    this.peerMaintenanceAttemptsByPeer.delete(peerId);
    this.peerMaintenanceRetryAtByPeer.delete(peerId);
  }
  async runPeerMaintenancePass(now = Date.now()) {
    if (this.destroyed || !this.transport)
      return;
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    const seen = new Set;
    const attempted = [];
    const skipped = [];
    const connected = [];
    const quarantineErrors = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        const peerId = member.peerId;
        if (peerId === this.myPeerId)
          continue;
        if (seen.has(peerId))
          continue;
        seen.add(peerId);
        if (connectedPeers.has(peerId)) {
          this.clearPeerMaintenanceFailure(peerId);
          connected.push(peerId.slice(0, 8));
          continue;
        }
        const attempts = this.peerMaintenanceAttemptsByPeer.get(peerId) ?? 0;
        if (attempts >= DecentChatNodePeer.PEER_MAINTENANCE_MAX_CONSECUTIVE_FAILURES) {
          skipped.push(`${peerId.slice(0, 8)}:max-attempts(${attempts})`);
          continue;
        }
        const retryAt = this.peerMaintenanceRetryAtByPeer.get(peerId) ?? 0;
        if (retryAt > now) {
          skipped.push(`${peerId.slice(0, 8)}:backoff(${Math.round((retryAt - now) / 1000)}s)`);
          continue;
        }
        attempted.push(peerId.slice(0, 8));
        try {
          await this.transport.connect(peerId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/quarantined/i.test(msg)) {
            quarantineErrors.push(`${peerId.slice(0, 8)}:${msg.replace(/.*quarantined for /, "Q").replace(/ after.*/, "")}`);
          }
          this.notePeerMaintenanceFailure(peerId, now);
        }
      }
    }
    if (attempted.length || skipped.length || quarantineErrors.length) {
      this.opts.log?.info?.(`[decentchat-peer] maintenance pass: ` + `connected=[${connected.join(",")}] ` + `attempted=[${attempted.join(",")}] ` + `skipped=[${skipped.join(",")}]` + (quarantineErrors.length ? ` quarantine=[${quarantineErrors.join(",")}]` : ""));
    }
  }
  async handlePeerMessage(fromPeerId, rawData, trustedSenderId) {
    if (this.destroyed || !this.syncProtocol || !this.messageProtocol || !this.transport)
      return;
    const msg = rawData;
    if (msg?.type === "ack") {
      console.log(`[decentchat-peer] inbound ACK from ${fromPeerId.slice(0, 8)} for msgId=${String(msg.messageId).slice(0, 8)}`);
      await this.handleInboundReceipt(fromPeerId, msg, "acknowledged");
      return;
    }
    if (msg?.type === "read") {
      await this.handleInboundReceipt(fromPeerId, msg, "read");
      return;
    }
    if (msg?.type === "auth-challenge" && typeof msg.nonce === "string") {
      if (!this.signingKeyPair?.privateKey) {
        this.opts.log?.warn?.(`[decentchat-peer] auth-challenge from ${fromPeerId.slice(0, 8)} ` + `but no signing key available — challenger will fall back to TOFU`);
        return;
      }
      try {
        const response = await PeerAuth.respondToChallenge(msg.nonce, fromPeerId, this.signingKeyPair.privateKey);
        const accepted = this.transport.send(fromPeerId, {
          type: "auth-response",
          signature: response.signature
        });
        this.opts.log?.info?.(`[decentchat-peer] auth-response sent to ${fromPeerId.slice(0, 8)} accepted=${accepted}`);
      } catch (err) {
        this.opts.log?.warn?.(`[decentchat-peer] failed to respond to auth-challenge from ${fromPeerId.slice(0, 8)}: ${String(err)}`);
      }
      return;
    }
    if (await this.handlePreKeyControl(fromPeerId, msg)) {
      return;
    }
    if (msg?.type === "handshake") {
      if (this.shouldIgnoreInboundHandshakeBurst(fromPeerId)) {
        return;
      }
      this.decryptRecoveryAtByPeer.delete(fromPeerId);
      await this.messageProtocol.processHandshake(fromPeerId, msg);
      if (msg.preKeySupport) {
        const preKeyWorkspaceId = this.resolveSharedWorkspaceIds(fromPeerId)[0];
        this.transport.send(fromPeerId, {
          type: "pre-key-bundle.request",
          ...preKeyWorkspaceId ? { workspaceId: preKeyWorkspaceId } : {}
        });
      }
      await this.publishPreKeyBundle(fromPeerId);
      const knownKeys = this.store.get("peer-public-keys", {});
      knownKeys[fromPeerId] = msg.publicKey;
      this.store.set("peer-public-keys", knownKeys);
      this.updateWorkspaceMemberKey(fromPeerId, msg.publicKey);
      if (msg.alias) {
        this.applyNameAnnounce(fromPeerId, {
          alias: msg.alias,
          workspaceId: typeof msg.workspaceId === "string" ? msg.workspaceId : undefined,
          companySim: msg.companySim,
          isBot: msg.isBot === true,
          publicKey: typeof msg.publicKey === "string" ? msg.publicKey : undefined
        });
      }
      const HANDSHAKE_RESEND_SUPPRESS_MS = 5000;
      const lastSentAt = this.connectHandshakeAtByPeer.get(fromPeerId) ?? 0;
      const recentlySentToPeer = lastSentAt > 0 && Date.now() - lastSentAt < HANDSHAKE_RESEND_SUPPRESS_MS;
      if (!recentlySentToPeer) {
        await this.sendHandshake(fromPeerId);
      } else {
        this.opts.log?.debug?.(`[decentchat-peer] suppressing handshake re-send to ${fromPeerId.slice(0, 8)} ` + `(sent ${Date.now() - lastSentAt}ms ago, < ${HANDSHAKE_RESEND_SUPPRESS_MS}ms) — ` + `prevents auth-challenge nonce overwrite race`);
      }
      await this.resumePeerSession(fromPeerId);
      return;
    }
    if (msg?.type === "name-announce" && msg.alias) {
      const alias = msg.alias;
      const result2 = this.applyNameAnnounce(fromPeerId, {
        alias,
        workspaceId: typeof msg.workspaceId === "string" ? msg.workspaceId : undefined,
        companySim: msg.companySim,
        isBot: msg.isBot === true
      });
      if (result2.memberAdded && result2.workspaceId && this.syncProtocol) {
        this.syncProtocol.requestSync(fromPeerId, result2.workspaceId);
      }
      this.store.set(`peer-alias-${fromPeerId}`, alias);
      return;
    }
    if (msg?.type === "workspace-sync" && msg.sync) {
      const merged = msg.workspaceId ? { ...msg.sync, workspaceId: msg.workspaceId } : msg.sync;
      if (merged.type === "workspace-state" && merged.workspaceId) {
        this.handleWorkspaceState(fromPeerId, merged.workspaceId, merged);
        return;
      }
      await this.syncProtocol.handleMessage(fromPeerId, merged);
      return;
    }
    if (msg?.type === "message-sync-negentropy-query") {
      await this.handleNegentropyQuery(fromPeerId, msg);
      return;
    }
    if (msg?.type === "message-sync-fetch-request") {
      await this.handleFetchRequest(fromPeerId, msg);
      return;
    }
    if (msg?.type === "message-sync-request") {
      await this.handleMessageSyncRequest(fromPeerId, msg);
      return;
    }
    if (msg?.type === "message-sync-response") {
      await this.handleMessageSyncResponse(fromPeerId, msg);
      return;
    }
    if (msg?.type === "sync.summary") {
      await this.handleManifestSummary(fromPeerId, msg);
      return;
    }
    if (msg?.type === "sync.diff_request") {
      await this.handleManifestDiffRequest(fromPeerId, msg);
      return;
    }
    if (msg?.type === "sync.diff_response") {
      await this.handleManifestDiffResponse(fromPeerId, msg);
      return;
    }
    if (msg?.type === "sync.fetch_snapshot") {
      await this.handleManifestFetchSnapshot(fromPeerId, msg);
      return;
    }
    if (msg?.type === "sync.snapshot_response") {
      await this.handleManifestSnapshotResponse(fromPeerId, msg);
      return;
    }
    if (typeof msg?.type === "string" && msg.type.startsWith("custody.")) {
      await this.handleCustodyControl(fromPeerId, msg);
      return;
    }
    if (msg?.type === "media-request") {
      await this.handleMediaRequest(fromPeerId, msg);
      return;
    }
    if (msg?.type === "media-response") {
      await this.handleMediaResponse(fromPeerId, msg);
      return;
    }
    if (msg?.type === "media-chunk") {
      await this.handleMediaChunk(fromPeerId, msg);
      return;
    }
    const gossipOrigId = typeof msg?._originalMessageId === "string" ? msg._originalMessageId : undefined;
    if (gossipOrigId && this._gossipSeen.has(gossipOrigId)) {
      return;
    }
    if (typeof msg?.type === "string" && msg.type.startsWith("huddle-")) {
      await this.botHuddle?.handleSignal(fromPeerId, msg);
      return;
    }
    if (!msg?.encrypted && !msg?.ratchet) {
      return;
    }
    const peerPubKeyB64 = this.getPeerPublicKey(fromPeerId);
    if (!peerPubKeyB64) {
      this.opts.log?.warn?.(`[decentchat-peer] missing public key for ${fromPeerId}, skipping message`);
      return;
    }
    const peerPublicKey = await this.cryptoManager.importPublicKey(peerPubKeyB64);
    let content;
    try {
      content = await this.messageProtocol.decryptMessage(fromPeerId, msg, peerPublicKey);
    } catch (err) {
      if (this.shouldIgnoreDecryptReplay(fromPeerId, msg, err)) {
        this.opts.log?.info?.(`[decentchat-peer] replayed pre-key from ${fromPeerId} ignored`);
        return;
      }
      this.opts.log?.warn?.(`[decentchat-peer] decrypt threw for ${fromPeerId}, resetting ratchet: ${String(err)}`);
      await this.triggerDecryptRecoveryHandshake(fromPeerId);
      return;
    }
    if (!content) {
      this.opts.log?.warn?.(`[decentchat-peer] decrypt returned null for ${fromPeerId}, resetting ratchet`);
      await this.triggerDecryptRecoveryHandshake(fromPeerId);
      return;
    }
    this.decryptRecoveryAtByPeer.delete(fromPeerId);
    const isDirect = msg.isDirect === true;
    const channelId = msg.channelId ?? (isDirect ? fromPeerId : undefined);
    if (!channelId)
      return;
    const envelopeMessageId = typeof msg.messageId === "string" && msg.messageId.length > 0 ? msg.messageId : gossipOrigId ?? "";
    const senderResolution = await this.resolveInboundSenderId(fromPeerId, trustedSenderId, msg, channelId, envelopeMessageId, content);
    const actualSenderId = senderResolution.senderId;
    const created = await this.messageStore.createMessage(channelId, actualSenderId, content, "text", msg.threadId);
    const lastTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
    created.timestamp = Math.max(msg.timestamp ?? Date.now(), lastTs + 1);
    if (typeof msg.messageId === "string") {
      created.id = msg.messageId;
    }
    const result = await this.messageStore.addMessage(created);
    if (!result.success) {
      this.opts.log?.warn?.(`[decentchat-peer] rejected message ${created.id}: ${result.error}`);
      const dupAckPayload = {
        type: "ack",
        messageId: created.id,
        channelId,
        ...typeof msg.envelopeId === "string" ? { envelopeId: msg.envelopeId } : {}
      };
      try {
        const accepted = this.transport.send(fromPeerId, dupAckPayload);
        if (!accepted) {
          await this.enqueueOffline(fromPeerId, dupAckPayload);
        }
      } catch (_) {}
      return;
    }
    this._gossipSeen.set(created.id, Date.now());
    this.persistMessagesForChannel(channelId);
    const workspaceId = msg.workspaceId ?? (isDirect ? "direct" : "");
    this.recordManifestDomain("channel-message", workspaceId || this.findWorkspaceIdForChannel(channelId), {
      channelId,
      itemCount: this.messageStore.getMessages(channelId).length,
      operation: "create",
      subject: created.id,
      data: { messageId: created.id, senderId: actualSenderId }
    });
    const ackPayload = {
      type: "ack",
      messageId: created.id,
      channelId,
      ...typeof msg.envelopeId === "string" ? { envelopeId: msg.envelopeId } : {}
    };
    try {
      const ackAccepted = this.transport.send(fromPeerId, ackPayload);
      console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0, 8)} msgId=${created.id.slice(0, 8)} accepted=${ackAccepted} (encrypted-path)`);
      if (!ackAccepted) {
        await this.enqueueOffline(fromPeerId, ackPayload);
      }
    } catch (ackErr) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to send ack to ${fromPeerId}: ${String(ackErr)}`);
      await this.enqueueOffline(fromPeerId, ackPayload);
    }
    const senderName = this.resolveSenderName(workspaceId, actualSenderId, msg.senderName);
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : undefined;
    await this.opts.onIncomingMessage({
      channelId,
      workspaceId,
      content,
      senderId: actualSenderId,
      senderName,
      messageId: created.id,
      chatType: msg.isDirect ? "direct" : "channel",
      timestamp: created.timestamp,
      replyToId: msg.replyToId,
      threadId: msg.threadId,
      attachments
    });
    if (!isDirect && senderResolution.allowRelay) {
      this.gossipRelay(fromPeerId, created.id, actualSenderId, content, channelId, msg);
    }
  }
  async handleNegentropyQuery(fromPeerId, msg) {
    const wsId = msg.workspaceId;
    const channelId = msg.channelId;
    const requestId = msg.requestId;
    const query = msg.query;
    const sendReject = (reason) => {
      this.opts.log?.warn?.(`[decentchat-peer] Negentropy query rejected from ${fromPeerId.slice(0, 8)}: ${reason}`);
      if (!this.transport || !requestId)
        return;
      this.transport.send(fromPeerId, {
        type: "message-sync-negentropy-response",
        requestId,
        ...wsId ? { workspaceId: wsId } : {},
        ...channelId ? { channelId } : {},
        response: {
          have: [],
          need: []
        },
        error: "rejected"
      });
    };
    if (!wsId || !channelId || !requestId || !query) {
      sendReject("invalid-request");
      return;
    }
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) {
      sendReject("workspace-not-found");
      return;
    }
    if (!ws.members.some((m) => m.peerId === fromPeerId)) {
      sendReject("peer-not-member");
      return;
    }
    if (!ws.channels.some((ch) => ch.id === channelId)) {
      sendReject("channel-not-found");
      return;
    }
    const localItems = this.messageStore.getMessages(channelId).map((m) => ({ id: m.id, timestamp: m.timestamp }));
    const negentropy = new Negentropy;
    await negentropy.build(localItems);
    const response = await negentropy.processQuery(query);
    this.transport.send(fromPeerId, {
      type: "message-sync-negentropy-response",
      requestId,
      workspaceId: wsId,
      channelId,
      response
    });
    this.opts.log?.info?.(`[decentchat-peer] Negentropy query from ${fromPeerId.slice(0, 8)} for channel ${channelId.slice(0, 8)}: ${localItems.length} local messages`);
  }
  async handleFetchRequest(fromPeerId, msg) {
    const wsId = msg.workspaceId;
    if (!wsId)
      return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws)
      return;
    if (!ws.members.some((m) => m.peerId === fromPeerId))
      return;
    const requested = msg.messageIdsByChannel || {};
    const allMessages = [];
    for (const ch of ws.channels) {
      const requestedIds = Array.isArray(requested[ch.id]) ? requested[ch.id] : [];
      if (requestedIds.length === 0)
        continue;
      const idSet = new Set(requestedIds.filter((id) => typeof id === "string"));
      if (idSet.size === 0)
        continue;
      const channelMessages = this.messageStore.getMessages(ch.id).filter((m) => idSet.has(m.id)).sort((a, b) => a.timestamp - b.timestamp);
      for (const m of channelMessages) {
        allMessages.push({
          id: m.id,
          channelId: m.channelId,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
          type: m.type,
          threadId: m.threadId,
          prevHash: m.prevHash,
          vectorClock: m.vectorClock
        });
      }
    }
    if (allMessages.length > 0) {
      this.transport.send(fromPeerId, {
        type: "message-sync-response",
        workspaceId: wsId,
        messages: allMessages
      });
    }
    this.opts.log?.info?.(`[decentchat-peer] Fetch request from ${fromPeerId.slice(0, 8)}: sent ${allMessages.length} messages`);
  }
  async handleMessageSyncRequest(fromPeerId, msg) {
    const wsId = msg.workspaceId;
    if (!wsId)
      return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws)
      return;
    if (!ws.members.some((m) => m.peerId === fromPeerId))
      return;
    const channelTimestamps = msg.channelTimestamps || {};
    const allMessages = [];
    for (const ch of ws.channels) {
      const since = channelTimestamps[ch.id] ?? 0;
      const msgs = this.messageStore.getMessages(ch.id);
      const newer = msgs.filter((m) => m.timestamp > since);
      for (const m of newer) {
        allMessages.push({
          id: m.id,
          channelId: ch.id,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp
        });
      }
    }
    if (allMessages.length > 0) {
      this.transport.send(fromPeerId, {
        type: "message-sync-response",
        workspaceId: wsId,
        messages: allMessages
      });
    }
  }
  async handleMessageSyncResponse(fromPeerId, msg) {
    const wsId = msg.workspaceId;
    const messages = Array.isArray(msg.messages) ? msg.messages : [];
    if (!messages.length)
      return;
    const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
    if (wsId && !ws)
      return;
    if (ws && !ws.members.some((m) => m.peerId === fromPeerId))
      return;
    let seededAnyChannel = false;
    const channelTimestamps = new Map;
    for (const m of messages) {
      const cid = typeof m.channelId === "string" ? m.channelId : null;
      const ts = typeof m.timestamp === "number" ? m.timestamp : 0;
      if (!cid || !ts)
        continue;
      const prev = channelTimestamps.get(cid) ?? 0;
      if (ts > prev)
        channelTimestamps.set(cid, ts);
    }
    for (const [cid, maxTs] of channelTimestamps) {
      if (!this.unverifiedSurfacedTsByChannel.has(cid)) {
        const seedTs = Math.max(0, maxTs - 1);
        this.unverifiedSurfacedTsByChannel.set(cid, seedTs);
        seededAnyChannel = true;
        this.opts.log?.info?.(`[decentchat-peer] seeded unverified high-water for channel ${cid.slice(0, 8)} = ${seedTs} ` + `(batchMax=${maxTs}, legacy backfill, newest message still eligible to surface)`);
      }
    }
    if (seededAnyChannel) {
      try {
        this.store.set(DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY, Object.fromEntries(this.unverifiedSurfacedTsByChannel));
      } catch (_) {}
    }
    this.opts.log?.info?.(`[decentchat-peer] message-sync-response from ${fromPeerId.slice(0, 8)}: ${messages.length} messages`);
    const RECENT_CUTOFF_MS = this.startedAt - 60000;
    const MAX_ACKS_PER_SYNC_RESPONSE = 5;
    let acksSent = 0;
    const importFailedChannels = new Set;
    let importFailedCount = 0;
    for (const m of messages) {
      const channelId = typeof m.channelId === "string" ? m.channelId : null;
      const id = typeof m.id === "string" ? m.id : "";
      const senderId = typeof m.senderId === "string" ? m.senderId : fromPeerId;
      const content = typeof m.content === "string" ? m.content : "";
      const ts = typeof m.timestamp === "number" ? m.timestamp : Date.now();
      if (!channelId || !id)
        continue;
      if (senderId === this.myPeerId)
        continue;
      const existing = this.messageStore.getMessages(channelId);
      const alreadyStored = existing.some((ex) => ex.id === id);
      if (alreadyStored)
        continue;
      if (!content)
        continue;
      const resolvedWsId = wsId || this.findWorkspaceIdForChannel(channelId);
      if (!resolvedWsId)
        continue;
      const storedMsg = {
        id,
        channelId,
        workspaceId: resolvedWsId,
        senderId,
        senderName: m.senderName || senderId.slice(0, 8),
        content,
        timestamp: ts,
        type: m.type || "text"
      };
      const importResult = await this.messageStore.importMessages(channelId, [...existing, storedMsg]);
      if (!importResult?.success) {
        importFailedCount++;
        const errMsg = importResult?.error ?? "unknown error";
        const isStructurallyUnverifiable = errMsg.includes("got undefined") || errMsg.includes("invalid genesis hash");
        const suppressionKey = `${fromPeerId}:${channelId}`;
        const lastLoggedAt = this.syncImportFailLastLogAt.get(suppressionKey) ?? 0;
        const now = Date.now();
        const shouldLog = !importFailedChannels.has(channelId) && now - lastLoggedAt >= DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS;
        importFailedChannels.add(channelId);
        if (shouldLog) {
          this.syncImportFailLastLogAt.set(suppressionKey, now);
          const line = `[decentchat-peer] sync import failed for msg ${id.slice(0, 8)} in channel ${channelId.slice(0, 8)}: ${errMsg} — skipping ACK/persist ` + (isStructurallyUnverifiable ? "(will still surface to agent once — legacy chain) " : "") + `(further failures for this peer/channel suppressed for ${Math.round(DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS / 60000)}min)`;
          if (isStructurallyUnverifiable) {
            this.opts.log?.info?.(line);
          } else {
            this.opts.log?.warn?.(line);
          }
        }
        if (!isStructurallyUnverifiable) {
          continue;
        }
        if (this.unverifiedSurfacedIds.has(id)) {
          continue;
        }
        const channelHighWater = this.unverifiedSurfacedTsByChannel.get(channelId) ?? 0;
        if (ts <= channelHighWater) {
          continue;
        }
        this.unverifiedSurfacedIds.add(id);
        this.unverifiedSurfacedTsByChannel.set(channelId, ts);
        if (this.unverifiedSurfacedIds.size > DecentChatNodePeer.UNVERIFIED_SURFACED_MAX) {
          const first = this.unverifiedSurfacedIds.values().next().value;
          if (first !== undefined)
            this.unverifiedSurfacedIds.delete(first);
        }
        try {
          this.store.set(DecentChatNodePeer.UNVERIFIED_SURFACED_STORE_KEY, Array.from(this.unverifiedSurfacedIds));
          this.store.set(DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY, Object.fromEntries(this.unverifiedSurfacedTsByChannel));
        } catch (_) {}
        this.opts.log?.info?.(`[decentchat-peer] surfacing unverified msg ${id.slice(0, 8)} to agent ` + `(legacy chain in ${channelId.slice(0, 8)}) — will not persist`);
        if (acksSent < MAX_ACKS_PER_SYNC_RESPONSE) {
          try {
            if (this.transport) {
              const accepted = this.transport.send(fromPeerId, {
                type: "ack",
                messageId: id,
                channelId
              });
              console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0, 8)} msgId=${id.slice(0, 8)} accepted=${accepted} (unverified-surface)`);
              acksSent++;
            }
          } catch (_) {}
        }
        await this.opts.onIncomingMessage({
          channelId,
          workspaceId: resolvedWsId,
          content,
          senderId,
          senderName: storedMsg.senderName,
          messageId: id,
          chatType: "channel",
          timestamp: ts,
          replyToId: typeof m.replyToId === "string" ? m.replyToId : undefined,
          threadId: typeof m.threadId === "string" ? m.threadId : undefined
        });
        continue;
      }
      this.persistMessagesForChannel(channelId);
      const ackPayload = {
        type: "ack",
        messageId: id,
        channelId
      };
      if (acksSent < MAX_ACKS_PER_SYNC_RESPONSE) {
        try {
          if (this.transport) {
            const accepted = this.transport.send(fromPeerId, ackPayload);
            console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0, 8)} msgId=${id.slice(0, 8)} accepted=${accepted} (sync-path)`);
            if (!accepted) {
              await this.enqueueOffline(fromPeerId, ackPayload);
            }
            acksSent++;
          }
        } catch (err) {
          this.opts.log?.warn?.(`[decentchat-peer] failed to ack synced message ${id.slice(0, 8)}: ${String(err)}`);
          try {
            await this.enqueueOffline(fromPeerId, ackPayload);
          } catch (_) {}
        }
      } else if (acksSent === MAX_ACKS_PER_SYNC_RESPONSE) {
        console.log(`[decentchat-peer] ACK throttled for ${fromPeerId.slice(0, 8)}: ${messages.length - acksSent} skipped (will retry via sync)`);
        acksSent++;
      }
      if (ts < RECENT_CUTOFF_MS)
        continue;
      await this.opts.onIncomingMessage({
        channelId,
        workspaceId: resolvedWsId,
        content,
        senderId,
        senderName: storedMsg.senderName,
        messageId: id,
        chatType: "channel",
        timestamp: ts,
        replyToId: typeof m.replyToId === "string" ? m.replyToId : undefined,
        threadId: typeof m.threadId === "string" ? m.threadId : undefined
      });
    }
    if (importFailedCount > 0) {
      const summaryKey = `${fromPeerId}:__summary__`;
      const lastSummaryAt = this.syncImportFailLastLogAt.get(summaryKey) ?? 0;
      const now = Date.now();
      if (now - lastSummaryAt >= DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS) {
        this.syncImportFailLastLogAt.set(summaryKey, now);
        this.opts.log?.info?.(`[decentchat-peer] sync import summary from ${fromPeerId.slice(0, 8)}: ${importFailedCount}/${messages.length} messages failed verification across ${importFailedChannels.size} channel(s)`);
      }
    }
  }
  sendMessageSyncRequest(peerId, workspaceId, channelTimestamps = {}) {
    if (!this.transport)
      return;
    this.transport.send(peerId, {
      type: "message-sync-request",
      workspaceId,
      channelTimestamps
    });
    this.opts.log?.info?.(`[decentchat-peer] sent message-sync-request to ${peerId.slice(0, 8)}`);
  }
  resolveSharedWorkspaceIds(peerId) {
    if (!peerId)
      return [];
    const ids = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const memberPeerIds = new Set(workspace.members.map((member) => member.peerId));
      if (memberPeerIds.has(peerId) && memberPeerIds.has(this.myPeerId)) {
        ids.push(workspace.id);
      }
    }
    return ids;
  }
  isWorkspaceMember(peerId, workspaceId) {
    if (!workspaceId || !peerId)
      return false;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return false;
    return workspace.members.some((member) => member.peerId === peerId);
  }
  resolveNameAnnounceWorkspaceId(peerId) {
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    const workspaceWithPeer = allWorkspaces.find((ws) => ws.members.some((m) => m.peerId === peerId));
    if (workspaceWithPeer)
      return workspaceWithPeer.id;
    if (allWorkspaces.length === 1)
      return allWorkspaces[0]?.id;
    return;
  }
  applyNameAnnounce(peerId, params) {
    const alias = params.alias.trim();
    if (!alias)
      return { changed: false, memberAdded: false, workspaceId: params.workspaceId };
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    const hintedWorkspace = params.workspaceId ? this.workspaceManager.getWorkspace(params.workspaceId) : undefined;
    const existingWorkspace = allWorkspaces.find((ws) => ws.members.some((member) => member.peerId === peerId));
    const fallbackWorkspace = allWorkspaces.length === 1 ? allWorkspaces[0] : undefined;
    const targetWorkspace = hintedWorkspace ?? existingWorkspace ?? fallbackWorkspace;
    let changed = false;
    let memberAdded = false;
    if (targetWorkspace) {
      let member = targetWorkspace.members.find((entry) => entry.peerId === peerId);
      if (!member) {
        member = {
          peerId,
          alias,
          publicKey: params.publicKey ?? "",
          role: "member",
          joinedAt: Date.now(),
          ...params.isBot ? { isBot: true } : {},
          ...params.companySim ? { companySim: params.companySim } : {}
        };
        targetWorkspace.members.push(member);
        changed = true;
        memberAdded = true;
      } else {
        const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(alias);
        const currentAlias = String(member.alias || "").trim();
        const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
        if (!incomingLooksLikeId || currentLooksLikeId || !currentAlias) {
          if (member.alias !== alias) {
            member.alias = alias;
            changed = true;
          }
        }
      }
      if (params.publicKey && member.publicKey !== params.publicKey) {
        member.publicKey = params.publicKey;
        changed = true;
      }
      if (params.isBot === true && !member.isBot) {
        member.isBot = true;
        changed = true;
      }
      if (params.companySim) {
        const before = JSON.stringify(member.companySim || null);
        const after = JSON.stringify(params.companySim);
        if (before !== after) {
          member.companySim = params.companySim;
          changed = true;
        }
      }
      if (changed) {
        this.persistWorkspaces();
      }
      return { changed, memberAdded, workspaceId: targetWorkspace.id };
    }
    this.updateWorkspaceMemberAlias(peerId, alias, params.companySim, params.isBot);
    return { changed: false, memberAdded: false, workspaceId: params.workspaceId };
  }
  preKeyBundleVersionToken(bundle) {
    const signedPreKeyId = typeof bundle?.signedPreKey?.keyId === "number" ? bundle.signedPreKey.keyId : 0;
    const oneTimeCount = Array.isArray(bundle?.oneTimePreKeys) ? bundle.oneTimePreKeys.length : 0;
    const firstOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && typeof bundle.oneTimePreKeys[0]?.keyId === "number" ? bundle.oneTimePreKeys[0].keyId : 0;
    const lastOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && oneTimeCount > 0 && typeof bundle.oneTimePreKeys[oneTimeCount - 1]?.keyId === "number" ? bundle.oneTimePreKeys[oneTimeCount - 1].keyId : 0;
    return `${signedPreKeyId}:${oneTimeCount}:${firstOneTimeId}:${lastOneTimeId}`;
  }
  async publishPreKeyBundleToDomain(workspaceId, bundle) {
    if (!workspaceId || !this.transport)
      return;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return;
    const versionToken = this.preKeyBundleVersionToken(bundle);
    if (this.publishedPreKeyVersionByWorkspace.get(workspaceId) === versionToken) {
      return;
    }
    const recipients = workspace.members.map((member) => member.peerId).filter((peerId) => peerId && peerId !== this.myPeerId);
    if (recipients.length === 0)
      return;
    const payload = {
      type: "pre-key-bundle.publish",
      workspaceId,
      ownerPeerId: this.myPeerId,
      bundle
    };
    const opId = `pre-key-bundle:${this.myPeerId}:${versionToken}`;
    for (const recipientPeerId of recipients) {
      await this.custodyStore.storeEnvelope({
        opId,
        recipientPeerIds: [recipientPeerId],
        workspaceId,
        domain: "pre-key-bundle",
        ciphertext: payload,
        metadata: {
          ownerPeerId: this.myPeerId,
          preKeyVersion: versionToken,
          bundleGeneratedAt: bundle?.generatedAt,
          signedPreKeyId: bundle?.signedPreKey?.keyId
        }
      });
      await this.replicateToCustodians(recipientPeerId, {
        workspaceId,
        opId,
        domain: "pre-key-bundle"
      });
      if (this.transport.getConnectedPeers().includes(recipientPeerId)) {
        this.transport.send(recipientPeerId, payload);
      }
    }
    this.recordManifestDomain("pre-key-bundle", workspaceId, {
      operation: "update",
      subject: this.myPeerId,
      itemCount: recipients.length,
      data: {
        ownerPeerId: this.myPeerId,
        preKeyVersion: versionToken,
        bundleGeneratedAt: bundle?.generatedAt,
        signedPreKeyId: bundle?.signedPreKey?.keyId
      }
    });
    this.publishedPreKeyVersionByWorkspace.set(workspaceId, versionToken);
  }
  async publishPreKeyBundle(peerId) {
    if (!this.transport || !this.messageProtocol)
      return;
    try {
      const bundle = await this.messageProtocol.createPreKeyBundle();
      const sharedWorkspaceIds = this.resolveSharedWorkspaceIds(peerId);
      const workspaceId = sharedWorkspaceIds[0];
      this.transport.send(peerId, {
        type: "pre-key-bundle.publish",
        ...workspaceId ? { workspaceId } : {},
        ownerPeerId: this.myPeerId,
        bundle
      });
      for (const sharedWorkspaceId of sharedWorkspaceIds) {
        await this.publishPreKeyBundleToDomain(sharedWorkspaceId, bundle);
      }
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to publish pre-key bundle to ${peerId.slice(0, 8)}: ${String(error)}`);
    }
  }
  shouldAttemptPreKeyBootstrap(error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.includes("No shared secret with peer");
  }
  resolvePreKeyLookupCandidates(ownerPeerId, workspaceId) {
    if (!this.transport || !ownerPeerId)
      return [];
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      return (workspace?.members ?? []).map((member) => member.peerId).filter((peerId) => peerId && peerId !== this.myPeerId && peerId !== ownerPeerId && connectedPeers.has(peerId));
    }
    return Array.from(connectedPeers).filter((peerId) => peerId !== this.myPeerId && peerId !== ownerPeerId);
  }
  resolveLikelyPreKeyCustodians(ownerPeerId, workspaceId) {
    if (!workspaceId)
      return [];
    return this.selectCustodianPeers(workspaceId, ownerPeerId);
  }
  async requestPreKeyBundleFromPeers(ownerPeerId, workspaceId, opts) {
    if (!this.transport || !this.messageProtocol || !ownerPeerId)
      return false;
    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(ownerPeerId)[0];
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    const requestedCandidates = opts?.candidatePeerIds ?? this.resolvePreKeyLookupCandidates(ownerPeerId, resolvedWorkspaceId);
    const candidates = Array.from(new Set(requestedCandidates)).filter((peerId) => peerId && peerId !== this.myPeerId && peerId !== ownerPeerId && connectedPeers.has(peerId)).filter((peerId) => !resolvedWorkspaceId || this.isWorkspaceMember(peerId, resolvedWorkspaceId));
    if (candidates.length === 0)
      return false;
    const requestId = randomUUID();
    const timeoutMs = Math.max(250, opts?.timeoutMs ?? DecentChatNodePeer.PRE_KEY_FETCH_TIMEOUT_MS);
    const querySource = opts?.querySource ?? "peer-broadcast";
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }, timeoutMs);
      const pending = {
        ownerPeerId,
        ...resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {},
        pendingPeerIds: new Set(candidates),
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingPreKeyBundleFetches.delete(requestId);
          resolve(value);
        },
        timer
      };
      this.pendingPreKeyBundleFetches.set(requestId, pending);
      let sentCount = 0;
      for (const peerId of candidates) {
        const accepted = this.transport.send(peerId, {
          type: "pre-key-bundle.fetch",
          requestId,
          ownerPeerId,
          ...resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {},
          querySource
        });
        if (accepted) {
          sentCount += 1;
        } else {
          pending.pendingPeerIds.delete(peerId);
        }
      }
      if (sentCount === 0 || pending.pendingPeerIds.size === 0) {
        clearTimeout(timer);
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }
    });
    return result;
  }
  async ensurePeerPreKeyBundle(peerId, workspaceId) {
    if (!this.messageProtocol || !peerId)
      return false;
    const existing = await this.messageProtocol.getPeerPreKeyBundle(peerId);
    if (existing)
      return true;
    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(peerId)[0];
    const likelyCustodians = this.resolveLikelyPreKeyCustodians(peerId, resolvedWorkspaceId);
    if (likelyCustodians.length > 0) {
      const hydratedViaCustodians = await this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        timeoutMs: 1200,
        querySource: "custodian-targeted"
      });
      if (hydratedViaCustodians)
        return true;
    }
    const fallbackCandidates = this.resolvePreKeyLookupCandidates(peerId, resolvedWorkspaceId).filter((candidatePeerId) => !likelyCustodians.includes(candidatePeerId));
    if (fallbackCandidates.length === 0) {
      return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        querySource: "peer-broadcast"
      });
    }
    return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
      candidatePeerIds: fallbackCandidates,
      querySource: "peer-broadcast"
    });
  }
  async encryptMessageWithPreKeyBootstrap(peerId, content, metadata, workspaceId) {
    if (!this.messageProtocol) {
      throw new Error("Message protocol unavailable");
    }
    try {
      return await this.messageProtocol.encryptMessage(peerId, content, "text", metadata);
    } catch (error) {
      if (!this.shouldAttemptPreKeyBootstrap(error))
        throw error;
      const hydrated = await this.ensurePeerPreKeyBundle(peerId, workspaceId);
      if (!hydrated)
        throw error;
      return this.messageProtocol.encryptMessage(peerId, content, "text", metadata);
    }
  }
  async handlePreKeyControl(fromPeerId, msg) {
    if (!this.transport || !this.messageProtocol)
      return false;
    if (msg?.type === "pre-key-bundle.publish") {
      if (!msg.bundle)
        return true;
      const ownerPeerId = typeof msg?.ownerPeerId === "string" ? msg.ownerPeerId : fromPeerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
      const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain("pre-key-bundle", workspaceId, {
          operation: "update",
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: "publish",
            bundleGeneratedAt: msg.bundle?.generatedAt,
            signedPreKeyId: msg.bundle?.signedPreKey?.keyId
          }
        });
      }
      return true;
    }
    if (msg?.type === "pre-key-bundle.request") {
      try {
        const bundle = await this.messageProtocol.createPreKeyBundle();
        this.transport.send(fromPeerId, {
          type: "pre-key-bundle.response",
          ownerPeerId: this.myPeerId,
          ...typeof msg?.workspaceId === "string" ? { workspaceId: msg.workspaceId } : {},
          bundle
        });
      } catch (error) {
        this.opts.log?.warn?.(`[decentchat-peer] failed to respond with pre-key bundle to ${fromPeerId.slice(0, 8)}: ${String(error)}`);
      }
      return true;
    }
    if (msg?.type === "pre-key-bundle.response") {
      if (!msg.bundle)
        return true;
      const ownerPeerId = typeof msg?.ownerPeerId === "string" ? msg.ownerPeerId : fromPeerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
      const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain("pre-key-bundle", workspaceId, {
          operation: "update",
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: "response",
            bundleGeneratedAt: msg.bundle?.generatedAt,
            signedPreKeyId: msg.bundle?.signedPreKey?.keyId
          }
        });
      }
      return true;
    }
    if (msg?.type === "pre-key-bundle.fetch") {
      const requestId = typeof msg?.requestId === "string" ? msg.requestId : "";
      const ownerPeerId = typeof msg?.ownerPeerId === "string" ? msg.ownerPeerId : "";
      if (!requestId || !ownerPeerId)
        return true;
      const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : undefined;
      if (workspaceId) {
        const workspace = this.workspaceManager.getWorkspace(workspaceId);
        const memberPeerIds = new Set((workspace?.members ?? []).map((member) => member.peerId));
        if (!workspace || !memberPeerIds.has(fromPeerId) || !memberPeerIds.has(ownerPeerId) || !memberPeerIds.has(this.myPeerId)) {
          return true;
        }
      }
      const querySource = msg?.querySource === "custodian-targeted" || msg?.querySource === "peer-broadcast" ? msg.querySource : undefined;
      const bundle = await this.messageProtocol.getPeerPreKeyBundle(ownerPeerId);
      this.transport.send(fromPeerId, {
        type: "pre-key-bundle.fetch-response",
        requestId,
        ownerPeerId,
        ...workspaceId ? { workspaceId } : {},
        ...querySource ? { querySource } : {},
        ...bundle ? { bundle } : { notAvailable: true }
      });
      return true;
    }
    if (msg?.type === "pre-key-bundle.fetch-response") {
      const requestId = typeof msg?.requestId === "string" ? msg.requestId : "";
      if (!requestId)
        return true;
      const pending = this.pendingPreKeyBundleFetches.get(requestId);
      if (!pending)
        return true;
      if (!pending.pendingPeerIds.has(fromPeerId))
        return true;
      const ownerPeerId = typeof msg?.ownerPeerId === "string" ? msg.ownerPeerId : pending.ownerPeerId;
      if (ownerPeerId !== pending.ownerPeerId)
        return true;
      pending.pendingPeerIds.delete(fromPeerId);
      if (msg?.bundle) {
        const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
        const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : pending.workspaceId;
        if (stored && workspaceId) {
          this.recordManifestDomain("pre-key-bundle", workspaceId, {
            operation: "update",
            subject: ownerPeerId,
            itemCount: 1,
            data: {
              ownerPeerId,
              source: "fetch-response",
              bundleGeneratedAt: msg.bundle?.generatedAt,
              signedPreKeyId: msg.bundle?.signedPreKey?.keyId
            }
          });
        }
        if (stored) {
          pending.resolve(true);
          return true;
        }
      }
      if (pending.pendingPeerIds.size === 0) {
        pending.resolve(false);
      }
      return true;
    }
    return false;
  }
  buildCustodyResendMetadata(payload) {
    return {
      ...payload.isDirect ? { isDirect: true } : {},
      ...payload.replyToId ? { replyToId: payload.replyToId } : {},
      senderId: payload.senderId ?? this.myPeerId,
      senderName: payload.senderName ?? this.opts.account.alias,
      resend: {
        content: payload.content,
        ...payload.channelId ? { channelId: payload.channelId } : {},
        ...payload.workspaceId ? { workspaceId: payload.workspaceId } : {},
        ...payload.threadId ? { threadId: payload.threadId } : {},
        ...payload.replyToId ? { replyToId: payload.replyToId } : {},
        ...payload.isDirect ? { isDirect: true } : {},
        ...payload.gossipOriginSignature ? { gossipOriginSignature: payload.gossipOriginSignature } : {},
        ...payload.metadata ? { metadata: payload.metadata } : {}
      }
    };
  }
  getCustodyResendPayload(envelope) {
    const metadata = isRecord3(envelope.metadata) ? envelope.metadata : null;
    const resend = metadata && isRecord3(metadata.resend) ? metadata.resend : null;
    const content = typeof resend?.content === "string" ? resend.content.trim() : "";
    if (!content)
      return null;
    return {
      content,
      channelId: typeof resend?.channelId === "string" ? resend.channelId : undefined,
      workspaceId: typeof resend?.workspaceId === "string" ? resend.workspaceId : undefined,
      senderId: typeof metadata?.senderId === "string" ? metadata.senderId : undefined,
      senderName: typeof metadata?.senderName === "string" ? metadata.senderName : undefined,
      threadId: typeof resend?.threadId === "string" ? resend.threadId : undefined,
      replyToId: typeof resend?.replyToId === "string" ? resend.replyToId : undefined,
      isDirect: resend?.isDirect === true,
      gossipOriginSignature: typeof resend?.gossipOriginSignature === "string" ? resend.gossipOriginSignature : undefined,
      metadata: resend?.metadata
    };
  }
  shouldReencryptCustodyEnvelope(envelope) {
    if (!isRecord3(envelope.ciphertext))
      return false;
    return envelope.ciphertext.protocolVersion === 3 && isRecord3(envelope.ciphertext.sessionInit);
  }
  hasProtocolSession(peerId) {
    const methodName = "hasShared" + "Sec" + "ret";
    const candidate = this.messageProtocol?.[methodName];
    if (typeof candidate !== "function")
      return false;
    const hasSession = candidate;
    return hasSession.call(this.messageProtocol, peerId) ?? false;
  }
  isIncomingPreKeySessionEnvelope(value) {
    return isRecord3(value) && value.protocolVersion === 3 && isRecord3(value.sessionInit);
  }
  shouldIgnoreDecryptReplay(peerId, msg, error) {
    if (!this.isIncomingPreKeySessionEnvelope(msg)) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("Ratchet already established")) {
      return true;
    }
    if (message.includes("Pre-key ") && message.includes(" unavailable") && this.hasProtocolSession(peerId)) {
      return true;
    }
    return false;
  }
  async triggerDecryptRecoveryHandshake(peerId) {
    const now = Date.now();
    const lastRecoveryAt = this.decryptRecoveryAtByPeer.get(peerId) ?? 0;
    if (now - lastRecoveryAt < DecentChatNodePeer.DECRYPT_RECOVERY_HANDSHAKE_COOLDOWN_MS) {
      this.requestPlaintextSyncForPeer(peerId);
      return;
    }
    this.decryptRecoveryAtByPeer.set(peerId, now);
    await this.messageProtocol?.clearRatchetState?.(peerId);
    this.messageProtocol?.clearSharedSecret?.(peerId);
    this.store.delete(`ratchet-${peerId}`);
    await this.sendHandshake(peerId, true);
    this.requestPlaintextSyncForPeer(peerId);
  }
  requestPlaintextSyncForPeer(peerId) {
    if (!this.transport)
      return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((m) => m.peerId === peerId))
        continue;
      const channelTimestamps = {};
      for (const ch of workspace.channels) {
        const msgs = this.messageStore.getMessages(ch.id);
        channelTimestamps[ch.id] = msgs.length > 0 ? Math.max(...msgs.map((m) => m.timestamp)) : 0;
      }
      this.sendMessageSyncRequest(peerId, workspace.id, channelTimestamps);
    }
  }
  async resumePeerSession(peerId) {
    await this.resendPendingAcks(peerId);
    await this.flushOfflineQueue(peerId);
    await this.flushPendingReadReceipts(peerId);
    this.requestSyncForPeer(peerId);
    this.sendManifestSummary(peerId);
    this.requestCustodyRecovery(peerId);
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((m) => m.peerId === peerId))
        continue;
      const channelTimestamps = {};
      for (const ch of workspace.channels) {
        const msgs = this.messageStore.getMessages(ch.id);
        channelTimestamps[ch.id] = msgs.length > 0 ? Math.max(...msgs.map((m) => m.timestamp)) : 0;
      }
      this.sendMessageSyncRequest(peerId, workspace.id, channelTimestamps);
    }
  }
  async handlePeerConnect(peerId) {
    this.opts.log?.info(`[decentchat-peer] peer connected: ${peerId}`);
    this.clearPeerMaintenanceFailure(peerId);
    const now = Date.now();
    const lastHandshakeAt = this.connectHandshakeAtByPeer.get(peerId) ?? 0;
    const cooldownActive = now - lastHandshakeAt < DecentChatNodePeer.CONNECT_HANDSHAKE_COOLDOWN_MS;
    if (!cooldownActive) {
      await this.sendHandshake(peerId);
    } else {
      this.opts.log?.info?.(`[decentchat-peer] handshake cooldown active for ${peerId.slice(0, 8)} (${Math.round((DecentChatNodePeer.CONNECT_HANDSHAKE_COOLDOWN_MS - (now - lastHandshakeAt)) / 1000)}s left), skipping handshake`);
    }
    if (this.hasProtocolSession(peerId)) {
      await this.resumePeerSession(peerId);
    }
  }
  shouldIgnoreInboundHandshakeBurst(peerId) {
    const now = Date.now();
    const lastHandshakeAt = this.inboundHandshakeAtByPeer.get(peerId) ?? 0;
    const hasSession = this.hasProtocolSession(peerId);
    if (hasSession && now - lastHandshakeAt < DecentChatNodePeer.INBOUND_HANDSHAKE_COOLDOWN_MS) {
      return true;
    }
    this.inboundHandshakeAtByPeer.set(peerId, now);
    return false;
  }
  async sendHandshake(peerId, recovery = false) {
    if (!this.transport || !this.messageProtocol)
      return;
    try {
      const handshake = await this.messageProtocol.createHandshake();
      const capabilities = ["negentropy-sync-v1"];
      const payload = { type: "handshake", ...handshake, capabilities };
      if (recovery)
        payload.recovery = true;
      const accepted = this.transport.send(peerId, payload);
      this.connectHandshakeAtByPeer.set(peerId, Date.now());
      this.opts.log?.debug?.(`[decentchat-peer] handshake sent to ${peerId.slice(0, 8)} accepted=${accepted}`);
      await this.publishPreKeyBundle(peerId);
      const announceWorkspaceId = this.resolveNameAnnounceWorkspaceId(peerId);
      this.transport.send(peerId, {
        type: "name-announce",
        alias: this.opts.account.alias,
        isBot: true,
        ...announceWorkspaceId ? { workspaceId: announceWorkspaceId } : {}
      });
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] handshake failed for ${peerId}: ${String(err)}`);
    }
  }
  async handleSyncEvent(event) {
    switch (event.type) {
      case "workspace-joined": {
        this.opts.log?.info(`[decentchat-peer] joined workspace: ${event.workspace.id}`);
        this.persistWorkspaces();
        this.recordManifestDomain("workspace-manifest", event.workspace.id, {
          operation: "update",
          subject: event.workspace.id,
          itemCount: 1,
          data: { name: event.workspace.name }
        });
        this.recordManifestDomain("membership", event.workspace.id, {
          operation: "update",
          subject: event.workspace.id,
          itemCount: event.workspace.members.length,
          data: { memberCount: event.workspace.members.length }
        });
        this.recordManifestDomain("channel-manifest", event.workspace.id, {
          operation: "update",
          subject: event.workspace.id,
          itemCount: event.workspace.channels.length,
          data: { channelCount: event.workspace.channels.length }
        });
        break;
      }
      case "member-joined":
      case "member-left":
      case "channel-created": {
        this.persistWorkspaces();
        const workspaceId = event.workspaceId;
        const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
        if (workspaceId && ws) {
          if (event.type === "channel-created") {
            this.recordManifestDomain("channel-manifest", workspaceId, {
              operation: "create",
              subject: event.channel?.id ?? workspaceId,
              itemCount: ws.channels.length,
              data: { channelCount: ws.channels.length }
            });
          } else {
            this.recordManifestDomain("membership", workspaceId, {
              operation: event.type === "member-joined" ? "create" : "delete",
              subject: event.member?.peerId ?? workspaceId,
              itemCount: ws.members.length,
              data: { memberCount: ws.members.length }
            });
          }
        }
        break;
      }
      case "message-received": {
        this.persistMessagesForChannel(event.channelId);
        this.recordManifestDomain("channel-message", this.findWorkspaceIdForChannel(event.channelId), {
          channelId: event.channelId,
          operation: "create",
          subject: event.message.id,
          itemCount: this.messageStore.getMessages(event.channelId).length,
          data: { messageId: event.message.id, senderId: event.message.senderId }
        });
        const attachments = Array.isArray(event.message.attachments) ? event.message.attachments : undefined;
        await this.opts.onIncomingMessage({
          channelId: event.channelId,
          workspaceId: this.findWorkspaceIdForChannel(event.channelId),
          content: event.message.content,
          senderId: event.message.senderId,
          senderName: this.resolveSenderName(this.findWorkspaceIdForChannel(event.channelId), event.message.senderId),
          messageId: event.message.id,
          chatType: "channel",
          timestamp: event.message.timestamp,
          replyToId: event.message.replyToId,
          threadId: event.message.threadId,
          attachments
        });
        break;
      }
      case "join-rejected":
        this.opts.log?.warn?.(`[decentchat-peer] join REJECTED: ${event.reason || "unknown reason"}`);
        break;
      case "sync-complete":
      default:
        break;
    }
  }
  restoreWorkspaces() {
    const savedWorkspaces = this.store.get("workspaces", []);
    for (const ws of savedWorkspaces) {
      this.workspaceManager.importWorkspace(ws);
      this.ensureBotFlag();
    }
    const savedPeers = this.store.get("peer-public-keys", {});
    for (const [peerId, pubKey] of Object.entries(savedPeers)) {
      this.updateWorkspaceMemberKey(peerId, pubKey);
    }
  }
  restoreMessages() {
    const restoredKeys = new Set;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      for (const ch of ws.channels) {
        const key = `messages-${ch.id}`;
        this.restoreMessagesForKey(key);
        restoredKeys.add(key);
      }
    }
    for (const key of this.store.keys("messages-")) {
      if (restoredKeys.has(key))
        continue;
      this.restoreMessagesForKey(key);
    }
  }
  restoreMessagesForKey(key) {
    const messages = this.store.get(key, []);
    const fallbackChannelId = key.startsWith("messages-") ? key.slice("messages-".length) : "";
    for (const message of messages) {
      if (!message || typeof message !== "object")
        continue;
      if (typeof message.channelId !== "string" || message.channelId.length === 0) {
        if (!fallbackChannelId)
          continue;
        message.channelId = fallbackChannelId;
      }
      this.messageStore.forceAdd(message);
    }
  }
  restoreCustodianInbox() {
    const raw = this.store.get(this.custodialInboxKey(), []);
    this.custodianInbox.clear();
    for (const envelope of raw) {
      if (this.isCustodyEnvelope(envelope)) {
        this.custodianInbox.set(envelope.envelopeId, envelope);
      }
    }
  }
  persistCustodianInbox() {
    this.store.set(this.custodialInboxKey(), [...this.custodianInbox.values()]);
  }
  manifestStateKey() {
    return "manifest-state-v1";
  }
  restoreManifestState() {
    try {
      const persisted = this.store.get(this.manifestStateKey(), null);
      if (!persisted)
        return;
      this.manifestStore.importState(persisted);
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to restore manifest state: ${String(error)}`);
    }
  }
  persistManifestState() {
    try {
      this.store.set(this.manifestStateKey(), this.manifestStore.exportState());
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to persist manifest state: ${String(error)}`);
    }
  }
  schedulePersistManifestState() {
    if (this.manifestPersistTimer)
      clearTimeout(this.manifestPersistTimer);
    this.manifestPersistTimer = setTimeout(() => {
      this.manifestPersistTimer = null;
      this.persistManifestState();
    }, 150);
  }
  handleWorkspaceState(fromPeerId, workspaceId, sync) {
    let ws = this.workspaceManager.getWorkspace(workspaceId);
    const remoteMembers = Array.isArray(sync?.members) ? sync.members : [];
    const remoteChannels = Array.isArray(sync?.channels) ? sync.channels : [];
    const senderListedInSync = remoteMembers.some((member) => member?.peerId === fromPeerId);
    if (!senderListedInSync) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)}: sender ${fromPeerId.slice(0, 8)} missing from member list`);
      return;
    }
    if (ws && !ws.members.some((member) => member.peerId === fromPeerId)) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)} from non-member ${fromPeerId.slice(0, 8)}`);
      return;
    }
    if (ws && this.workspaceManager.isBanned(workspaceId, fromPeerId)) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)} from banned peer ${fromPeerId.slice(0, 8)}`);
      return;
    }
    const senderPayload = remoteMembers.find((member) => member?.peerId === fromPeerId);
    const senderIsOwner = ws?.members.some((member) => member.peerId === fromPeerId && member.role === "owner") || senderPayload?.role === "owner";
    if (!ws) {
      const workspace = {
        id: workspaceId,
        name: sync.name || workspaceId.slice(0, 8),
        description: sync.description || "",
        channels: remoteChannels.map((ch) => ({
          id: ch.id,
          workspaceId,
          name: ch.name,
          type: ch.type || "channel",
          members: Array.isArray(ch.members) ? ch.members.filter((memberId) => typeof memberId === "string") : [],
          ...ch.accessPolicy ? { accessPolicy: JSON.parse(JSON.stringify(ch.accessPolicy)) } : {},
          createdBy: ch.createdBy || fromPeerId,
          createdAt: Number.isFinite(ch.createdAt) ? ch.createdAt : Date.now()
        })),
        members: remoteMembers.map((m) => ({
          peerId: m.peerId,
          alias: m.alias || m.peerId.slice(0, 8),
          publicKey: m.publicKey || "",
          signingPublicKey: m.signingPublicKey || undefined,
          role: senderIsOwner && ["owner", "admin", "member"].includes(m.role) ? m.role : m.peerId === fromPeerId && senderPayload?.role === "owner" ? "owner" : "member",
          isBot: m.isBot === true,
          companySim: m.companySim || undefined,
          allowWorkspaceDMs: m.allowWorkspaceDMs !== false,
          joinedAt: Date.now()
        })),
        inviteCode: sync.inviteCode || "",
        permissions: senderIsOwner ? sync.permissions || {} : {},
        createdAt: Date.now(),
        createdBy: fromPeerId
      };
      if (!workspace.members.some((m) => m.peerId === this.myPeerId)) {
        workspace.members.push({
          peerId: this.myPeerId,
          alias: this.opts.account.alias,
          publicKey: this.myPublicKey,
          role: "member",
          isBot: true,
          joinedAt: Date.now()
        });
      }
      this.workspaceManager.importWorkspace(workspace);
      this.ensureBotFlag();
      this.opts.log?.info(`[decentchat-peer] imported workspace ${workspaceId.slice(0, 8)} "${sync.name}" with ${workspace.members.length} members, ${workspace.channels.length} channels`);
      const channelTimestamps = {};
      for (const ch of workspace.channels) {
        channelTimestamps[ch.id] = 0;
      }
      this.sendMessageSyncRequest(fromPeerId, workspaceId, channelTimestamps);
      this.requestSyncForPeer(fromPeerId);
    } else {
      if (sync.name && ws.name !== sync.name)
        ws.name = sync.name;
      if (sync.description !== undefined)
        ws.description = sync.description;
      if (senderIsOwner && sync.permissions)
        ws.permissions = sync.permissions;
      for (const remoteMember of remoteMembers) {
        if (this.workspaceManager.isBanned(workspaceId, remoteMember.peerId))
          continue;
        const existing = ws.members.find((m) => m.peerId === remoteMember.peerId);
        if (!existing) {
          ws.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || "",
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            role: senderIsOwner && ["owner", "admin", "member"].includes(remoteMember.role) ? remoteMember.role : "member",
            isBot: remoteMember.isBot === true,
            companySim: remoteMember.companySim || undefined,
            allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
            joinedAt: Date.now()
          });
        } else {
          if (remoteMember.alias && !/^[a-f0-9]{8}$/i.test(remoteMember.alias)) {
            existing.alias = remoteMember.alias;
          }
          if (remoteMember.publicKey)
            existing.publicKey = remoteMember.publicKey;
          if (remoteMember.signingPublicKey && !existing.signingPublicKey)
            existing.signingPublicKey = remoteMember.signingPublicKey;
          if (senderIsOwner && ["owner", "admin", "member"].includes(remoteMember.role))
            existing.role = remoteMember.role;
          if (remoteMember.isBot === true)
            existing.isBot = true;
          if (remoteMember.companySim)
            existing.companySim = remoteMember.companySim;
          if (typeof remoteMember.allowWorkspaceDMs === "boolean")
            existing.allowWorkspaceDMs = remoteMember.allowWorkspaceDMs;
        }
      }
      for (const remoteCh of remoteChannels) {
        const remoteId = typeof remoteCh.id === "string" ? remoteCh.id : "";
        const remoteType = remoteCh.type || "channel";
        const remoteName = typeof remoteCh.name === "string" ? remoteCh.name : "";
        const remoteMembersForChannel = Array.isArray(remoteCh.members) ? remoteCh.members.filter((memberId) => typeof memberId === "string") : [];
        const remoteAccessPolicy = remoteCh.accessPolicy ? JSON.parse(JSON.stringify(remoteCh.accessPolicy)) : remoteType === "channel" ? { mode: "public-workspace", workspaceId } : undefined;
        if (!remoteId || !remoteName)
          continue;
        const localById = ws.channels.find((ch) => ch.id === remoteId);
        if (localById) {
          if (localById.name !== remoteName)
            localById.name = remoteName;
          if ((localById.type || "channel") !== remoteType)
            localById.type = remoteType;
          if (remoteMembersForChannel.length > 0)
            localById.members = [...new Set(remoteMembersForChannel)];
          if (remoteAccessPolicy)
            localById.accessPolicy = remoteAccessPolicy;
          if (remoteCh.createdBy && !localById.createdBy)
            localById.createdBy = remoteCh.createdBy;
          if (Number.isFinite(remoteCh.createdAt) && !Number.isFinite(localById.createdAt))
            localById.createdAt = remoteCh.createdAt;
          continue;
        }
        const localByName = ws.channels.find((ch) => ch.name === remoteName && (ch.type || "channel") === remoteType);
        if (localByName) {
          const hasLocalHistory = this.messageStore.getMessages(localByName.id).length > 0;
          if (!hasLocalHistory) {
            localByName.id = remoteId;
            localByName.workspaceId = workspaceId;
          }
          if (remoteMembersForChannel.length > 0)
            localByName.members = [...new Set(remoteMembersForChannel)];
          if (remoteAccessPolicy)
            localByName.accessPolicy = remoteAccessPolicy;
          if (remoteCh.createdBy && !localByName.createdBy)
            localByName.createdBy = remoteCh.createdBy;
          if (Number.isFinite(remoteCh.createdAt) && !Number.isFinite(localByName.createdAt))
            localByName.createdAt = remoteCh.createdAt;
          continue;
        }
        ws.channels.push({
          id: remoteId,
          workspaceId,
          name: remoteName,
          type: remoteType,
          members: remoteMembersForChannel,
          ...remoteAccessPolicy ? { accessPolicy: remoteAccessPolicy } : {},
          createdBy: remoteCh.createdBy || fromPeerId,
          createdAt: Number.isFinite(remoteCh.createdAt) ? remoteCh.createdAt : Date.now()
        });
      }
      this.opts.log?.info(`[decentchat-peer] updated workspace ${workspaceId.slice(0, 8)} "${ws.name}" — now ${ws.members.length} members, ${ws.channels.length} channels`);
    }
    this.persistWorkspaces();
    this.ensureBotFlag();
    const current = this.workspaceManager.getWorkspace(workspaceId);
    if (current) {
      this.recordManifestDomain("workspace-manifest", workspaceId, {
        operation: "update",
        subject: workspaceId,
        itemCount: 1,
        data: { name: current.name, description: current.description }
      });
      this.recordManifestDomain("membership", workspaceId, {
        operation: "update",
        subject: workspaceId,
        itemCount: current.members.length,
        data: { memberCount: current.members.length }
      });
      this.recordManifestDomain("channel-manifest", workspaceId, {
        operation: "update",
        subject: workspaceId,
        itemCount: current.channels.length,
        data: { channelCount: current.channels.length }
      });
    }
  }
  persistWorkspaces() {
    this.store.set("workspaces", this.workspaceManager.getAllWorkspaces());
  }
  persistMessagesForChannel(channelId) {
    this.store.set(`messages-${channelId}`, this.messageStore.getMessages(channelId));
  }
  getThreadHistory(args) {
    const safeChannelId = args.channelId.trim();
    const safeThreadId = args.threadId.trim();
    const safeLimit = Math.max(0, Math.floor(args.limit));
    if (!safeChannelId || !safeThreadId || safeLimit === 0)
      return [];
    const excludeMessageId = args.excludeMessageId?.trim();
    const allChannelMessages = this.messageStore.getMessages(safeChannelId);
    const parentMessage = allChannelMessages.find((m) => m.id === safeThreadId);
    const threadReplies = this.messageStore.getThread(safeChannelId, safeThreadId).filter((message) => !excludeMessageId || message.id !== excludeMessageId);
    const combined = [];
    if (parentMessage && (!excludeMessageId || parentMessage.id !== excludeMessageId)) {
      combined.push(parentMessage);
    }
    combined.push(...threadReplies);
    return combined.sort((a, b) => a.timestamp - b.timestamp).slice(-safeLimit).map((message) => ({
      id: message.id,
      senderId: message.senderId,
      content: typeof message.content === "string" ? message.content : "",
      timestamp: message.timestamp
    }));
  }
  listDirectoryPeersLive(params) {
    const q = params?.query?.trim().toLowerCase() ?? "";
    const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : undefined;
    const peers = new Map;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        if (!member?.peerId || member.peerId === this.myPeerId)
          continue;
        const prev = peers.get(member.peerId) ?? { alias: undefined, count: 0 };
        peers.set(member.peerId, {
          alias: member.alias?.trim() || prev.alias,
          count: prev.count + 1
        });
      }
    }
    const entries = Array.from(peers.entries()).map(([peerId, meta]) => ({
      kind: "user",
      id: peerId,
      name: meta.alias,
      handle: `decentchat:${peerId}`,
      rank: meta.count
    })).filter((entry) => {
      if (!q)
        return true;
      return entry.id.toLowerCase().includes(q) || entry.handle.toLowerCase().includes(q) || (entry.name?.toLowerCase().includes(q) ?? false);
    }).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    return limit ? entries.slice(0, limit) : entries;
  }
  listDirectoryGroupsLive(params) {
    const q = params?.query?.trim().toLowerCase() ?? "";
    const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : undefined;
    const groups = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const channel of workspace.channels) {
        if (!channel?.id)
          continue;
        if (channel.type === "dm")
          continue;
        const id = `decentchat:channel:${channel.id}`;
        const name = workspace.name?.trim() ? `${workspace.name} / #${channel.name}` : `#${channel.name}`;
        groups.push({
          kind: "group",
          id,
          name,
          raw: {
            workspaceId: workspace.id,
            channelId: channel.id,
            channelName: channel.name
          }
        });
      }
    }
    const deduped = new Map;
    for (const group of groups) {
      if (!deduped.has(group.id))
        deduped.set(group.id, group);
    }
    const entries = Array.from(deduped.values()).filter((entry) => {
      if (!q)
        return true;
      return entry.id.toLowerCase().includes(q) || (entry.name?.toLowerCase().includes(q) ?? false) || String(entry.raw?.workspaceId ?? "").toLowerCase().includes(q) || String(entry.raw?.channelId ?? "").toLowerCase().includes(q);
    }).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    return limit ? entries.slice(0, limit) : entries;
  }
  async sendToChannel(channelId, content, threadId, replyToId, messageId, model) {
    const workspaceId = this.findWorkspaceIdForChannel(channelId);
    return this.sendMessage(channelId, workspaceId, content, threadId, replyToId, messageId, model);
  }
  async sendDirectToPeer(peerId, content, threadId, replyToId, messageId, model) {
    if (!this.transport || !this.messageProtocol || !content.trim())
      return;
    const modelMeta = buildMessageMetadata(model);
    const outboundMessageId = messageId || randomUUID();
    try {
      const encrypted = await this.encryptMessageWithPreKeyBootstrap(peerId, content.trim(), modelMeta, this.resolveSharedWorkspaceIds(peerId)[0]);
      encrypted.isDirect = true;
      encrypted.senderId = this.myPeerId;
      encrypted.senderName = this.opts.account.alias;
      encrypted.messageId = outboundMessageId;
      if (threadId)
        encrypted.threadId = threadId;
      if (replyToId)
        encrypted.replyToId = replyToId;
      const connected = this.transport.getConnectedPeers().includes(peerId);
      if (connected) {
        await this.queuePendingAck(peerId, {
          content: content.trim(),
          senderId: this.myPeerId,
          senderName: this.opts.account.alias,
          messageId: outboundMessageId,
          threadId,
          replyToId,
          isDirect: true,
          ...modelMeta ? { metadata: modelMeta } : {}
        });
        const accepted = this.transport.send(peerId, encrypted);
        if (!accepted) {
          await this.custodyStore.storeEnvelope({
            envelopeId: typeof encrypted.id === "string" ? encrypted.id : undefined,
            opId: outboundMessageId,
            recipientPeerIds: [peerId],
            workspaceId: "direct",
            ...threadId ? { threadId } : {},
            domain: "channel-message",
            ciphertext: encrypted,
            metadata: {
              messageId: outboundMessageId,
              ...this.buildCustodyResendMetadata({
                content: content.trim(),
                senderId: this.myPeerId,
                senderName: this.opts.account.alias,
                threadId,
                replyToId,
                isDirect: true,
                metadata: modelMeta
              })
            }
          });
        }
        return;
      }
      await this.custodyStore.storeEnvelope({
        envelopeId: typeof encrypted.id === "string" ? encrypted.id : undefined,
        opId: outboundMessageId,
        recipientPeerIds: [peerId],
        workspaceId: "direct",
        ...threadId ? { threadId } : {},
        domain: "channel-message",
        ciphertext: encrypted,
        metadata: {
          messageId: outboundMessageId,
          ...this.buildCustodyResendMetadata({
            content: content.trim(),
            senderId: this.myPeerId,
            senderName: this.opts.account.alias,
            threadId,
            replyToId,
            isDirect: true,
            metadata: modelMeta
          })
        }
      });
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] DM to ${peerId} failed: ${String(err)}`);
      await this.enqueueOffline(peerId, {
        content: content.trim(),
        senderId: this.myPeerId,
        senderName: this.opts.account.alias,
        messageId: outboundMessageId,
        threadId,
        replyToId,
        isDirect: true,
        ...modelMeta ? { metadata: modelMeta } : {}
      });
    }
  }
  async sendReadReceipt(peerId, channelId, messageId) {
    if (!this.transport || !peerId || !channelId || !messageId)
      return;
    const payload = {
      type: "read",
      channelId,
      messageId
    };
    if (!this.transport.getConnectedPeers().includes(peerId)) {
      await this.enqueueOffline(peerId, payload);
      return;
    }
    try {
      const accepted = this.transport.send(peerId, payload);
      if (!accepted) {
        await this.enqueueOffline(peerId, payload);
      }
    } catch (err) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to send read receipt to ${peerId}: ${String(err)}`);
      await this.enqueueOffline(peerId, payload);
    }
    this.recordManifestDomain("receipt", this.findWorkspaceIdForChannel(channelId), {
      channelId,
      operation: "create",
      subject: messageId,
      data: {
        kind: "read",
        targetPeerId: peerId
      }
    });
  }
  async sendTyping(params) {
    if (!this.transport || !params.channelId)
      return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = {
      type: "typing",
      channelId: params.channelId,
      peerId: this.myPeerId,
      typing: params.typing
    };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }
  async sendDirectTyping(params) {
    if (!this.transport || !params.peerId)
      return;
    if (!this.transport.getConnectedPeers().includes(params.peerId))
      return;
    this.transport.send(params.peerId, {
      type: "typing",
      channelId: params.peerId,
      workspaceId: "",
      peerId: this.myPeerId,
      typing: params.typing
    });
  }
  async startStream(params) {
    if (!this.transport)
      return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = {
      type: "stream-start",
      messageId: params.messageId,
      channelId: params.channelId,
      workspaceId: params.workspaceId,
      senderId: this.myPeerId,
      senderName: this.opts.account.alias,
      isDirect: false,
      ...params.threadId ? { threadId: params.threadId } : {},
      ...params.replyToId ? { replyToId: params.replyToId } : {}
    };
    if (params.model) {
      envelope.modelMeta = params.model;
    }
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }
  async startDirectStream(params) {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId))
      return;
    const envelope = {
      type: "stream-start",
      messageId: params.messageId,
      channelId: params.peerId,
      workspaceId: "",
      senderId: this.myPeerId,
      senderName: this.opts.account.alias,
      isDirect: true
    };
    if (params.model) {
      envelope.modelMeta = params.model;
    }
    this.transport.send(params.peerId, envelope);
  }
  async sendStreamDelta(params) {
    if (!this.transport)
      return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = { type: "stream-delta", messageId: params.messageId, content: params.content };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }
  async sendDirectStreamDelta(params) {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId))
      return;
    this.transport.send(params.peerId, { type: "stream-delta", messageId: params.messageId, content: params.content });
  }
  async sendStreamDone(params) {
    if (!this.transport)
      return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = { type: "stream-done", messageId: params.messageId };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }
  async sendDirectStreamDone(params) {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId))
      return;
    this.transport.send(params.peerId, { type: "stream-done", messageId: params.messageId });
  }
  async handleMediaRequest(fromPeerId, request) {
    if (!this.transport)
      return;
    const attachmentKey = `attachment-meta:${request.attachmentId}`;
    const attachment = this.store.get(attachmentKey, null);
    if (!attachment) {
      const response2 = { type: "media-response", attachmentId: request.attachmentId, available: false };
      this.transport.send(fromPeerId, response2);
      return;
    }
    const response = {
      type: "media-response",
      attachmentId: request.attachmentId,
      available: true,
      totalChunks: attachment.totalChunks
    };
    this.transport.send(fromPeerId, response);
    const startChunk = request.fromChunk ?? 0;
    for (let i = startChunk;i < attachment.totalChunks; i++) {
      const chunkKey = `media-chunk:${request.attachmentId}:${i}`;
      const chunkData = this.store.get(chunkKey, null);
      if (chunkData) {
        const chunk = {
          type: "media-chunk",
          attachmentId: request.attachmentId,
          index: i,
          total: attachment.totalChunks,
          data: chunkData,
          chunkHash: ""
        };
        this.transport.send(fromPeerId, chunk);
      }
    }
  }
  async handleMediaResponse(fromPeerId, response) {
    const pending = this.pendingMediaRequests.get(response.attachmentId);
    if (!pending)
      return;
    if (!response.available) {
      clearTimeout(pending.timeout);
      this.pendingMediaRequests.delete(response.attachmentId);
      pending.resolve(null);
      return;
    }
  }
  async handleMediaChunk(fromPeerId, chunk) {
    const pending = this.pendingMediaRequests.get(chunk.attachmentId);
    if (!pending)
      return;
    try {
      const buffer = Buffer.from(chunk.data, "base64");
      pending.chunks.set(chunk.index, buffer);
      if (pending.chunks.size === chunk.total) {
        clearTimeout(pending.timeout);
        this.pendingMediaRequests.delete(chunk.attachmentId);
        const chunks = [];
        for (let i = 0;i < chunk.total; i++) {
          const c = pending.chunks.get(i);
          if (!c) {
            pending.resolve(null);
            return;
          }
          chunks.push(c);
        }
        const fullBuffer = Buffer.concat(chunks);
        const storedKey = `media-full:${chunk.attachmentId}`;
        this.store.set(storedKey, fullBuffer.toString("base64"));
        pending.resolve(fullBuffer);
      }
    } catch {}
  }
  findChannelNameById(channelId) {
    const ws = this.workspaceManager.getAllWorkspaces().find((workspace) => workspace.channels.some((ch) => ch.id === channelId));
    return ws?.channels.find((ch) => ch.id === channelId)?.name;
  }
  getChannelRecipientPeerIds(channelId, workspaceId) {
    const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    if (!workspace)
      return this.transport?.getConnectedPeers().filter((p) => p !== this.myPeerId) ?? [];
    const workspacePeers = workspace.members.map((member) => member.peerId).filter((peerId) => Boolean(peerId) && peerId !== this.myPeerId);
    const channels = Array.isArray(workspace.channels) ? workspace.channels : [];
    const channel = channels.find((entry) => entry.id === channelId);
    const accessPolicy = channel?.accessPolicy;
    if (accessPolicy?.mode === "explicit" && Array.isArray(accessPolicy.explicitMemberPeerIds)) {
      return Array.from(new Set(accessPolicy.explicitMemberPeerIds.filter((peerId) => typeof peerId === "string" && peerId.length > 0).filter((peerId) => peerId !== this.myPeerId)));
    }
    return workspacePeers;
  }
  resolveChannelNameById(channelId) {
    return this.findChannelNameById(channelId);
  }
  findWorkspaceIdForChannel(channelId) {
    const ws = this.workspaceManager.getAllWorkspaces().find((workspace) => workspace.channels.some((ch) => ch.id === channelId));
    return ws?.id ?? "";
  }
  resolveSenderName(workspaceId, peerId, fallback) {
    const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    const alias = ws?.members.find((m) => m.peerId === peerId)?.alias;
    const cachedAlias = this.store.get(`peer-alias-${peerId}`, "");
    return alias || cachedAlias || fallback || peerId.slice(0, 8);
  }
  getPeerPublicKey(peerId) {
    const savedPeers = this.store.get("peer-public-keys", {});
    if (savedPeers[peerId])
      return savedPeers[peerId];
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId && m.publicKey);
      if (member?.publicKey)
        return member.publicKey;
    }
    return null;
  }
  updateWorkspaceMemberKey(peerId, publicKey) {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId);
      if (member && member.publicKey !== publicKey) {
        member.publicKey = publicKey;
        changed = true;
      }
    }
    if (changed) {
      this.persistWorkspaces();
    }
  }
  updateWorkspaceMemberAlias(peerId, alias, companySim, isBot) {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId);
      if (!member)
        continue;
      if (member.alias !== alias) {
        member.alias = alias;
        changed = true;
      }
      if (isBot === true && !member.isBot) {
        member.isBot = true;
        changed = true;
      }
      if (companySim) {
        const prev = JSON.stringify(member.companySim || null);
        const next = JSON.stringify(companySim);
        if (prev !== next) {
          member.companySim = companySim;
          changed = true;
        }
      }
    }
    if (changed) {
      this.persistWorkspaces();
    }
  }
  ensureBotFlag() {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const me = ws.members.find((m) => m.peerId === this.myPeerId);
      if (me && !me.isBot) {
        me.isBot = true;
        changed = true;
      }
    }
    if (changed)
      this.persistWorkspaces();
  }
  offlineQueueKey(peerId) {
    return `offline-queue-${peerId}`;
  }
  receiptLogKey(peerId) {
    return `receipt-log-${peerId}`;
  }
  custodialInboxKey() {
    return "custodian-inbox";
  }
  pendingAckKey(peerId) {
    return `pending-ack-${peerId}`;
  }
  getMyCompanySimProfile() {
    return;
  }
  pendingReadReceiptKey(peerId) {
    return `pending-read-${peerId}`;
  }
  requestSyncForPeer(peerId) {
    if (!this.syncProtocol)
      return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((member) => member.peerId === peerId))
        continue;
      this.syncProtocol.requestSync(peerId, workspace.id);
    }
  }
  async queuePendingReadReceipt(peerId, channelId, messageId) {
    const key = this.pendingReadReceiptKey(peerId);
    const current = this.store.get(key, []);
    const exists = current.some((entry) => entry?.channelId === channelId && entry?.messageId === messageId);
    if (exists)
      return;
    current.push({ channelId, messageId, queuedAt: Date.now() });
    this.store.set(key, current);
  }
  async flushPendingReadReceipts(peerId) {
    if (!this.transport)
      return;
    if (!this.transport.getConnectedPeers().includes(peerId))
      return;
    const key = this.pendingReadReceiptKey(peerId);
    const queued = this.store.get(key, []);
    if (queued.length === 0)
      return;
    const retry = [];
    for (const item of queued) {
      if (!item?.channelId || !item?.messageId)
        continue;
      try {
        this.transport.send(peerId, {
          type: "read",
          channelId: item.channelId,
          messageId: item.messageId
        });
      } catch {
        retry.push(item);
      }
    }
    if (retry.length === 0)
      this.store.delete(key);
    else
      this.store.set(key, retry);
  }
  isCustodyEnvelope(value) {
    if (!value || typeof value !== "object")
      return false;
    const envelope = value;
    return typeof envelope.envelopeId === "string" && typeof envelope.opId === "string" && Array.isArray(envelope.recipientPeerIds) && typeof envelope.workspaceId === "string" && typeof envelope.domain === "string" && "ciphertext" in envelope;
  }
  recordManifestDomain(domain, workspaceId, params) {
    if (!workspaceId)
      return null;
    return this.manifestStore.updateDomain({
      domain,
      workspaceId,
      ...params?.channelId ? { channelId: params.channelId } : {},
      author: this.myPeerId || "unknown",
      operation: params?.operation ?? "update",
      subject: params?.subject,
      itemCount: params?.itemCount,
      data: params?.data
    });
  }
  async handleInboundReceipt(fromPeerId, msg, kind) {
    const messageId = typeof msg?.messageId === "string" ? msg.messageId : "";
    if (!messageId)
      return;
    const receipt = {
      receiptId: `${kind}:${fromPeerId}:${messageId}:${Date.now()}`,
      kind,
      opId: messageId,
      recipientPeerId: fromPeerId,
      timestamp: Date.now(),
      ...typeof msg?.envelopeId === "string" ? { envelopeId: msg.envelopeId } : {},
      metadata: {
        ...typeof msg?.channelId === "string" ? { channelId: msg.channelId } : {}
      }
    };
    await this.removePendingAck(fromPeerId, messageId);
    await this.custodyStore.applyReceipt(fromPeerId, receipt);
    await this.offlineQueue.applyReceipt(fromPeerId, receipt);
    this.recordManifestDomain("receipt", typeof msg?.channelId === "string" ? this.findWorkspaceIdForChannel(msg.channelId) : undefined, {
      channelId: typeof msg?.channelId === "string" ? msg.channelId : undefined,
      operation: "create",
      subject: messageId,
      data: {
        kind,
        recipientPeerId: fromPeerId
      }
    });
  }
  sendManifestSummary(peerId, onlyWorkspaceId) {
    if (!this.transport)
      return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (onlyWorkspaceId && workspace.id !== onlyWorkspaceId)
        continue;
      if (!workspace.members.some((member) => member.peerId === peerId))
        continue;
      const summary = this.manifestStore.getSummary(workspace.id);
      this.transport.send(peerId, {
        type: "sync.summary",
        workspaceId: workspace.id,
        summary
      });
    }
  }
  async handleManifestSummary(peerId, msg) {
    if (!this.transport)
      return;
    const summary = msg?.summary ?? msg;
    const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : summary?.workspaceId;
    if (!workspaceId || !summary || !Array.isArray(summary.versions))
      return;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace || !workspace.members.some((member) => member.peerId === peerId))
      return;
    const missing = this.manifestStore.buildDiffRequest(workspaceId, summary);
    if (missing.length > 0) {
      this.transport.send(peerId, {
        type: "sync.diff_request",
        workspaceId,
        requestId: randomUUID(),
        requests: missing
      });
    }
    const remoteByKey = new Map(summary.versions.map((version) => [`${version.domain}:${version.channelId ?? ""}`, version]));
    const localSummary = this.manifestStore.getSummary(workspaceId);
    const pushDeltas = [];
    for (const localVersion of localSummary.versions) {
      const key = `${localVersion.domain}:${localVersion.channelId ?? ""}`;
      const remoteVersion = remoteByKey.get(key)?.version ?? 0;
      if (localVersion.version <= remoteVersion)
        continue;
      pushDeltas.push(...this.manifestStore.getDeltasSince({
        workspaceId,
        domain: localVersion.domain,
        channelId: localVersion.channelId,
        fromVersion: remoteVersion,
        toVersion: localVersion.version,
        limit: 500
      }));
    }
    if (pushDeltas.length > 0) {
      this.transport.send(peerId, {
        type: "sync.diff_response",
        workspaceId,
        requestId: `push:${randomUUID()}`,
        deltas: pushDeltas
      });
    }
  }
  async handleManifestDiffRequest(peerId, msg) {
    if (!this.transport)
      return;
    const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : "";
    if (!workspaceId)
      return;
    const requests = Array.isArray(msg?.requests) ? msg.requests : msg?.request ? [msg.request] : [];
    if (requests.length === 0)
      return;
    const deltas = [];
    const snapshots = [];
    for (const request of requests) {
      const slice = this.manifestStore.getDeltasSince({
        workspaceId,
        domain: request.domain,
        channelId: request.channelId,
        fromVersion: request.fromVersion,
        toVersion: request.toVersion,
        limit: 500
      });
      deltas.push(...slice);
      if (slice.length === 0 && (request.toVersion ?? 0) > request.fromVersion) {
        const snapshot = this.buildManifestSnapshot(workspaceId, request.domain, request.channelId);
        if (snapshot) {
          this.manifestStore.saveSnapshot(snapshot);
          snapshots.push({
            domain: snapshot.domain,
            workspaceId: snapshot.workspaceId,
            ...snapshot.domain === "channel-message" && snapshot.channelId ? { channelId: snapshot.channelId } : {},
            snapshotId: snapshot.snapshotId,
            version: snapshot.version,
            basedOnVersion: snapshot.basedOnVersion,
            createdAt: snapshot.createdAt,
            createdBy: snapshot.createdBy
          });
        }
      }
    }
    this.transport.send(peerId, {
      type: "sync.diff_response",
      workspaceId,
      requestId: typeof msg?.requestId === "string" ? msg.requestId : randomUUID(),
      deltas,
      ...snapshots.length > 0 ? { snapshots } : {}
    });
  }
  async handleManifestDiffResponse(peerId, msg) {
    if (!this.transport)
      return;
    const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : "";
    if (!workspaceId)
      return;
    const deltas = Array.isArray(msg?.deltas) ? msg.deltas : [];
    this.manifestStore.applyDeltaBatch(deltas);
    let needsSync = false;
    for (const delta of deltas) {
      if (delta.domain === "channel-message") {
        needsSync = true;
        break;
      }
    }
    if (needsSync) {
      this.requestSyncForPeer(peerId);
    }
    const snapshots = Array.isArray(msg?.snapshots) ? msg.snapshots : [];
    for (const pointer of snapshots) {
      const existing = this.manifestStore.getSnapshot(workspaceId, pointer.domain, pointer.channelId);
      if (!existing || existing.version < pointer.version) {
        this.transport.send(peerId, {
          type: "sync.fetch_snapshot",
          workspaceId,
          domain: pointer.domain,
          ...pointer.channelId ? { channelId: pointer.channelId } : {},
          snapshotId: pointer.snapshotId
        });
      }
    }
  }
  async handleManifestFetchSnapshot(peerId, msg) {
    if (!this.transport)
      return;
    const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : "";
    const domain = msg?.domain;
    const channelId = typeof msg?.channelId === "string" ? msg.channelId : undefined;
    if (!workspaceId || !domain)
      return;
    const existing = this.manifestStore.getSnapshot(workspaceId, domain, channelId);
    const snapshot = existing ?? this.buildManifestSnapshot(workspaceId, domain, channelId);
    if (!snapshot)
      return;
    this.manifestStore.saveSnapshot(snapshot);
    this.transport.send(peerId, {
      type: "sync.snapshot_response",
      workspaceId,
      snapshot
    });
  }
  async handleManifestSnapshotResponse(peerId, msg) {
    const snapshot = msg?.snapshot;
    if (!snapshot)
      return;
    this.manifestStore.restoreSnapshot(snapshot, this.myPeerId || "unknown");
    if (snapshot.domain === "workspace-manifest") {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        ws.name = snapshot.name;
        ws.description = snapshot.description;
        this.persistWorkspaces();
      }
      return;
    }
    if (snapshot.domain === "membership") {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        ws.members = snapshot.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias || member.peerId.slice(0, 8),
          publicKey: ws.members.find((existing) => existing.peerId === member.peerId)?.publicKey || "",
          role: member.role,
          joinedAt: member.joinedAt
        }));
        this.ensureBotFlag();
        this.persistWorkspaces();
      }
      return;
    }
    if (snapshot.domain === "channel-manifest") {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        for (const channel of snapshot.channels) {
          if (ws.channels.some((existing) => existing.id === channel.id))
            continue;
          ws.channels.push({
            id: channel.id,
            workspaceId: snapshot.workspaceId,
            name: channel.name,
            type: channel.type,
            members: [],
            createdAt: channel.createdAt,
            createdBy: channel.createdBy
          });
        }
        this.persistWorkspaces();
      }
      return;
    }
    if (snapshot.domain === "channel-message" && this.transport) {
      const existingIds = new Set(this.messageStore.getMessages(snapshot.channelId).map((message) => message.id));
      const missing = snapshot.messageIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        this.transport.send(peerId, {
          type: "message-sync-fetch-request",
          workspaceId: snapshot.workspaceId,
          messageIdsByChannel: {
            [snapshot.channelId]: missing
          }
        });
      }
    }
  }
  buildManifestSnapshot(workspaceId, domain, channelId) {
    const summary = this.manifestStore.getSummary(workspaceId);
    const version = summary.versions.find((entry) => entry.domain === domain && (entry.channelId ?? "") === (channelId ?? ""))?.version ?? 0;
    if (domain === "workspace-manifest") {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws)
        return null;
      return {
        domain,
        workspaceId,
        version,
        name: ws.name,
        description: ws.description,
        policy: ws.permissions,
        snapshotId: randomUUID(),
        snapshotVersion: version,
        basedOnVersion: version,
        deltasSince: 0,
        createdAt: Date.now(),
        createdBy: this.myPeerId
      };
    }
    if (domain === "membership") {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws)
        return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        memberCount: ws.members.length,
        members: ws.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias,
          role: member.role,
          joinedAt: member.joinedAt
        })),
        createdAt: Date.now(),
        createdBy: this.myPeerId
      };
    }
    if (domain === "channel-manifest") {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws)
        return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        channelCount: ws.channels.length,
        channels: ws.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
          createdBy: channel.createdBy
        })),
        createdAt: Date.now(),
        createdBy: this.myPeerId
      };
    }
    if (domain === "channel-message" && channelId) {
      const messages = this.messageStore.getMessages(channelId).slice().sort((a, b) => a.timestamp - b.timestamp);
      const minTimestamp = messages[0]?.timestamp ?? Date.now();
      const maxTimestamp = messages[messages.length - 1]?.timestamp ?? minTimestamp;
      return {
        domain,
        workspaceId,
        channelId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        messageCount: messages.length,
        messageIds: messages.map((message) => message.id),
        minTimestamp,
        maxTimestamp,
        createdAt: Date.now(),
        createdBy: this.myPeerId
      };
    }
    return null;
  }
  requestCustodyRecovery(peerId) {
    if (!this.transport)
      return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((member) => member.peerId === peerId))
        continue;
      this.transport.send(peerId, {
        type: "custody.fetch_index",
        workspaceId: workspace.id,
        recipientPeerId: this.myPeerId
      });
    }
  }
  selectCustodianPeers(workspaceId, recipientPeerId, limit = DecentChatNodePeer.CUSTODIAN_REPLICATION_TARGET) {
    if (!this.transport)
      return [];
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace)
      return [];
    const connected = new Set(this.transport.getConnectedPeers());
    const scored = workspace.members.map((member) => member.peerId).filter((peerId) => peerId !== this.myPeerId && peerId !== recipientPeerId && connected.has(peerId)).map((peerId) => {
      let score = 100;
      const alias = this.resolveSenderName(workspaceId, peerId).toLowerCase();
      if (alias.includes("mobile") || alias.includes("iphone") || alias.includes("android"))
        score -= 20;
      if (alias.includes("server") || alias.includes("desktop") || alias.includes("bot"))
        score += 20;
      score += this.store.get(`custody-score-${peerId}`, 0);
      return { peerId, score };
    }).sort((a, b) => b.score - a.score || a.peerId.localeCompare(b.peerId));
    return scored.slice(0, Math.max(0, limit)).map((entry) => entry.peerId);
  }
  async replicateToCustodians(recipientPeerId, params) {
    const workspaceId = params.workspaceId ?? undefined;
    const opId = params.opId ?? undefined;
    if (!this.transport || !workspaceId || !opId)
      return;
    const custodians = this.selectCustodianPeers(workspaceId, recipientPeerId);
    if (custodians.length === 0)
      return;
    const pending = await this.custodyStore.getPendingForRecipient(recipientPeerId);
    const envelopes = pending.filter((envelope) => {
      if (envelope.opId !== opId || envelope.workspaceId !== workspaceId)
        return false;
      if (params.domain && envelope.domain !== params.domain)
        return false;
      if (params.channelId && envelope.channelId !== params.channelId)
        return false;
      return true;
    });
    if (envelopes.length === 0)
      return;
    for (const envelope of envelopes) {
      this.pendingCustodyOffers.set(envelope.envelopeId, custodians);
      for (const custodianPeerId of custodians) {
        this.transport.send(custodianPeerId, {
          type: "custody.offer",
          workspaceId,
          recipientPeerId,
          ...envelope.channelId ? { channelId: envelope.channelId } : {},
          envelope: {
            envelopeId: envelope.envelopeId,
            opId: envelope.opId,
            workspaceId: envelope.workspaceId,
            channelId: envelope.channelId,
            threadId: envelope.threadId,
            domain: envelope.domain,
            createdAt: envelope.createdAt,
            expiresAt: envelope.expiresAt,
            replicationClass: envelope.replicationClass
          }
        });
      }
    }
  }
  async handleCustodyControl(fromPeerId, msg) {
    if (!this.transport)
      return;
    if (msg?.type === "custody.offer") {
      const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : "";
      const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
      const canAccept = Boolean(workspace?.members.some((member) => member.peerId === this.myPeerId));
      this.transport.send(fromPeerId, {
        type: canAccept ? "custody.accept" : "custody.reject",
        workspaceId,
        envelopeId: msg?.envelope?.envelopeId,
        recipientPeerId: msg?.recipientPeerId,
        reason: canAccept ? undefined : "not-a-member"
      });
      return;
    }
    if (msg?.type === "custody.accept") {
      const envelopeId = typeof msg?.envelopeId === "string" ? msg.envelopeId : "";
      const recipientPeerId = typeof msg?.recipientPeerId === "string" ? msg.recipientPeerId : "";
      const offeredPeers = this.pendingCustodyOffers.get(envelopeId) ?? [];
      if (!envelopeId || !recipientPeerId || !offeredPeers.includes(fromPeerId))
        return;
      const envelopes = await this.custodyStore.listAllForRecipient(recipientPeerId);
      const envelope = envelopes.find((entry) => entry.envelopeId === envelopeId);
      if (!envelope)
        return;
      this.transport.send(fromPeerId, {
        type: "custody.store",
        workspaceId: envelope.workspaceId,
        recipientPeerId,
        envelope
      });
      return;
    }
    if (msg?.type === "custody.reject") {
      const envelopeId = typeof msg?.envelopeId === "string" ? msg.envelopeId : "";
      if (!envelopeId)
        return;
      const offeredPeers = this.pendingCustodyOffers.get(envelopeId) ?? [];
      this.pendingCustodyOffers.set(envelopeId, offeredPeers.filter((peerId) => peerId !== fromPeerId));
      return;
    }
    if (msg?.type === "custody.store") {
      const envelope = msg?.envelope;
      if (!this.isCustodyEnvelope(envelope))
        return;
      this.custodianInbox.set(envelope.envelopeId, envelope);
      this.persistCustodianInbox();
      this.transport.send(fromPeerId, {
        type: "custody.ack",
        envelopeIds: [envelope.envelopeId],
        stage: "stored"
      });
      return;
    }
    if (msg?.type === "custody.fetch_index") {
      if (Array.isArray(msg?.index)) {
        const envelopeIds = msg.index.map((entry) => typeof entry?.envelopeId === "string" ? entry.envelopeId : null).filter((value) => Boolean(value));
        if (envelopeIds.length > 0) {
          this.transport.send(fromPeerId, {
            type: "custody.fetch_envelopes",
            workspaceId: msg.workspaceId,
            envelopeIds
          });
        }
        return;
      }
      const recipientPeerId = typeof msg?.recipientPeerId === "string" ? msg.recipientPeerId : fromPeerId;
      const workspaceId = typeof msg?.workspaceId === "string" ? msg.workspaceId : undefined;
      const index = [...this.custodianInbox.values()].filter((envelope) => envelope.recipientPeerIds.includes(recipientPeerId)).filter((envelope) => !workspaceId || envelope.workspaceId === workspaceId).map((envelope) => ({
        envelopeId: envelope.envelopeId,
        opId: envelope.opId,
        workspaceId: envelope.workspaceId,
        channelId: envelope.channelId,
        domain: envelope.domain,
        createdAt: envelope.createdAt,
        expiresAt: envelope.expiresAt
      }));
      this.transport.send(fromPeerId, {
        type: "custody.fetch_index",
        workspaceId: workspaceId ?? "",
        recipientPeerId,
        index
      });
      return;
    }
    if (msg?.type === "custody.fetch_envelopes") {
      if (Array.isArray(msg?.envelopes)) {
        const recovered = msg.envelopes.filter((entry) => this.isCustodyEnvelope(entry));
        if (recovered.length === 0)
          return;
        const recoveredIds = [];
        for (const envelope of recovered) {
          if (!envelope.recipientPeerIds.includes(this.myPeerId))
            continue;
          recoveredIds.push(envelope.envelopeId);
          if (envelope.workspaceId) {
            this.recordManifestDomain("channel-message", envelope.workspaceId, {
              channelId: envelope.channelId,
              operation: "update",
              subject: envelope.opId,
              data: { recovered: true, envelopeId: envelope.envelopeId }
            });
          }
          const trustedSenderId = typeof envelope.metadata?.senderId === "string" && envelope.metadata.senderId.length > 0 ? envelope.metadata.senderId : undefined;
          await this.handlePeerMessage(fromPeerId, envelope.ciphertext, trustedSenderId);
        }
        if (recoveredIds.length > 0) {
          this.transport.send(fromPeerId, {
            type: "custody.ack",
            envelopeIds: recoveredIds,
            stage: "delivered"
          });
        }
        return;
      }
      const envelopeIds = Array.isArray(msg?.envelopeIds) ? msg.envelopeIds.filter((id) => typeof id === "string") : [];
      const envelopes = envelopeIds.map((id) => this.custodianInbox.get(id)).filter((entry) => Boolean(entry));
      this.transport.send(fromPeerId, {
        type: "custody.fetch_envelopes",
        workspaceId: typeof msg?.workspaceId === "string" ? msg.workspaceId : "",
        envelopes
      });
      return;
    }
    if (msg?.type === "custody.ack") {
      const envelopeIds = Array.isArray(msg?.envelopeIds) ? msg.envelopeIds.filter((id) => typeof id === "string") : [];
      if (envelopeIds.length === 0)
        return;
      let changed = false;
      for (const envelopeId of envelopeIds) {
        if (this.custodianInbox.delete(envelopeId))
          changed = true;
      }
      if (changed) {
        this.persistCustodianInbox();
        const key = `custody-score-${fromPeerId}`;
        const current = this.store.get(key, 0);
        this.store.set(key, current + 1);
      }
    }
  }
  async queuePendingAck(peerId, payload) {
    if (!payload?.messageId)
      return;
    const key = this.pendingAckKey(peerId);
    const current = this.store.get(key, []);
    const existingIndex = current.findIndex((entry2) => entry2?.messageId === payload.messageId);
    const entry = {
      ...payload,
      queuedAt: Date.now()
    };
    if (existingIndex >= 0)
      current[existingIndex] = entry;
    else
      current.push(entry);
    this.store.set(key, current);
  }
  async removePendingAck(peerId, messageId) {
    const key = this.pendingAckKey(peerId);
    const current = this.store.get(key, []);
    const next = current.filter((entry) => entry?.messageId !== messageId);
    if (next.length === 0)
      this.store.delete(key);
    else
      this.store.set(key, next);
  }
  async resendPendingAcks(peerId) {
    if (!this.transport || !this.messageProtocol)
      return;
    if (!this.transport.getConnectedPeers().includes(peerId))
      return;
    const key = this.pendingAckKey(peerId);
    const pending = this.store.get(key, []);
    if (pending.length === 0)
      return;
    for (const item of pending) {
      if (!item || typeof item !== "object")
        continue;
      try {
        if (typeof item.content === "string") {
          if (!item.isDirect) {
            continue;
          }
          const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, item.content, item.metadata, item.workspaceId);
          envelope.senderId = item.senderId ?? this.myPeerId;
          envelope.senderName = item.senderName ?? this.opts.account.alias;
          envelope.messageId = item.messageId;
          envelope.isDirect = true;
          if (item.threadId)
            envelope.threadId = item.threadId;
          if (item.replyToId)
            envelope.replyToId = item.replyToId;
          this.transport.send(peerId, envelope);
          continue;
        }
        if (item.ciphertext && typeof item.ciphertext === "object") {
          const outbound = { ...item.ciphertext };
          outbound._offlineReplay = 1;
          if (typeof item.envelopeId === "string" && !outbound.envelopeId) {
            outbound.envelopeId = item.envelopeId;
          }
          this.transport.send(peerId, outbound);
          continue;
        }
      } catch (err) {
        this.opts.log?.warn?.(`[decentchat-peer] resend pending failed for ${peerId}: ${String(err)}`);
      }
    }
  }
  async enqueueOffline(peerId, payload) {
    try {
      const now = Date.now();
      const isReceipt = payload?.type === "read" || payload?.type === "ack";
      const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId : typeof payload?.channelId === "string" ? this.findWorkspaceIdForChannel(payload.channelId) : "direct";
      if (isReceipt) {
        await this.custodyStore.storeEnvelope({
          opId: typeof payload?.messageId === "string" ? payload.messageId : randomUUID(),
          recipientPeerIds: [peerId],
          workspaceId: workspaceId || "direct",
          ...typeof payload?.channelId === "string" ? { channelId: payload.channelId } : {},
          domain: "receipt",
          ciphertext: payload,
          createdAt: now,
          metadata: {
            kind: payload?.type
          }
        });
        return;
      }
      if (typeof payload?.content === "string" && this.messageProtocol) {
        try {
          const encrypted = await this.encryptMessageWithPreKeyBootstrap(peerId, payload.content, payload.metadata, workspaceId);
          encrypted.senderId = payload.senderId ?? this.myPeerId;
          encrypted.senderName = payload.senderName ?? this.opts.account.alias;
          encrypted.messageId = payload.messageId ?? randomUUID();
          if (payload.isDirect) {
            encrypted.isDirect = true;
          } else {
            encrypted.channelId = payload.channelId;
            encrypted.workspaceId = payload.workspaceId;
          }
          if (payload.threadId)
            encrypted.threadId = payload.threadId;
          if (payload.replyToId)
            encrypted.replyToId = payload.replyToId;
          await this.custodyStore.storeEnvelope({
            envelopeId: typeof encrypted.id === "string" ? encrypted.id : undefined,
            opId: typeof payload?.messageId === "string" ? payload.messageId : randomUUID(),
            recipientPeerIds: [peerId],
            workspaceId: workspaceId || "direct",
            ...typeof payload?.channelId === "string" ? { channelId: payload.channelId } : {},
            ...typeof payload?.threadId === "string" ? { threadId: payload.threadId } : {},
            domain: "channel-message",
            ciphertext: encrypted,
            createdAt: now,
            metadata: this.buildCustodyResendMetadata({
              content: payload.content,
              channelId: payload.channelId,
              workspaceId: payload.workspaceId,
              senderId: payload.senderId ?? this.myPeerId,
              senderName: payload.senderName ?? this.opts.account.alias,
              threadId: payload.threadId,
              replyToId: payload.replyToId,
              isDirect: payload.isDirect === true,
              metadata: payload.metadata
            })
          });
          return;
        } catch (err) {
          this.opts.log?.warn?.(`[decentchat-peer] encryption failed while queueing offline payload for ${peerId}: ${String(err)}`);
        }
      }
      await this.offlineQueue.enqueue(peerId, payload, {
        createdAt: now,
        envelopeId: typeof payload?.id === "string" ? payload.id : undefined,
        opId: typeof payload?.messageId === "string" ? payload.messageId : typeof payload?.opId === "string" ? payload.opId : undefined,
        workspaceId: typeof payload?.workspaceId === "string" ? payload.workspaceId : undefined,
        channelId: typeof payload?.channelId === "string" ? payload.channelId : undefined,
        threadId: typeof payload?.threadId === "string" ? payload.threadId : undefined,
        domain: isReceipt ? "receipt" : "channel-message",
        recipientPeerIds: [peerId],
        replicationClass: "standard",
        deliveryState: "stored"
      });
      this.opts.log?.info?.(`[decentchat-peer] queued outbound message for offline peer ${peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] failed to queue outbound message for ${peerId}: ${String(err)}`);
    }
  }
  async flushOfflineQueue(peerId) {
    if (!this.transport || !this.messageProtocol)
      return;
    if (!this.transport.getConnectedPeers().includes(peerId))
      return;
    const queued = await this.offlineQueue.getQueued(peerId);
    if (queued.length === 0)
      return;
    let sentCount = 0;
    let failedCount = 0;
    const deliveredIds = [];
    for (const queuedItem of queued) {
      const item = queuedItem?.data ?? queuedItem;
      if (!item || typeof item !== "object") {
        if (typeof queuedItem?.id === "number") {
          deliveredIds.push(queuedItem.id);
        }
        continue;
      }
      try {
        if (this.isCustodyEnvelope(item)) {
          const resendPayload = item.domain === "channel-message" && this.shouldReencryptCustodyEnvelope(item) ? this.getCustodyResendPayload(item) : null;
          if (resendPayload) {
            const envelope2 = await this.encryptMessageWithPreKeyBootstrap(peerId, resendPayload.content, resendPayload.metadata, resendPayload.workspaceId);
            envelope2.senderId = resendPayload.senderId ?? this.myPeerId;
            envelope2.senderName = resendPayload.senderName ?? this.opts.account.alias;
            envelope2.messageId = item.opId;
            if (resendPayload.isDirect) {
              envelope2.isDirect = true;
            } else {
              envelope2.channelId = resendPayload.channelId ?? item.channelId;
              envelope2.workspaceId = resendPayload.workspaceId ?? item.workspaceId;
            }
            if (resendPayload.threadId)
              envelope2.threadId = resendPayload.threadId;
            if (resendPayload.replyToId)
              envelope2.replyToId = resendPayload.replyToId;
            if (resendPayload.gossipOriginSignature) {
              envelope2._gossipOriginSignature = resendPayload.gossipOriginSignature;
            }
            const accepted3 = this.transport.send(peerId, envelope2);
            if (!accepted3)
              throw new Error("transport rejected queued send");
            await this.queuePendingAck(peerId, {
              messageId: item.opId,
              channelId: resendPayload.channelId ?? item.channelId,
              workspaceId: resendPayload.workspaceId ?? item.workspaceId,
              threadId: resendPayload.threadId ?? item.threadId,
              content: resendPayload.content,
              isDirect: resendPayload.isDirect === true,
              replyToId: resendPayload.replyToId,
              senderId: resendPayload.senderId ?? this.myPeerId,
              senderName: resendPayload.senderName ?? this.opts.account.alias,
              ...resendPayload.metadata ? { metadata: resendPayload.metadata } : {}
            });
            if (typeof queuedItem?.id === "number") {
              deliveredIds.push(queuedItem.id);
            }
            sentCount += 1;
            continue;
          }
          const outbound = typeof item.ciphertext === "object" && item.ciphertext ? { ...item.ciphertext } : item.ciphertext;
          if (!outbound || typeof outbound !== "object") {
            throw new Error("custody envelope missing ciphertext payload");
          }
          outbound._offlineReplay = 1;
          if (!outbound.envelopeId) {
            outbound.envelopeId = item.envelopeId;
          }
          const accepted2 = this.transport.send(peerId, outbound);
          if (!accepted2)
            throw new Error("transport rejected queued send");
          if (item.domain === "channel-message") {
            await this.queuePendingAck(peerId, {
              messageId: item.opId,
              envelopeId: item.envelopeId,
              channelId: item.channelId,
              workspaceId: item.workspaceId,
              threadId: item.threadId,
              ciphertext: outbound,
              isDirect: item.metadata?.isDirect === true,
              replyToId: item.metadata?.replyToId,
              senderId: item.metadata?.senderId ?? this.myPeerId,
              senderName: item.metadata?.senderName ?? this.opts.account.alias
            });
          }
          if (typeof queuedItem?.id === "number") {
            deliveredIds.push(queuedItem.id);
          }
          sentCount += 1;
          continue;
        }
        if (item.type === "read" || item.type === "ack") {
          const accepted2 = this.transport.send(peerId, item);
          if (!accepted2)
            throw new Error("transport rejected queued receipt send");
          if (typeof queuedItem?.id === "number") {
            deliveredIds.push(queuedItem.id);
          }
          sentCount += 1;
          continue;
        }
        if (typeof item.content !== "string") {
          if (typeof queuedItem?.id === "number") {
            deliveredIds.push(queuedItem.id);
          }
          continue;
        }
        if (!item.messageId)
          item.messageId = randomUUID();
        await this.queuePendingAck(peerId, item);
        const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, item.content, item.metadata, item.workspaceId);
        envelope.senderId = item.senderId ?? this.myPeerId;
        envelope.senderName = item.senderName ?? this.opts.account.alias;
        envelope.messageId = item.messageId;
        if (item.isDirect) {
          envelope.isDirect = true;
        } else {
          envelope.channelId = item.channelId;
          envelope.workspaceId = item.workspaceId;
          const gossipOriginSignature = await this.signGossipOrigin({
            messageId: item.messageId,
            channelId: item.channelId,
            content: item.content,
            threadId: item.threadId,
            replyToId: item.replyToId
          });
          if (gossipOriginSignature) {
            envelope._gossipOriginSignature = gossipOriginSignature;
          }
        }
        if (item.threadId)
          envelope.threadId = item.threadId;
        if (item.replyToId)
          envelope.replyToId = item.replyToId;
        const accepted = this.transport.send(peerId, envelope);
        if (!accepted)
          throw new Error("transport rejected queued send");
        if (typeof queuedItem?.id === "number") {
          deliveredIds.push(queuedItem.id);
        }
        sentCount += 1;
      } catch (err) {
        failedCount += 1;
        if (typeof queuedItem?.id === "number") {
          await this.offlineQueue.markAttempt(peerId, queuedItem.id);
        }
        this.opts.log?.warn?.(`[decentchat-peer] failed queued send to ${peerId}: ${String(err)}`);
      }
    }
    if (deliveredIds.length > 0) {
      try {
        await this.offlineQueue.removeBatch(peerId, deliveredIds);
      } catch (batchErr) {
        this.opts.log?.error?.(`[decentchat-peer] batch remove failed, falling back to individual: ${String(batchErr)}`);
        for (const id of deliveredIds) {
          await this.offlineQueue.remove(peerId, id).catch(() => {});
        }
      }
    }
    if (sentCount > 0) {
      this.opts.log?.info?.(`[decentchat-peer] flushed ${sentCount} queued messages to ${peerId}`);
    }
    if (failedCount > 0) {
      this.opts.log?.warn?.(`[decentchat-peer] ${failedCount} queued message(s) remain pending for ${peerId}`);
    }
  }
}

// src/peer.ts
try {
  console.log("[decent-hermes-bridge] PeerTransport heartbeat: defaults (30s/20s/2)");
} catch (err) {
  console.warn("[decent-hermes-bridge] Could not tune PeerTransport heartbeat:", err);
}

class DecentHermesPeer {
  peer = null;
  config;
  messageBuffer = [];
  connected = false;
  alias;
  dataDir;
  activeStreams = new Map;
  hasSignalingState = false;
  anySignalingConnected = false;
  signalingDownSince = null;
  signalingStuckLastLogAt = 0;
  signalingWatchdog = null;
  static SIGNALING_STUCK_THRESHOLD_MS = 10 * 60 * 1000;
  static SIGNALING_WATCHDOG_INTERVAL_MS = 30000;
  static SIGNALING_STUCK_LOG_INTERVAL_MS = 60000;
  constructor(config) {
    this.config = config;
    this.alias = config.alias ?? "Hermes Agent";
    this.dataDir = config.dataDir ?? join3(homedir2(), ".hermes", "decentchat", "data");
    mkdirSync2(this.dataDir, { recursive: true });
  }
  async start() {
    const account = {
      accountId: "default",
      enabled: true,
      dmPolicy: "open",
      configured: true,
      seedPhrase: this.config.seedPhrase,
      signalingServer: this.config.signalingServer ?? "https://0.peerjs.com/",
      invites: this.config.invites ?? [],
      alias: this.alias,
      dataDir: this.dataDir,
      streamEnabled: true,
      replyToMode: "all",
      replyToModeByChatType: {},
      thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 20 },
      huddle: this.config.huddleEnabled !== false ? {
        enabled: true,
        autoJoin: this.config.huddleAutoJoin ?? true,
        sttEngine: this.config.sttEngine ?? "whisper-cpp",
        whisperModel: this.config.whisperModel,
        sttLanguage: this.config.sttLanguage,
        sttApiKey: this.config.sttApiKey,
        ttsEngine: this.config.ttsEngine,
        ttsModel: this.config.ttsModel,
        ttsApiKey: this.config.ttsApiKey,
        ttsVoice: this.config.ttsVoice,
        vadSilenceMs: this.config.vadSilenceMs,
        vadThreshold: this.config.vadThreshold
      } : undefined
    };
    this.peer = new DecentChatNodePeer({
      account,
      onIncomingMessage: async (params) => {
        const decision = this.shouldForwardIncomingMessage({
          chatType: params.chatType,
          content: params.content,
          channelId: params.channelId,
          threadId: params.threadId
        });
        const previewLen = Math.min(params.content.length, 80);
        const preview = params.content.slice(0, previewLen).replace(/\s+/g, " ");
        const forwardTag = decision.reason ? `${decision.forward}(${decision.reason})` : String(decision.forward);
        console.log(`[decent-hermes-peer] inbound message ` + `chatType=${params.chatType} ` + `from=${(params.senderName || params.senderId).slice(0, 24)} ` + `chan=${(params.channelId || "").slice(0, 8)} ` + `ws=${(params.workspaceId || "").slice(0, 8)} ` + `thread=${(params.threadId || "").slice(0, 8)} ` + `len=${params.content.length} ` + `forward=${forwardTag}` + (!decision.forward ? ` reason=channel_post_without_mention (mention @${this.alias || "Xena"} to get a reply, or reply inside a thread she's in)` : "") + ` text="${preview}${params.content.length > previewLen ? "…" : ""}"`);
        if (!decision.forward) {
          return;
        }
        const chatId = params.chatType === "direct" ? `dm:${params.senderId}` : `${params.workspaceId}:${params.channelId}`;
        this.messageBuffer.push({
          id: params.messageId,
          chatId,
          senderId: params.senderId,
          senderAlias: params.senderName,
          body: params.content,
          timestamp: params.timestamp,
          chatType: params.chatType,
          isGroup: params.chatType === "channel",
          workspaceId: params.workspaceId,
          threadId: params.threadId,
          replyToId: params.replyToId,
          attachments: params.attachments
        });
      },
      onReply: () => {},
      onHuddleTranscription: this.config.onVoiceTranscription ? async (text, peerId, channelId, senderName) => {
        const chatId = `voice:${channelId}`;
        this.messageBuffer.push({
          id: randomUUID2(),
          chatId,
          senderId: peerId,
          senderAlias: senderName,
          body: text,
          timestamp: Date.now(),
          chatType: "channel",
          isGroup: true,
          workspaceId: channelId,
          voiceInput: true
        });
        return this.config.onVoiceTranscription(text, chatId, senderName);
      } : undefined,
      log: {
        info: (s) => console.log("[decent-hermes-peer]", s),
        debug: (s) => console.log("[decent-hermes-peer:debug]", s),
        warn: (s) => console.warn("[decent-hermes-peer]", s),
        error: (s) => console.error("[decent-hermes-peer]", s)
      }
    });
    await this.peer.start();
    this.connected = true;
    const transportForState = this.peer.transport;
    if (transportForState && typeof transportForState === "object") {
      try {
        if (typeof transportForState.getSignalingStatus === "function") {
          const initialStatus = transportForState.getSignalingStatus();
          if (Array.isArray(initialStatus) && initialStatus.length > 0) {
            this.hasSignalingState = true;
            this.anySignalingConnected = initialStatus.some((s) => s.connected);
            if (!this.anySignalingConnected) {
              this.signalingDownSince = Date.now();
            }
          }
        }
      } catch (err) {
        console.warn("[decent-hermes-bridge] Failed to read initial signaling status:", err);
      }
      transportForState.onSignalingStateChange = (status) => {
        this.handleSignalingStateChange(status);
      };
    } else {
      console.warn("[decent-hermes-bridge] Underlying PeerTransport not accessible — /health will not reflect live signaling state");
    }
    this.startSignalingWatchdog();
    const extra = (process.env.DECENTCHAT_EXTRA_SIGNALING ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (extra.length > 0) {
      const transport = this.peer.transport;
      if (transport && typeof transport.addSignalingServer === "function") {
        for (const url of extra) {
          try {
            const ok = await transport.addSignalingServer(url, url);
            console.log(`[decent-hermes-bridge] Extra signaling ${url}: ${ok ? "attached" : "failed"}`);
          } catch (err) {
            console.warn(`[decent-hermes-bridge] Failed to attach ${url}: ${err?.message ?? err}`);
          }
        }
      }
    }
  }
  async stop() {
    if (this.signalingWatchdog) {
      clearInterval(this.signalingWatchdog);
      this.signalingWatchdog = null;
    }
    await this.peer?.destroy();
    this.peer = null;
    this.connected = false;
    this.hasSignalingState = false;
    this.anySignalingConnected = false;
    this.signalingDownSince = null;
    this.signalingStuckLastLogAt = 0;
    this.activeStreams.clear();
  }
  isConnected() {
    if (!this.connected || !this.peer)
      return false;
    if (!this.hasSignalingState)
      return true;
    return this.anySignalingConnected;
  }
  getSignalingState() {
    return {
      hasState: this.hasSignalingState,
      anyConnected: this.anySignalingConnected,
      downForMs: this.signalingDownSince ? Date.now() - this.signalingDownSince : null
    };
  }
  handleSignalingStateChange(status) {
    this.hasSignalingState = true;
    const previouslyAnyConnected = this.anySignalingConnected;
    this.anySignalingConnected = status.some((s) => s.connected);
    if (this.anySignalingConnected) {
      if (this.signalingDownSince) {
        const downMs = Date.now() - this.signalingDownSince;
        console.log(`[decent-hermes-bridge] Signaling recovered after ${(downMs / 1000).toFixed(1)}s`);
      }
      this.signalingDownSince = null;
      this.signalingStuckLastLogAt = 0;
    } else {
      if (!this.signalingDownSince) {
        this.signalingDownSince = Date.now();
        if (previouslyAnyConnected) {
          console.warn("[decent-hermes-bridge] All signaling servers disconnected — relying on transport probe to recover");
        }
      }
    }
  }
  startSignalingWatchdog() {
    if (this.signalingWatchdog)
      return;
    this.signalingWatchdog = setInterval(() => {
      if (!this.signalingDownSince)
        return;
      const downMs = Date.now() - this.signalingDownSince;
      if (downMs < DecentHermesPeer.SIGNALING_STUCK_THRESHOLD_MS)
        return;
      const sinceLastLog = Date.now() - this.signalingStuckLastLogAt;
      if (sinceLastLog < DecentHermesPeer.SIGNALING_STUCK_LOG_INTERVAL_MS)
        return;
      this.signalingStuckLastLogAt = Date.now();
      console.error(`[decent-hermes-bridge] SOS: signaling has been down for ${(downMs / 1000).toFixed(0)}s — ` + `transport probe is still trying to reconnect, but you are effectively offline. ` + `Consider restarting the bridge if this persists.`);
    }, DecentHermesPeer.SIGNALING_WATCHDOG_INTERVAL_MS);
    if (typeof this.signalingWatchdog.unref === "function") {
      this.signalingWatchdog.unref();
    }
  }
  shouldForwardIncomingMessage(params) {
    if (params.chatType === "direct")
      return { forward: true };
    if (this.messageMentionsBot(params.content)) {
      return { forward: true };
    }
    if (params.threadId && params.channelId && this.peer?.hasMyMessageInChannelThread(params.channelId, params.threadId)) {
      return { forward: true, reason: "active_thread" };
    }
    return { forward: false };
  }
  messageMentionsBot(content) {
    if (!content)
      return false;
    const alias = this.alias.trim();
    if (alias) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hyphenated = alias.replace(/\s+/g, "-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const aliasPatterns = [`\\b${escapedAlias}\\b`];
      if (hyphenated !== escapedAlias) {
        aliasPatterns.push(`\\b${hyphenated}\\b`);
      }
      const aliasRegex = new RegExp(aliasPatterns.join("|"), "i");
      if (aliasRegex.test(content)) {
        return true;
      }
    }
    if (!content.includes("@"))
      return false;
    const normalizedContent = this.normalizeMentionValue(content);
    if (alias) {
      const normalizedAlias = this.normalizeMentionValue(alias);
      const hyphenatedAlias = this.normalizeMentionValue(alias.replace(/\s+/g, "-"));
      if (normalizedContent.includes(`@${normalizedAlias}`) || normalizedContent.includes(`@${hyphenatedAlias}`)) {
        return true;
      }
    }
    const mentionTokens = content.match(/(^|\s)@[A-Za-z0-9_.:-]+/g) ?? [];
    if (mentionTokens.length === 0)
      return false;
    const mentionTargets = this.getMentionTargets();
    for (const token of mentionTokens) {
      const mentionValue = this.normalizeMentionValue(token.replace(/^\s*@/, ""));
      if (mentionTargets.has(mentionValue)) {
        return true;
      }
    }
    return false;
  }
  getMentionTargets() {
    const targets = new Set;
    const alias = this.alias.trim();
    if (alias) {
      targets.add(this.normalizeMentionValue(alias));
      targets.add(this.normalizeMentionValue(alias.replace(/\s+/g, "-")));
    }
    const peerId = this.peer?.peerId?.trim();
    if (peerId) {
      targets.add(this.normalizeMentionValue(peerId));
      if (peerId.length >= 8)
        targets.add(this.normalizeMentionValue(peerId.slice(0, 8)));
    }
    return targets;
  }
  normalizeMentionValue(value) {
    return value.trim().toLowerCase();
  }
  drainMessages() {
    const msgs = [...this.messageBuffer];
    this.messageBuffer = [];
    return msgs;
  }
  async sendMessage(chatId, body, voiceReply = false, replyToId, threadId, model) {
    if (!this.peer)
      throw new Error("Peer not started");
    const messageId = randomUUID2();
    const effectiveThreadId = threadId ?? replyToId;
    await this.waitForRecipientConnectivity(chatId, 5000);
    if (chatId.startsWith("dm:")) {
      const peerId = chatId.slice(3);
      await this.peer.sendDirectToPeer(peerId, body, effectiveThreadId, replyToId, messageId, model);
    } else if (chatId.startsWith("voice:")) {
      const channelId = chatId.slice(6);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, messageId, model);
    } else {
      const colonIdx = chatId.indexOf(":");
      if (colonIdx < 0)
        throw new Error(`Invalid chatId: ${chatId}`);
      const channelId = chatId.slice(colonIdx + 1);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, messageId, model);
    }
    return messageId;
  }
  async startStream(chatId, options = {}) {
    if (!this.peer)
      throw new Error("Peer not started");
    const messageId = options.messageId ?? randomUUID2();
    const effectiveThreadId = options.threadId ?? options.replyTo;
    await this.waitForRecipientConnectivity(chatId, 5000);
    if (chatId.startsWith("dm:")) {
      const peerId = chatId.slice(3);
      await this.peer.startDirectStream({
        peerId,
        messageId,
        ...options.model ? { model: options.model } : {}
      });
      this.activeStreams.set(messageId, {
        chatId,
        isDirect: true,
        peerId,
        channelId: peerId,
        workspaceId: "direct",
        threadId: effectiveThreadId,
        replyToId: options.replyTo,
        model: options.model,
        chunks: []
      });
      return messageId;
    }
    const colonIdx = chatId.indexOf(":");
    const isVoice = chatId.startsWith("voice:");
    const channelId = isVoice ? chatId.slice(6) : colonIdx >= 0 ? chatId.slice(colonIdx + 1) : "";
    if (!channelId)
      throw new Error(`Invalid chatId: ${chatId}`);
    const workspaceId = isVoice ? this.resolveWorkspaceForChannel(channelId) ?? "" : chatId.slice(0, colonIdx);
    await this.peer.startStream({
      channelId,
      workspaceId,
      messageId,
      ...effectiveThreadId ? { threadId: effectiveThreadId } : {},
      ...options.replyTo ? { replyToId: options.replyTo } : {},
      ...options.model ? { model: options.model } : {}
    });
    this.activeStreams.set(messageId, {
      chatId,
      isDirect: false,
      channelId,
      workspaceId,
      threadId: effectiveThreadId,
      replyToId: options.replyTo,
      model: options.model,
      chunks: []
    });
    return messageId;
  }
  async appendStream(chatId, messageId, content) {
    if (!this.peer)
      throw new Error("Peer not started");
    if (!messageId)
      throw new Error("messageId required");
    if (!content)
      return;
    let state = this.activeStreams.get(messageId);
    if (!state) {
      await this.startStream(chatId, { messageId });
      state = this.activeStreams.get(messageId);
      if (!state)
        throw new Error(`Failed to initialize stream: ${messageId}`);
    }
    state.chunks.push(content);
    if (state.isDirect) {
      await this.peer.sendDirectStreamDelta({
        peerId: state.peerId,
        messageId,
        content
      });
      return;
    }
    await this.peer.sendStreamDelta({
      channelId: state.channelId,
      workspaceId: state.workspaceId,
      messageId,
      content
    });
  }
  async finishStream(chatId, messageId) {
    if (!this.peer)
      throw new Error("Peer not started");
    if (!messageId)
      throw new Error("messageId required");
    let state = this.activeStreams.get(messageId);
    if (!state) {
      await this.startStream(chatId, { messageId });
      state = this.activeStreams.get(messageId);
      if (!state)
        throw new Error(`Failed to initialize stream: ${messageId}`);
    }
    if (state.isDirect) {
      await this.peer.sendDirectStreamDone({
        peerId: state.peerId,
        messageId
      });
    } else {
      await this.peer.sendStreamDone({
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        messageId
      });
    }
    const fullContent = state.chunks.join("").trim();
    if (fullContent) {
      await this.peer.persistMessageLocally(state.channelId, state.workspaceId, fullContent, state.threadId, state.replyToId, messageId, state.model);
    }
    this.activeStreams.delete(messageId);
  }
  async waitForRecipientConnectivity(chatId, timeoutMs) {
    if (!this.peer)
      return;
    const transport = this.peer.transport;
    if (!transport || typeof transport.getConnectedPeers !== "function")
      return;
    const myPeerId = this.peer.myPeerId;
    const targetPeers = [];
    if (chatId.startsWith("dm:")) {
      targetPeers.push(chatId.slice(3));
    } else {
      let channelId;
      if (chatId.startsWith("voice:")) {
        channelId = chatId.slice(6);
      } else {
        const colonIdx = chatId.indexOf(":");
        if (colonIdx < 0)
          return;
        channelId = chatId.slice(colonIdx + 1);
      }
      try {
        const workspaces = this.peer.workspaceManager?.getAllWorkspaces?.() ?? [];
        for (const ws of workspaces) {
          if (!ws.channels?.some((ch) => ch.id === channelId))
            continue;
          for (const m of ws.members ?? []) {
            if (m.peerId && m.peerId !== myPeerId)
              targetPeers.push(m.peerId);
          }
        }
      } catch {}
    }
    if (targetPeers.length === 0)
      return;
    const isAnyConnected = () => {
      const connected = transport.getConnectedPeers();
      return targetPeers.some((p) => connected.includes(p));
    };
    if (isAnyConnected())
      return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (isAnyConnected())
        return;
    }
  }
  async sendTyping(chatId, typing) {
    if (!this.peer)
      return;
    if (chatId.startsWith("dm:")) {
      const peerId = chatId.slice(3);
      await this.peer.sendDirectTyping({ peerId, typing });
    } else if (chatId.startsWith("voice:")) {
      return;
    } else {
      const colonIdx = chatId.indexOf(":");
      if (colonIdx < 0)
        return;
      const workspaceId = chatId.slice(0, colonIdx);
      const channelId = chatId.slice(colonIdx + 1);
      await this.peer.sendTyping({ channelId, workspaceId, typing });
    }
  }
  resolveWorkspaceForChannel(channelId) {
    if (!this.peer)
      return;
    try {
      const workspaces = this.peer.workspaceManager?.getAllWorkspaces?.() ?? [];
      for (const ws of workspaces) {
        if (ws.channels?.some((ch) => ch.id === channelId)) {
          return ws.id;
        }
      }
    } catch {}
    return;
  }
  async getChatInfo(chatId) {
    if (chatId.startsWith("dm:")) {
      const peerId = chatId.slice(3);
      const truncatedPeerId = peerId.length > 16 ? `${peerId.slice(0, 8)}...${peerId.slice(-4)}` : peerId;
      const aliasFromDirectory = this.peer?.listDirectoryPeersLive({ query: peerId, limit: 20 }).find((entry) => entry.id === peerId)?.name?.trim();
      const aliasFromCache = this.peer?.store?.get?.(`peer-alias-${peerId}`, "")?.trim();
      return {
        name: aliasFromDirectory || aliasFromCache || truncatedPeerId,
        type: "private",
        chat_id: chatId
      };
    }
    if (chatId.startsWith("voice:")) {
      return { name: `Voice: ${chatId.slice(6)}`, type: "voice", chat_id: chatId };
    }
    const colonIdx = chatId.indexOf(":");
    if (colonIdx < 0)
      return { name: chatId, type: "unknown", chat_id: chatId };
    const workspaceId = chatId.slice(0, colonIdx);
    const channelId = chatId.slice(colonIdx + 1);
    try {
      const workspaces = this.peer.workspaceManager?.getAllWorkspaces?.() ?? [];
      for (const ws of workspaces) {
        if (ws.id === workspaceId) {
          const ch = ws.channels?.find((c) => c.id === channelId);
          return {
            name: ch?.name ?? channelId,
            type: "group",
            chat_id: chatId
          };
        }
      }
    } catch {}
    return { name: channelId, type: "group", chat_id: chatId };
  }
}

// src/bridge-app.ts
import express from "express";
var PROGRESSIVE_REPLY_CHUNK_MAX_CHARS = 500;
var PROGRESSIVE_REPLY_CHUNK_DELAY_MS = 100;
function splitReplyIntoChunks(body, maxChars = PROGRESSIVE_REPLY_CHUNK_MAX_CHARS) {
  if (body.length <= maxChars)
    return [body];
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0)
    return [body];
  const chunks = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0;offset < word.length; offset += maxChars) {
        chunks.push(word.slice(offset, offset + maxChars));
      }
      continue;
    }
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = word;
  }
  if (current)
    chunks.push(current);
  return chunks.length > 0 ? chunks : [body];
}
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
function createBridgeApp(peer, alias, options = {}) {
  const app = express();
  const messagePollTimeoutMs = options.messagePollTimeoutMs ?? 20000;
  const messagePollIntervalMs = options.messagePollIntervalMs ?? 400;
  const maxReplyChunkChars = options.maxReplyChunkChars ?? PROGRESSIVE_REPLY_CHUNK_MAX_CHARS;
  const chunkDelayMs = options.chunkDelayMs ?? PROGRESSIVE_REPLY_CHUNK_DELAY_MS;
  app.use(express.json());
  app.get("/health", (_req, res) => {
    const connected = peer.isConnected();
    res.json({
      status: connected ? "connected" : "connecting",
      connected,
      alias
    });
  });
  app.get("/messages", async (_req, res) => {
    const deadline = Date.now() + messagePollTimeoutMs;
    while (Date.now() < deadline) {
      const msgs = peer.drainMessages();
      if (msgs.length > 0) {
        res.json(msgs);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, messagePollIntervalMs));
    }
    res.json([]);
  });
  app.post("/send", async (req, res) => {
    const { chatId, body, replyTo, threadId, model } = req.body;
    if (!chatId || !body) {
      res.status(400).json({ success: false, error: "chatId and body required" });
      return;
    }
    try {
      const chunks = splitReplyIntoChunks(body, maxReplyChunkChars);
      const messageId = await peer.startStream(chatId, {
        ...replyTo ? { replyTo } : {},
        ...threadId ? { threadId } : {},
        ...model ? { model } : {}
      });
      for (let index = 0;index < chunks.length; index += 1) {
        await peer.appendStream(chatId, messageId, chunks[index]);
        if (index < chunks.length - 1 && chunkDelayMs > 0) {
          await sleep(chunkDelayMs);
        }
      }
      await peer.finishStream(chatId, messageId);
      res.json({ success: true, messageId, chunkCount: chunks.length });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });
  app.post("/stream/start", async (req, res) => {
    const { chatId, replyTo, threadId, model, messageId } = req.body;
    if (!chatId) {
      res.status(400).json({ success: false, error: "chatId required" });
      return;
    }
    try {
      const startedMessageId = await peer.startStream(chatId, {
        ...replyTo ? { replyTo } : {},
        ...threadId ? { threadId } : {},
        ...model ? { model } : {},
        ...messageId ? { messageId } : {}
      });
      res.json({ success: true, messageId: startedMessageId });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });
  app.post("/stream/chunk", async (req, res) => {
    const { chatId, messageId, content } = req.body;
    if (!chatId || !messageId) {
      res.status(400).json({ success: false, error: "chatId and messageId required" });
      return;
    }
    try {
      await peer.appendStream(chatId, messageId, String(content ?? ""));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });
  app.post("/stream/done", async (req, res) => {
    const { chatId, messageId } = req.body;
    if (!chatId || !messageId) {
      res.status(400).json({ success: false, error: "chatId and messageId required" });
      return;
    }
    try {
      await peer.finishStream(chatId, messageId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });
  app.post("/typing", async (req, res) => {
    const { chatId, typing } = req.body;
    if (!chatId) {
      res.status(400).json({ success: false, error: "chatId required" });
      return;
    }
    try {
      if (peer.sendTyping) {
        await peer.sendTyping(chatId, typing === true);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });
  app.get("/chat/:chatId", async (req, res) => {
    const chatId = decodeURIComponent(req.params.chatId).replace(/~/g, ":");
    try {
      const info = await peer.getChatInfo(chatId);
      res.json(info);
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });
  return app;
}

// src/bridge.ts
function getArg(name, def = "") {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}
var PORT = parseInt(getArg("port", process.env.DECENTCHAT_BRIDGE_PORT ?? "3001"), 10);
var DATA_DIR = getArg("data-dir", process.env.DECENTCHAT_DATA_DIR ?? "");
var SEED_PHRASE = getArg("seed-phrase", process.env.DECENTCHAT_SEED_PHRASE ?? "");
var ALIAS = getArg("alias", process.env.DECENTCHAT_ALIAS ?? "Hermes Agent");
var SIGNALING = getArg("signaling-server", process.env.DECENTCHAT_SIGNALING_SERVER ?? "https://0.peerjs.com/");
var INVITES_RAW = getArg("invites", process.env.DECENTCHAT_INVITES ?? "");
var INVITES = INVITES_RAW ? INVITES_RAW.split(",").map((s) => s.trim()).filter(Boolean) : [];
var HUDDLE_ENABLED = !hasFlag("no-huddle");
var HUDDLE_AUTO_JOIN = !hasFlag("no-auto-join");
var STT_ENGINE = getArg("stt-engine", process.env.DECENTCHAT_STT_ENGINE ?? "whisper-cpp");
var STT_API_KEY = getArg("stt-api-key", process.env.DECENTCHAT_STT_API_KEY ?? "");
var TTS_ENGINE = getArg("tts-engine", process.env.DECENTCHAT_TTS_ENGINE ?? "");
var TTS_API_KEY = getArg("tts-api-key", process.env.DECENTCHAT_TTS_API_KEY ?? "");
var TTS_VOICE = getArg("tts-voice", process.env.DECENTCHAT_TTS_VOICE ?? "");
var HERMES_API_URL = getArg("hermes-api-url", process.env.HERMES_API_URL ?? "http://127.0.0.1:8642");
async function main() {
  if (!SEED_PHRASE) {
    throw new Error("--seed-phrase or DECENTCHAT_SEED_PHRASE required");
  }
  const peer = new DecentHermesPeer({
    seedPhrase: SEED_PHRASE,
    signalingServer: SIGNALING,
    ...DATA_DIR ? { dataDir: DATA_DIR } : {},
    alias: ALIAS,
    invites: INVITES,
    huddleEnabled: HUDDLE_ENABLED,
    huddleAutoJoin: HUDDLE_AUTO_JOIN,
    ...STT_ENGINE ? { sttEngine: STT_ENGINE } : {},
    ...STT_API_KEY ? { sttApiKey: STT_API_KEY } : {},
    ...TTS_ENGINE ? { ttsEngine: TTS_ENGINE } : {},
    ...TTS_API_KEY ? { ttsApiKey: TTS_API_KEY } : {},
    ...TTS_VOICE ? { ttsVoice: TTS_VOICE } : {},
    onVoiceTranscription: HERMES_API_URL ? async (text, chatId) => {
      try {
        const res = await fetch(`${HERMES_API_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hermes-Session-Id": chatId
          },
          body: JSON.stringify({
            model: "hermes-agent",
            messages: [{ role: "user", content: text }],
            stream: false
          })
        });
        if (!res.ok)
          return;
        const data = await res.json();
        return data?.choices?.[0]?.message?.content;
      } catch (e) {
        console.error("[decent-hermes-bridge] voice transcription API call failed:", e);
        return;
      }
    } : undefined
  });
  const app = createBridgeApp(peer, ALIAS);
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[decent-hermes-bridge] HTTP server listening on 127.0.0.1:${PORT}`);
  });
  console.log(`[decent-hermes-bridge] Starting DecentChat peer as "${ALIAS}"...`);
  await peer.start();
  console.log("[decent-hermes-bridge] Peer connected");
  const _logSignal = (sig) => {
    const ppid = process.ppid ?? "unknown";
    const upMs = Math.round(process.uptime() * 1000);
    console.log(`[decent-hermes-bridge] Received ${sig} (pid=${process.pid} ppid=${ppid} uptime=${upMs}ms)`);
  };
  process.on("SIGTERM", async () => {
    _logSignal("SIGTERM");
    console.log("[decent-hermes-bridge] Shutting down...");
    await peer.stop();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    _logSignal("SIGINT");
    await peer.stop();
    process.exit(0);
  });
  for (const sig of ["SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2", "SIGPIPE"]) {
    process.on(sig, () => _logSignal(sig));
  }
}
var isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((e) => {
    console.error("[decent-hermes-bridge] Peer start failed:", e);
    process.exit(1);
  });
}
export {
  main
};
