"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const js_stellar_domain_1 = require("@stellarbeat/js-stellar-domain");
exports.default = {
    readFilePromise: function (path) {
        return new Promise((resolve, reject) => fs.readFile(path, 'utf8', function callback(err, data) {
            if (err) {
                reject(err);
            }
            else {
                resolve(data);
            }
        }));
    },
    writeFilePromise: function (fileName, data) {
        return new Promise((resolve, reject) => fs.writeFile(fileName, data, 'utf8', function callback(err) {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        }));
    },
    getNodesFromFile: function (fileName) {
        return __awaiter(this, void 0, void 0, function* () {
            let nodesJson = yield this.readFilePromise(fileName);
            let nodesRaw = JSON.parse(nodesJson);
            return nodesRaw.map((node) => {
                return js_stellar_domain_1.Node.fromJSON(node);
            });
        });
    },
};
//# sourceMappingURL=json-storage.js.map