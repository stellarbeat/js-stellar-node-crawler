//

const Node = require("@stellarbeat/js-stellar-domain").Node;
const Network = require("@stellarbeat/js-stellar-domain").Network;

module.exports = {
    updateNodeStatistics: function (node) {
        if(node.active) {
            node.statistics.incrementActiveCounter();
        } else {
            node.statistics.decrementActiveCounter();
        }

        if(node.overLoaded) {
            node.statistics.incrementOverLoadedCounter();
        } else {
            node.statistics.decrementOverLoadedCounter();
        }
    },

    updateNetworkStatistics: function (network) {
        //todo
    }
};