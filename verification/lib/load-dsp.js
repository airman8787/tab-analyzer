// tab-analyzer.html の DSP 部分（==DSP-START== 〜 ==DSP-END==）を Node.js で読み込み、関数を取り出す
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = path.join(__dirname, "..", "..", "tab-analyzer.html");

function loadDsp(names) {
  const src = fs.readFileSync(HTML, "utf8");
  const a = src.indexOf("// ==DSP-START=="), b = src.indexOf("// ==DSP-END==");
  if (a < 0 || b < 0) throw new Error("DSP section not found in " + HTML);
  const ctx = vm.createContext({ console, Math, Float32Array, Float64Array, Int8Array, Int32Array, Uint8Array, Uint16Array, Array, Object, Number, Infinity, NaN, String, Set, JSON });
  vm.runInContext(src.slice(a, b) + ";this.__api={" + names.join(",") + "};", ctx);
  return ctx.__api;
}

module.exports = { loadDsp };
