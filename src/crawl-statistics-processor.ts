import {Node, Network} from "@stellarbeat/js-stellar-domain";

export default {
    updateNodeStatistics: function (node: Node) {
        node.statistics.activeInLastCrawl = node.active;
        node.statistics.overLoadedInLastCrawl = node.overLoaded;
        node.statistics.validatingInLastCrawl = node.isValidating;
    }
}