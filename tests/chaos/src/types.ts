export type ChaosActionType =
  | 'insert'
  | 'delete'
  | 'burst'
  | 'disconnect'
  | 'reconnect'
  | 'setLatency'
  | 'pauseInbound';

export interface BaseAction {
  type: ChaosActionType;
  step: number;
  clientId: number;
}

export interface InsertAction extends BaseAction {
  type: 'insert';
  tag: string;
  pos: number;
}

export interface DeleteAction extends BaseAction {
  type: 'delete';
  from: number;
  length: number;
  removedTags: string[];
}

export interface BurstAction extends BaseAction {
  type: 'burst';
  count: number;
  tags: string[];
}

export interface DisconnectAction extends BaseAction {
  type: 'disconnect';
}

export interface ReconnectAction extends BaseAction {
  type: 'reconnect';
}

export interface SetLatencyAction extends BaseAction {
  type: 'setLatency';
  latencyMs: number;
}

export interface PauseInboundAction extends BaseAction {
  type: 'pauseInbound';
  durationMs: number;
}

export type ChaosAction =
  | InsertAction
  | DeleteAction
  | BurstAction
  | DisconnectAction
  | ReconnectAction
  | SetLatencyAction
  | PauseInboundAction;

export interface ChaosRunOptions {
  seed?: number;
  numClients?: number;
  steps?: number;
  quiescenceMs?: number;
  verbose?: boolean;
}

export interface ChaosRunSummary {
  seed: number;
  stepsExecuted: number;
  activeTagsCount: number;
  deletedTagsCount: number;
  totalTagsInserted: number;
  convergedLength: number;
  clientsConverged: number;
  quiescenceDurationMs: number;
}
