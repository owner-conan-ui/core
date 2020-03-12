import {StateMachine} from "../conan-sm/stateMachine";
import {OnEventCallback, SmListener} from "../conan-sm/stateMachineListeners";
import {IFunction} from "../conan-utils/typesHelper";
import {Stage} from "../conan-sm/stage";
import {Proxyfier} from "../conan-utils/proxyfier";

export type Store<ACTIONS> = StateMachine<NextDataListener<ACTIONS>>;

export interface NextDataListener<ACTIONS> extends SmListener<ACTIONS> {
    onNextData?: OnEventCallback<ACTIONS>;
}

export interface NextData<DATA> extends Stage <'nextData', DATA> {}

export class StoreFactory {
    static create <DATA, ACTIONS> (initialData: DATA, actionsProducer: IFunction<DATA, ACTIONS>):  Store<ACTIONS>{
        return new StateMachine<NextDataListener<ACTIONS>>()
            .withInitialState('nextData', initialData)
            .withState<ACTIONS, DATA>('nextData', (prevState)=>{
                let nextData: ACTIONS = actionsProducer (prevState);
                return Proxyfier.proxy(nextData, (raw):NextData<DATA>=>{
                    let rawData: DATA = raw();
                    return {
                        nextState: "nextData",
                        data: rawData
                    };
                });
            })
    }
}
