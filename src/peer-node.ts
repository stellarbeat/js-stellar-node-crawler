import {QuorumSet} from "@stellarbeat/js-stellar-domain";

export interface Peer {
    publicKey: string;
    participatingInSCP: boolean;
    quorumSetHash: string | undefined;
    quorumSet: QuorumSet | undefined;
    isValidating: boolean;
}

export class PeerNode implements Peer{
    public ip: string;
    public port: number;
    public publicKey: string;
    public ledgerVersion: number;
    public overlayVersion: number;
    public overlayMinVersion: number;
    public networkId: string;
    public versionStr: string;
    public active = false;
    public isValidating = false;
    public participatingInSCP = false;
    public overLoaded = false;
    public quorumSetHash: string | undefined;
    public quorumSet: QuorumSet | undefined;
    public suppliedPeerList: boolean = false;

    constructor(ip: string, port: number, publicKey: string, ledgerVersion: number, overlayVersion: number, overlayMinVersion: number, networkId: string, versionStr: string) {
        this.ip = ip;
        this.port = port;
        this.publicKey = publicKey;
        this.ledgerVersion = ledgerVersion;
        this.overlayVersion = overlayVersion;
        this.overlayMinVersion = overlayMinVersion;
        this.networkId = networkId;
        this.versionStr = versionStr;
    }

    get key() {
        return this.ip + ":" + this.port;
    }
}

/**
 * An unknown PeerNode is a Peer that we heard about through SCP messages, but haven't connected to.
 */
export class UnknownPeerNode implements Peer {
    public publicKey: string;
    public participatingInSCP: boolean = false;
    public quorumSetHash: string | undefined;
    public quorumSet: QuorumSet | undefined;
    public isValidating = false;

    constructor(publicKey: string) {
        this.publicKey = publicKey;
    }
}