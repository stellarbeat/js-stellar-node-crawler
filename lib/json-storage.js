const fs = require('fs');
const Node = require("@stellarbeat/js-stellar-domain").Node;
const QuorumSet = require("@stellarbeat/js-stellar-domain").QuorumSet;

module.exports = {
    readFilePromise: function (path) {
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

    writeFilePromise: function (fileName, data) {
        return new Promise((resolve, reject) =>
            fs.writeFile(fileName, data, 'utf8', function callback(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            })
        );
    },

    getNodesFromFile: async function (fileName) {
        let nodesJson = await this.readFilePromise(fileName);
        console.log(nodesJson);
        let nodesRaw = JSON.parse(nodesJson);

        return nodesRaw.map((node) => {
            return Node.fromJSON(node);
        });
    },

};

