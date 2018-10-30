//@flow

const Node = require("@stellarbeat/js-stellar-domain").Node;
const Network = require("@stellarbeat/js-stellar-domain").Network;

module.exports = {
    updateNodeStatistics: function (node: Node) {
        if(node.active) {
            node.statistics.incrementActiveCounter();
            node.statistics.activeInLastCrawl = true;
        } else {
            node.statistics.decrementActiveCounter();
            node.statistics.activeInLastCrawl = false;
        }

        if(node.statistics.activeRating > 0 ) {
            //to avoid heavy changes after every crawl, we update the nodes active status to their average
            //todo: find out why we have such differences between crawls on node active status.
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

    updateNetworkStatistics: function (network: Network) {
        //todo
    }
};