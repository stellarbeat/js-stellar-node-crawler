import {Crawler, CrawlerConfiguration} from "./crawler";
import {QuorumSetManager} from "./quorum-set-manager";
import * as P from "pino";
import * as LRUCache from "lru-cache";
import {ScpManager} from "./scp-manager";

export class CrawlerFactory {
    static createCrawler(config: CrawlerConfiguration, logger?: P.Logger) {
        if (!logger) {
            logger = CrawlerFactory.initializeDefaultLogger();
        }

        let quorumSetManager = new QuorumSetManager(logger);
        return new Crawler(config, quorumSetManager, new ScpManager(quorumSetManager, logger),  logger)
    }

    static initializeDefaultLogger() {
        return P({
            level: process.env.LOG_LEVEL || 'info',
            base: undefined,
        });
    }
}