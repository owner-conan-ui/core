import {State} from "../core/state";
import {StateMachineCore} from "../core/stateMachineCore";

export interface SmTransition {
    transitionName: string;
    payload?: any;
    into: State;
}

export interface RawTransitionSmEvent {
    transitionName: string;
    payload?: any;
    fork?: StateMachineCore<any>;
}
export interface TransitionSmEvent {
    transitionName: string;
    payload?: any;
    fork?: SerializedSmEvent[];
}

export function isStageEvent (toCheck: RawTransitionSmEvent | State): toCheck is State {
    return "name" in toCheck;
}
export type SerializedSmEvent = State | TransitionSmEvent;