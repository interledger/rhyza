# Peer Lifecycle

- Create peer
- Update ILP connection details
- Ping peer (healthchecks)
- Activate peer
- Deactivate peer

## Peer creation

```mermaid
sequenceDiagram
	autonumber
    participant ASE
    participant AAPI as Admin API
    participant PAL as PAL BC
    participant ILPBC as ILP BC

    ASE ->> AAPI: POST /peers
    AAPI -->> PAL: createPeer rpc
    PAL ->> PAL: Create peer, create associated ledger accounts, <br> set ILP as communication method & activate
    AAPI -->> ILPBC: createPeer rpc <br>(with connection details)
    ILPBC ->> ILPBC: Create peer with connection details. Peer active by default.
    AAPI ->> ASE: Peer id
```

## Peer activation/deactivation

```mermaid
sequenceDiagram
	autonumber
    participant ASE
    participant AAPI as Admin API
    participant PAL as PAL BC
    participant ILPBC as ILP BC

    ASE ->> AAPI: POST /peers/{id}/activate
    AAPI -->> PAL: activatePeer rpc
    PAL ->> PAL: Activate peer
    PAL ->> PAL: Publish PeerActivatedEvent
    ILPBC -->> PAL: Read PeerActivatedEvent
    ILPBC ->> ILPBC: Activate peer
    AAPI ->> ASE: OK
```

## Update peer name

```mermaid
sequenceDiagram
	autonumber
    participant ASE
    participant AAPI as Admin API
    participant PAL as PAL BC

    ASE ->> AAPI: PUT /peers/{id}/name
    AAPI ->> PAL: updatePeerName rpc
    AAPI ->> ASE: OK
```

## Peer connection details update

```mermaid
sequenceDiagram
	autonumber
    participant ASE
    participant AAPI as Admin API
    participant ILPBC as ILP BC

    ASE ->> AAPI: POST /peers/{id}/ilp-connection
    AAPI ->> ILPBC: updatePeerConnectionDetails rpc
    AAPI ->> ASE: OK
```

## Peer healthcheck/ping

```mermaid
sequenceDiagram
	autonumber
    participant ASE
    participant AAPI as Admin API
    participant ILPBC as ILP BC

    ASE ->> AAPI: POST /peers/{id}/healthcheck
    AAPI ->> ILPBC: runPeerHealthcheck rpc

    ILPBC ->> AAPI: Healthcheck status
    AAPI ->> ASE: Healthcheck status

```
