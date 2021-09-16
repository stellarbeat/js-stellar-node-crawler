import {Crawler, CrawlerConfiguration} from "./crawler";
import {QuorumSetManager} from "./quorum-set-manager";
import * as P from "pino";
import {log} from "async";
import * as LRUCache from "lru-cache";

export class CrawlerFactory {
    static createCrawler(config: CrawlerConfiguration, logger?: P.Logger) {
        if (!logger) {
            logger = CrawlerFactory.initializeDefaultLogger();
        }

        return new Crawler(config, new QuorumSetManager(logger), new LRUCache(5000), logger)
    }

    static initializeDefaultLogger() {
        return P({
            level: process.env.LOG_LEVEL || 'info',
            base: undefined,
        });
    }
}