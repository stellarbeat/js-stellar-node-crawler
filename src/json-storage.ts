import * as fs from 'fs';
import {Node, QuorumSet} from "@stellarbeat/js-stellar-domain";

export default {
    readFilePromise: function (path:string) {
        return new Promise((resolve, reject) =>
            fs.readFile(path, 'utf8', function callback(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            })
        );
    },

    writeFilePromise: function (fileName:string, data: any) {
        return new Promise((resolve, reject) =>
            fs.writeFile(fileName, data, 'utf8', function callback(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({});
                }
            })
        );
    },

    getNodesFromFile: async function (fileName:string) {
        let nodesJson = await this.readFilePromise(fileName) as string;
        let nodesRaw = JSON.parse(nodesJson);

        return nodesRaw.map((node:{}) => {
            return Node.fromJSON(node);
        });
    },
};

