# Crawler functionality and architecture 
## Crawler class
Responsibilities:
- Manage the crawl queue. Making sure that we don't connect to too many nodes at once
- Interacts with the Network Observer and direct it which nodes to connect (based on the queue)
- Listens to the Network Observer if new peers are detected and adds them to the queue. 
- Returns a crawl result to the caller of this library

## Network Observer
Responsibilities:
- Creates an Observation and directs state changes through the Observation Manager.
- Connect to Top Tier nodes and maintain their connections to have the most accurate lag measurements
- Connect to other peer nodes in the network and listen to their messages (directed by the Crawler)
- Sets up a peer event listener to listen to connection, data, close and error events from peers.
- Detect new peers and notify the Crawler class
- Forwards ledger closes to the Observation Manager. 

## Observation
Responsibilities:
- Stores the state of peer nodes
- Stores the state of the Network Observation and manages transitions between states 
- States:
  - IDLE: initial state
  - SYNCING: connect to top tier nodes
  - SYNCED: connected to top tier nodes, ready to connect to peer nodes, confirm ledger closes and measure peer lag
  - STOPPING: stop the observation, give (top tier) peers the chance to close the connection gracefully and detect the last information.
  - STOPPED: observation is stopped, connections are closed and no more connections are made. No more state changes are allowed.

## Observation Manager
Responsibilities: 
- Manages the state of the Observation
- Manages the transitions between states
- Starts necessary timers (straggler & consensus) on state transitions and when ledgers are closed

### Straggler Timer
- When a ledger is closed, the straggler timer is started for all active (connected) non-top tier nodes.
- This gives the nodes a chance to externalize the closed ledger, indicating its validation state and the time it took to do so (lag). 
- It also gives nodes the time to send their QuorumSet to us. 
- When the straggler timer expires, the node is disconnected.
- In case of a network halt, the straggler timer is started for all active nodes, to give them the change to send their QuorumSet if needed.  
- When the observation is stopping, the straggler timer fires for all nodes (including top tier).

### Consensus Timer
- If no ledger is confirmed closed, the consensus timer times out and indicates a network halt.
- Every time a ledger is confirmed closed, the consensus timer is reset.
- If the network is halted, the observation manager will start a straggler timeout for all active (non-top tier) nodes. This gives other peers in the crawl queue a chance to connect to the halted network and detect the last information (Public Keys, version strings, quorumset,...).
- If the network is halted and a new node connects, a straggler timeout is immediately fired for that node. This allows to detect minimal information from the node, disconnect and give others a chance.

## Peer Event Handler
Responsibilities:
- Listen to connection, data, close and error events from peers
- Processes data (Stellar Message) events, detects ledger closes or new peers and returns them to the Network Observer. 
- See readme in stellar-message-handler directory for more information on handling of data events.



