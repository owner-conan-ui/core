import * as React from "react";
import {ReactElement} from "react";
import {IFunction} from "../conan-utils/typesHelper";
import {Store} from "../conan-sm-sugar/store";


interface ConnectedState<ACTIONS, DATA> {
    actions: ACTIONS;
    data: DATA;
}

export class PropsInjector {
    static create<
        ACTIONS,
        DATA,
        INTO_PROPS
        >(
        name: string,
        store: Store<any>,
        ConnectInto: React.ComponentType<INTO_PROPS>,
        connector: IFunction<{ data: DATA, actions: ACTIONS }, INTO_PROPS>
    ): React.ComponentClass {
        class Connector extends React.Component<{}, ConnectedState<ACTIONS, DATA>> {
            private stateMachine = store.addListener([`::nextData->connect`, {
                onNextData: (actions) => this.setState({
                    actions,
                    data: actions.getStateData()
                })
            }]);

            componentDidMount(): void {
                this.stateMachine.start(name);
            }

            render(): ReactElement {
                if (this.state == null) return null;

                return <ConnectInto
                    {...connector({
                            data: this.state.data,
                            actions: this.state.actions
                        })}
                />;
            }
        }

        return Connector;
    }
}
