import {Node, Network} from "@stellarbeat/js-stellar-domain";

export default {
    updateNodeStatistics: function (node: Node) {
        if(node.active) {
            node.statistics.incrementActiveCounter();
            node.statistics.activeInLastCrawl = true;
        } else {
            node.statistics.decrementActiveCounter();
            node.statistics.activeInLastCrawl = false;
        }

        if(node.overLoaded) {
            node.statistics.incrementOverLoadedCounter();
            node.statistics.overLoadedInLastCrawl = true;
        } else {
            node.statistics.decrementOverLoadedCounter();
            node.statistics.overLoadedInLastCrawl = false;
        }

        if(node.isValidating) {
            node.statistics.incrementValidatingCounter();
            node.statistics.validatingInLastCrawl = true;
        } else {
            node.statistics.decrementValidatingCounter();
            node.statistics.validatingInLastCrawl = false;
        }
    },

    updateNetworkStatistics: function (network: Network) {
        //todo
    }
};