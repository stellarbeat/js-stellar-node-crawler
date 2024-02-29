export class MaxOpenConnectionsConfigError extends Error {
	constructor(topTierSize: number, maxOpenConnections: number) {
		super(
			`Max open connections (${maxOpenConnections}) is smaller than top tier size (${topTierSize}).`
		);
	}
}
