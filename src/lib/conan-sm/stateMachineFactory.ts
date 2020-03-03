import {ParentStateMachineInfo, StateMachine, StateMachineStatus, ToProcessType} from "./stateMachine";
import {IKeyValuePairs} from "../conan-utils/typesHelper";
import {StageDef} from "./stage";
import {Objects} from "../conan-utils/objects";
import {EventType, StateMachineLogger} from "./stateMachineLogger";
import {SmListener, SmListenerDefLikeParser, SmListenerDefList} from "./stateMachineListeners";
import {StateMachineTreeBuilderData} from "./_domain";

export class StateMachineFactory {
    static create<
        SM_ON_LISTENER extends SmListener,
        SM_IF_LISTENER extends SmListener,
        ACTIONS
    >(request: StateMachineTreeBuilderData<SM_ON_LISTENER, SM_IF_LISTENER>): StateMachine<SM_ON_LISTENER, SM_IF_LISTENER, ACTIONS> {
        return this.doCreate(request);
    }


    static fork<
        SM_LISTENER extends SmListener,
        JOIN_LISTENER extends SmListener,
    >(
        parent: ParentStateMachineInfo<any, any>,
        request: StateMachineTreeBuilderData<SM_LISTENER, JOIN_LISTENER>
    ) {
        return this.doCreate(request, parent);
    }

    private static doCreate<
        SM_LISTENER extends SmListener,
        JOIN_LISTENER extends SmListener,
        ACTIONS
    >(
        treeBuilderData: StateMachineTreeBuilderData<SM_LISTENER, JOIN_LISTENER>,
        parent?: ParentStateMachineInfo<any, any>
    ): StateMachine<SM_LISTENER, JOIN_LISTENER, ACTIONS> {
        let stageDefsByKey: IKeyValuePairs<StageDef<string, any, any, any>> = Objects.keyfy(treeBuilderData.stageDefs, (it) => it.name);
        let systemListeners: SmListenerDefList<SM_LISTENER> = [];
        let externalListeners: SmListenerDefList<SM_LISTENER> = treeBuilderData.listeners;

        systemListeners.push(
            new SmListenerDefLikeParser().parse([
                '::init=>doStart', {
                    onInit: ()=>{
                        stateMachine.requestTransition({
                            path: `doStart`,
                            into: {
                                name: 'start'
                            }
                        })
                    }
                } as any as SM_LISTENER
            ])
        );

        systemListeners.push(
            new SmListenerDefLikeParser().parse(['::stop->shutdown', {
                onStop: () => {
                    StateMachineLogger.log(stateMachine.data.name, StateMachineStatus.RUNNING, stateMachine.eventThread.getCurrentStageName(), stateMachine.eventThread.getCurrentActionName(), EventType.SHUTDOWN, `-`, '', []);
                    stateMachine.shutdown();
                }
            } as any as SM_LISTENER])
        );


        let stateMachine: StateMachine<SM_LISTENER, JOIN_LISTENER, ACTIONS> = new StateMachine({
            ...treeBuilderData,
            listeners: [...treeBuilderData.listeners, ...systemListeners],
            stageDefsByKey,
            parent,
        });

        let stageStringDefs: string [] = [];
        Object.keys(stateMachine.data.stageDefsByKey).forEach(key => {
            let stageDef = stateMachine.data.stageDefsByKey[key];
            let description = `${stageDef.name}`;
            if (stageDef.deferredInfo) {
                description += `[DEFERRED]`;
            }
            stageStringDefs.push(description)
        });


        StateMachineLogger.log(treeBuilderData.name, StateMachineStatus.IDLE, '', '', EventType.INIT, '', 'starting SM', [
            [`listeners`, `${externalListeners.map(it=>it.metadata).map(it => {
                return it.split(',').map(it=>`(${it})`).join(',');
            })}`],
            [`system listeners`, `${systemListeners.map(it=>it.metadata).map(it => {
                return it.split(',').map(it=>`(${it})`).join(',');
            })}`],
            [`interceptors`, `${treeBuilderData.interceptors.map(it => it.metadata)}`],
            [`stage defs`, `${stageStringDefs.join(', ')}`],
        ]);


        stateMachine.requestStage ({
            description: '::init',
            eventType: EventType.INIT,
            stage: {
                name: 'init'
            },
            type: ToProcessType.STAGE
        });


        return stateMachine;

    }

}
