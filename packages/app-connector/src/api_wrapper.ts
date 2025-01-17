import type {
  ParcnetIdentityRPC,
  ParcnetRPC,
  ProveResult
} from "@parcnet-js/client-rpc";
import type * as p from "@parcnet-js/podspec";
import type { GPCBoundConfig, GPCProof, GPCRevealedClaims } from "@pcd/gpc";
import type { PODEntries } from "@pcd/pod";
import { POD } from "@pcd/pod";
import { EventEmitter } from "eventemitter3";
import type { ParcnetRPCConnector } from "./rpc_client.js";

/**
 * A Subscription object is returned to the caller when a subscription is
 * created. It allows the caller to attach event listeners to the subscription
 * to get updates when the PODs change.
 *
 * It also allows the caller to run the query immediately, which is useful on
 * first creating the subscription, before any updates are available.
 */
export class Subscription<E extends p.EntriesSchema> {
  #emitter: EventEmitter;
  #query: p.PodSpec<E>;
  #api: ParcnetPODWrapper;

  constructor(
    query: p.PodSpec<E>,
    emitter: EventEmitter,
    api: ParcnetPODWrapper
  ) {
    this.#emitter = emitter;
    this.#query = query;
    this.#api = api;
  }

  async query(): Promise<POD[]> {
    return this.#api.query(this.#query);
  }

  on(event: "update", callback: (result: POD[]) => void): void {
    this.#emitter.on(event, callback);
  }

  off(event: "update", callback: (result: POD[]) => void): void {
    this.#emitter.off(event, callback);
  }
}

export class ParcnetPODWrapper {
  #api: ParcnetRPCConnector;
  #subscriptionEmitters: Map<string, EventEmitter>;

  constructor(api: ParcnetRPCConnector) {
    this.#api = api;
    this.#subscriptionEmitters = new Map();
    this.#api.on("subscription-update", (result) => {
      const emitter = this.#subscriptionEmitters.get(result.subscriptionId);
      if (emitter) {
        emitter.emit(
          "update",
          result.update.map((pod) => POD.deserialize(pod))
        );
      }
    });
  }

  async query<E extends p.EntriesSchema>(query: p.PodSpec<E>): Promise<POD[]> {
    const pods = await this.#api.pod.query(query.schema);
    return pods.map((pod) => POD.deserialize(pod));
  }

  async subscribe<E extends p.EntriesSchema>(
    query: p.PodSpec<E>
  ): Promise<Subscription<E>> {
    const subscriptionId = await this.#api.pod.subscribe(query.schema);
    const emitter = new EventEmitter();
    const subscription = new Subscription(query, emitter, this);
    this.#subscriptionEmitters.set(subscriptionId, emitter);
    return subscription;
  }

  async insert(pod: POD): Promise<void> {
    const serialized = pod.serialize();
    return this.#api.pod.insert(serialized);
  }

  async delete(signature: string): Promise<void> {
    return this.#api.pod.delete(signature);
  }

  async sign(entries: PODEntries): Promise<POD> {
    const pod = await this.#api.pod.sign(entries);
    return POD.deserialize(pod);
  }
}

/**
 * Wraps the Parcnet RPC API to provide a more user-friendly interface.
 */
export class ParcnetGPCWrapper {
  #api: ParcnetRPC;

  constructor(api: ParcnetRPC) {
    this.#api = api;
  }

  // In a world with POD2, we would use new POD2 types rather than GPCPCD.
  // The existing args system and GPC wrapper works well, so we can use that.
  async prove(args: p.PodspecProofRequest): Promise<ProveResult> {
    const result = await this.#api.gpc.prove(args);
    return result;
  }

  async verify(
    proof: GPCProof,
    config: GPCBoundConfig,
    revealedClaims: GPCRevealedClaims,
    proofRequest: p.PodspecProofRequest
  ): Promise<boolean> {
    return this.#api.gpc.verify(proof, config, revealedClaims, proofRequest);
  }
}

/**
 * Wraps the Parcnet RPC API to provide a more user-friendly interface.
 * Specifically, this handles serialization and deserialization of PODs and
 * query data.
 */
export class ParcnetAPI {
  public pod: ParcnetPODWrapper;
  public identity: ParcnetIdentityRPC;
  public gpc: ParcnetGPCWrapper;

  constructor(api: ParcnetRPCConnector) {
    this.pod = new ParcnetPODWrapper(api);
    this.identity = api.identity;
    this.gpc = new ParcnetGPCWrapper(api);
  }
}
