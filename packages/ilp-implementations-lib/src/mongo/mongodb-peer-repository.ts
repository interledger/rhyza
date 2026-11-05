import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { ILogger } from 'common-types-lib';
import { IPacketCorrelation, IPeer, IPeerStore } from 'ilp-domain-lib';

const DB_NAME = 'ilp';
const PEERS_COLLECTION_NAME = 'peers';
const PACKETS_COLLECTION_NAME = 'packetCorrelations';
const TIMEOUT_MS = 5_000;

// Packets expire in ~30s, so this is purely an operational window
// for reconciling a payment against the transport record
// The durable history lives in the Payments BC. Without it the collection grows without bound.
export const PACKET_RETENTION_SECONDS = 7 * 24 * 60 * 60;

// Single-writer store for ILP peer configuration and packet correlations.
// Only ilp-command-handler-service should mutate this repo
// API service processes publish CreatePeerCmd/UpdatePeerCmd instead of writing directly,
// so this remains the sole cache/consistency owner regardless of how many
// API service instances are deployed.
export class MongoDbPeerRepository implements IPeerStore {
  private readonly _connectionString: string;
  private readonly _logger: ILogger;
  private _client!: MongoClient;
  private _peerCollection!: Collection<IPeer>;
  private _packetCollection!: Collection<IPacketCorrelation>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._peerCollection || !this._packetCollection) {
      throw new Error('MongoClient not initialised');
    }
    return true;
  }

  async init(): Promise<void> {
    this._logger.info(`Initializing ${this.constructor.name}...`);
    try {
      this._client = new MongoClient(this._connectionString, {
        timeoutMS: TIMEOUT_MS
      });
      await this._client.connect();
      const db: Db = this._client.db(DB_NAME);

      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();

      const exists = (name: string): boolean =>
        collections.some((collection) => collection.name === name);

      this._peerCollection = exists(PEERS_COLLECTION_NAME)
        ? db.collection<IPeer>(PEERS_COLLECTION_NAME)
        : await db.createCollection<IPeer>(PEERS_COLLECTION_NAME);

      this._packetCollection = exists(PACKETS_COLLECTION_NAME)
        ? db.collection<IPacketCorrelation>(PACKETS_COLLECTION_NAME)
        : await db.createCollection<IPacketCorrelation>(
            PACKETS_COLLECTION_NAME
          );

      await this._peerCollection.createIndex({ peerId: 1 }, { unique: true });
      await this._packetCollection.createIndex(
        { packetId: 1 },
        { unique: true }
      );
      await this._packetCollection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: PACKET_RETENTION_SECONDS }
      );
    } catch (e: unknown) {
      if (e instanceof Error) {
        this._logger.error(e);
        throw e;
      }
      const error = new Error(
        "Unable to connect to the database: 'unknown error'"
      );
      this._logger.error(error);
      throw error;
    }

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    this._checkInitialisedOrThrow();
    await this._client.close();
  }

  async fetchById(peerId: string): Promise<IPeer | undefined> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._peerCollection.findOne({ peerId });
      return doc ? this._peerDocToPeer(doc) : undefined;
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to fetch peer ${peerId} - error: ${(e as Error).message}`
      );
    }
  }

  async fetchAll(): Promise<IPeer[]> {
    this._checkInitialisedOrThrow();

    try {
      const docs = await this._peerCollection.find({}).toArray();
      return docs.map((doc) => this._peerDocToPeer(doc));
    } catch (e) {
      this._logger.error(e);
      throw new Error(`Unable to fetch peers - error: ${(e as Error).message}`);
    }
  }

  async store(peer: IPeer): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._peerCollection.insertOne({ ...peer });
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store peer ${peer.peerId} - error: ${(e as Error).message}`
      );
    }
  }

  async update(peer: IPeer): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      const { peerId, ...rest } = peer;
      await this._peerCollection.updateOne(
        { peerId },
        { $set: rest },
        { upsert: true }
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to update peer ${peer.peerId} - error: ${(e as Error).message}`
      );
    }
  }

  async fetchPacketById(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._packetCollection.findOne({ packetId });
      return doc ?? undefined;
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to fetch packet ${packetId} - error: ${(e as Error).message}`
      );
    }
  }

  async storePacket(packet: IPacketCorrelation): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._packetCollection.insertOne({ ...packet });
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store packet ${packet.packetId} - error: ${(e as Error).message}`
      );
    }
  }

  async updatePacket(packet: IPacketCorrelation): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._packetCollection.replaceOne(
        { packetId: packet.packetId },
        packet,
        { upsert: true }
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to update packet ${packet.packetId} - error: ${(e as Error).message}`
      );
    }
  }

  private _peerDocToPeer(doc: IPeer & { _id?: unknown }): IPeer {
    return {
      peerId: doc.peerId,
      http: doc.http,
      isActive: doc.isActive,
      maxPacketAmount: doc.maxPacketAmount,
      packetCorrelations: doc.packetCorrelations
    };
  }
}
