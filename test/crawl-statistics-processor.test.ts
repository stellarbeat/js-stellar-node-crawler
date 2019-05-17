import {Node} from '@stellarbeat/js-stellar-domain';
import {ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import CrawlStatisticsProcessor from "./../src/crawl-statistics-processor";

let node = new Node("localhost");
node.isValidating = true;


test('constructor', () => {
    CrawlStatisticsProcessor.updateNodeStatistics(node);

    expect(node.statistics.validatingCounter).toEqual(1);
    expect(node.statistics.validatingRating).toEqual(1);

    node.isValidating = false;
    CrawlStatisticsProcessor.updateNodeStatistics(node);
    expect(node.statistics.validatingCounter).toEqual(0);
    expect(node.statistics.validatingRating).toEqual(0);
});