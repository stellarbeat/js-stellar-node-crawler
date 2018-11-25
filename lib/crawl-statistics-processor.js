//

const Node = require("@stellarbeat/js-stellar-domain").Node;
const Network = require("@stellarbeat/js-stellar-domain").Network;

module.exports = {
    updateNodeStatistics: function (node) {
        if(node.active) {
            node.statistics.incrementActiveCounter();
            node.statistics.activeInLastCrawl = true;
        } else {
            node.statistics.decrementActiveCounter();
            node.statistics.activeInLastCrawl = false;
        }

        if(node.statistics.activeRating > 0 ) {
            node.active = true;
        } else {
            node.active = false;
        }

        if(node.overLoaded) {
            node.statistics.incrementOverLoadedCounter();
            node.statistics.overLoadedInLastCrawl = true;
        } else {
            node.statistics.decrementOverLoadedCounter();
            node.statistics.overLoadedInLastCrawl = false;
        }
        //todo how do we represent that a node is overloaded most of the time. overloaded rating?
    },

    updateNetworkStatistics: function (network) {
        //todo
    }
};