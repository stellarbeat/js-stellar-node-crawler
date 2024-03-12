# Stellar Message structure (simplified)

An Externalize Statement is part of an ScpEnvelope that is a type of StellarMessage that contains an ScpStatement

Source: [Stellar-overlay.x](https://github.com/stellar/stellar-xdr)

The directory structure mimics this. 

## StellarMessage Types
* ScpEnvelope
* Peers 
* Error 
* QuorumSet
* ...

Message is already verified to be from the sending Node in the NodeConnector package through symmetric key encryption (HMAC).

### Peers
Contains the peers advertised by the sending node. These peers are then also crawled to discover the whole network.  

### Error
Contains an error message after completing a successful handshake.
We are most interested in the ErrLoad messages, which indicate that a node is running at capacity.

### ScpEnvelope
Contains a signature and a ScpStatement. Signature is verified through public key encryption to be from the signing node (not necessarily the sender as these messages can be relayed by other nodes) 

An ScpStatement is a message that is part of the consensus process. It contains a slotIndex (=ledger sequence), NodeId, and a type of ScpStatement.

### ScpStatement Types 
* Nominate
* Prepare
* Confirm
* Externalize

We use the Externalize messages to determine ledger closing and the validating state of a Node.
The other types of messages are used to determine if a Node is participating in consensus. For example if it is lagging behind we want to listen a bit longer for its externalize messages