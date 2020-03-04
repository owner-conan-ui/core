import {EventThread} from "./eventThread";
import {EventType, StateMachineLogger} from "./stateMachineLogger";
import {Stage, StageDef} from "./stage";
import {IConsumer, IKeyValuePairs, WithMetadataArray} from "../conan-utils/typesHelper";
import {Strings} from "../conan-utils/strings";
import {StateMachineFactory} from "./stateMachineFactory";
import {
    ListenerType,
    SmEventCallback,
    SmEventCallbackParams,
    SmListener,
    SmListenerDefLike,
    SmListenerDefLikeParser,
    SmListenerDefList
} from "./stateMachineListeners";
import {SerializedSmEvent, SmTransition} from "./stateMachineEvents";
import {SmController, StateMachineData} from "./_domain";
import {TransactionTree} from "../conan-tx/transactionTree";
import {SmTransactions} from "./smTransactions";

export enum ToProcessType {
    ACTION = 'ACTION',
    STAGE = 'STAGE'
}

interface ActionToProcess extends BaseToProcess {
    type: ToProcessType.ACTION;
    actionName: string;
    payload?: any;
    into: Stage;
}

export interface StageToProcess extends BaseToProcess {
    type: ToProcessType.STAGE;
    stage: Stage;
}

interface BaseToProcess {
    eventType: EventType;
    type: ToProcessType;
    description: string;
}

export interface ParentStateMachineInfo<SM_LISTENER extends SmListener,
    JOIN_LISTENER extends SmListener,
    > {
    stateMachine: StateMachine<SM_LISTENER, JOIN_LISTENER, any>,
    joinsInto: string[]
}

export enum StateMachineStatus {
    PAUSED = 'PAUSED',
    STOPPED = 'STOPPED',
    IDLE = 'IDLE',
    RUNNING = 'RUNNING',
}

export class StateMachine<
    SM_ON_LISTENER extends SmListener,
    SM_IF_LISTENER extends SmListener,
    ACTIONS,
> implements SmController<SM_ON_LISTENER, SM_IF_LISTENER> {
    readonly smTransactions: SmTransactions = new SmTransactions ();
    readonly eventThread: EventThread = new EventThread();
    _status: StateMachineStatus = StateMachineStatus.IDLE;

    private closed: boolean = false;
    private readonly smListenerDefLikeParser: SmListenerDefLikeParser = new SmListenerDefLikeParser();
    readonly transactionTree: TransactionTree = new TransactionTree();

    constructor(
        readonly data: StateMachineData<SM_ON_LISTENER, SM_IF_LISTENER>,
    ) {
    }


    addListener(listener: SmListenerDefLike<SM_ON_LISTENER>, type: ListenerType = ListenerType.ALWAYS): this {
        this.assertNotClosed();
        let listenerDef = this.smListenerDefLikeParser.parse(listener);
        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.ADD_LISTENER, this.transactionTree.getCurrentTransactionId(), `(${listenerDef.metadata})[${type}]`);
        this.data.listeners.push(listenerDef);
        return this;
    }

    addInterceptor(interceptor: SmListenerDefLike<SM_IF_LISTENER>): this {
        let listenerDef = this.smListenerDefLikeParser.parse(interceptor);
        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.ADD_INTERCEPTOR, this.transactionTree.getCurrentTransactionId(), `(${listenerDef.metadata})`);
        this.data.interceptors.push(
            this.smListenerDefLikeParser.parse(interceptor)
        );
        return this;
    }

    stop(): this {
        this.assertNotClosed();
        this.requestTransition({
            into: {
                name: 'stop'
            },
            path: 'doStop',
        });
        return this;
    }

    requestStage(stageToProcess: StageToProcess): void {
        this.assertNotClosed();
        this._status = StateMachineStatus.RUNNING;
        let stageName = stageToProcess.stage.name;
        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.REQUEST, this.transactionTree.getCurrentTransactionId(), `::${stageName}`);

        if (this.data.stageDefsByKey [stageName] == null) {
            throw new Error(`can't move sm: [${this.data.name}] to ::${stageName} and is not a valid stage, ie one of: (${Object.keys(this.data.stageDefsByKey).join(', ')})`)
        }

        this.transactionTree.createOrForkTransaction(this.smTransactions.createStageTransactionRequest(this, stageToProcess));
    }

    requestTransition(transition: SmTransition): this {
        this.assertNotClosed();

        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.REQUEST, this.transactionTree.getCurrentTransactionId(), `=>${transition.path}`);
        let description = `=>${transition.path}`;
        let toProcess: ActionToProcess = {
            description,
            actionName: transition.path,
            into: transition.into,
            payload: transition.payload,
            eventType: EventType.ACTION,
            type: ToProcessType.ACTION,
        };
        let actions = this.createActions(this, this.data.stageDefsByKey, transition.into.name, transition.payload);
        let eventName = Strings.camelCaseWithPrefix('on', transition.path);
        this.transactionTree
            .createOrForkTransaction(this.smTransactions.createActionTransactionRequest(this, transition, actions, this.createReactions(eventName, this.data.listeners), ()=>{
                this.eventThread.addActionEvent(
                    transition
                );
                StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.ACTION, this.transactionTree.getCurrentTransactionId(), `=>${transition.path}`);
            }));
        return this;
    }

    createReactions(eventName: string, smListeners: SmListenerDefList<any>): WithMetadataArray<SmEventCallback<ACTIONS>, string> {
        if (smListeners == null || smListeners.length === 0) return [];

        let reactions: WithMetadataArray<SmEventCallback<ACTIONS>, string> = [];
        smListeners.forEach(smListener => {
            let actionListener: SmEventCallback<ACTIONS> = smListener.value[eventName];
            if (!actionListener) return undefined;

            reactions.push({
                value: (actions, params) => {
                    StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.REACTION, this.transactionTree.getCurrentTransactionId(), `(${smListener.metadata})`);
                    actionListener(actions, params)
                },
                metadata: smListener.metadata
            });
        });

        return reactions;

    }

    getStageDef(name: string): StageDef<any, any, any> {
        return this.data.stageDefsByKey [name];
    }

    getEvents(): SerializedSmEvent [] {
        return this.eventThread.serialize();
    }


    shutdown() {
        this.closed = true;
        this._status = StateMachineStatus.STOPPED;
        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.SHUTDOWN, `-`, '', []);
    }

    private assertNotClosed() {
        if (this.closed) {
            throw new Error(`can't perform any actions in a SM once the SM is closed`);
        }
    }

    fork(
        nextStage: Stage,
        defer: IConsumer<ACTIONS>,
        joinsInto: string []
    ): StateMachine<any, any, any> {
        this._status = StateMachineStatus.PAUSED;
        let forkSmName = `${this.data.name}/${nextStage.name}`;
        StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.FORK, this.transactionTree.getCurrentTransactionId(), `[FORK]::${forkSmName}`);
        let deferEventName = Strings.camelCaseWithPrefix('on', nextStage.name);
        let deferPathName = Strings.camelCaseWithPrefix('do', nextStage.name);
        return StateMachineFactory.fork({
            stateMachine: this,
            joinsInto
        }, {
            initialListener: {
                metadata: `::start=>${deferPathName}`,
                value: {
                    onStart: (_: any, params: SmEventCallbackParams) => params.sm.requestTransition({
                        path: deferPathName,
                        into: nextStage,
                    })
                }
            },
            name: forkSmName,
            stageDefs: [{
                name: nextStage.name,
                logic: this.data.stageDefsByKey[nextStage.name].logic
            }],
            listeners: [{
                metadata: `::${deferEventName}->[DEFERRED]`,
                value: {
                    [deferEventName]: (actions: any) => defer(actions)
                }
            }],
            interceptors: [],
            syncDefs: undefined,
        });
    }

    createActions(
        stateMachine: SmController<any, any>,
        actionsByStage: IKeyValuePairs<StageDef<string, any, any, any>>,
        stageName: string,
        stagePayload: any,
    ) {
        let stageDef: StageDef<string, any, any, any> = actionsByStage [stageName];
        if (!stageDef || !stageDef.logic) return {};

        let actionsLogic: any = new stageDef.logic(stagePayload);
        let proxy: any = {} as any;
        let prototype = Object.getPrototypeOf(actionsLogic);
        Object.getOwnPropertyNames(prototype).forEach(key => {
            if (key === 'constructor') return;
            let toProxy = (prototype as any)[key];
            if (typeof toProxy !== 'function') return;

            (proxy as any)[key] = (payload: any) => {
                let nextStage: Stage = (actionsLogic as any)[key](payload);
                let nextStageDef: StageDef<string, any, any, any> = actionsByStage [nextStage.name];
                if (nextStageDef == null) {
                    if (!this.data.parent) {
                        throw new Error(`trying to move to a non existent stage: ${nextStage.name}`);
                    }

                    nextStageDef = this.data.parent.stateMachine.getStageDef(nextStage.name);
                    if (!nextStageDef) {
                        throw new Error(`trying to move to a non existent stage from a forked stateMachine: ${nextStage.name}`);
                    }
                }


                StateMachineLogger.log(this.data.name, this._status, this.eventThread.getCurrentStageName(), this.eventThread.getCurrentActionName(), EventType.PROXY, this.transactionTree.getCurrentTransactionId(), `(${key})=>::${nextStage.name}`);
                stateMachine.requestTransition({
                    path: key,
                    payload: payload,
                    into: nextStage,
                });
            }
        });
        return proxy;
    }

    join(stageToProcess: StageToProcess): void {
        this._status = StateMachineStatus.RUNNING;
        let stageName = stageToProcess.stage.name;
        let stageDescriptor = `::${stageName}`;
        this.requestStage({
            type: ToProcessType.STAGE,
            eventType: EventType.FORK_JOIN,
            description: stageDescriptor,
            stage: stageToProcess.stage
        });
    }
}
