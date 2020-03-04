import {ICallback, IProducer, WithMetadata, WithMetadataArray} from "../conan-utils/typesHelper";
import {SmEventCallback} from "../conan-sm/stateMachineListeners";
import {Strings} from "../conan-utils/strings";

export interface TransactionRequest {
    name: string;
    onStart?: WithMetadata<ICallback, string>;
    reactionsProducer: IProducer<WithMetadataArray<ICallback, string>>;
    doChain?: WithMetadata<IProducer<TransactionRequest>, string>;
    onDone?: WithMetadata<ICallback, string>;
}

export enum TransactionStatus {
    CHAINING = 'CHAINING',
    IDLE = 'IDLE',
    STARTING = 'STARTING',
    RUNNING = 'RUNNING',
    POST_RUNNING = 'POST_RUNNING',
    CLOSING = 'CLOSING',
    CLOSED = 'CLOSED',
}

export class TransactionError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class Transaction {
    private _forkedTransitions: Transaction[] = [];
    private _chainedTransition: Transaction;
    private _delegatedTransition: Transaction = undefined;

    constructor(
        private readonly request: TransactionRequest,
        public readonly parent?: Transaction
    ) {
    }

    private _status = TransactionStatus.IDLE;

    get status(): TransactionStatus {
        return this._status;
    }

    getId(): string {
        let current: Transaction = this;
        let all: Transaction[] = [];
        while (current) {
            all.push(current);
            current = current.parent;
        }
        return all.reverse().map(it => it.getThisName()).join('');
    }

    getThisName(): string {
        return '/' + this.request.name;
    }

    close(): void {
        this.assertNotClosed();
        this._status = TransactionStatus.CLOSED;
        this._delegatedTransition = null;
    }

    fork(forkRequest: TransactionRequest) {
        this.assertAcceptingFork(forkRequest.name);

        let smTransaction = new Transaction(forkRequest, this);
        this._forkedTransitions.push(smTransaction);
        return smTransaction;
    }

    run() {
        if (this.parent) {
            throw new Error(`can't only start a root transaction`)
        }

        this.doRun();
    }

    public getCurrentRunningTransaction(): Transaction {
        if (this._status === TransactionStatus.CLOSED) return null;

        let current: Transaction = this;
        let next: Transaction = this._delegatedTransition;
        while (next) {
            current = next;
            next = next._delegatedTransition;
        }
        return current;
    }

    private doChain(nextRequest: TransactionRequest) {
        let smTransaction = new Transaction({...nextRequest, name: '/' + nextRequest.name}, this);
        this._chainedTransition = smTransaction;
        this._delegatedTransition = this._chainedTransition;
        smTransaction.doRun();
    }

    private assertAcceptingFork(forkId: string): void {
        if (this._status !== TransactionStatus.IDLE && this._status !== TransactionStatus.RUNNING) {
            throw new Error(`ERROR FORKING ${this.request.name}/${forkId} this operation can only be performed when transaction is IDLE or RUNNING, currently the status of ${this.request.name} is ${this._status}`);
        }
    }

    private assertIdle(): void {
        if (this._status !== TransactionStatus.IDLE) {
            throw new Error(`this operation can only be performed when transaction is IDLE, currently the status is ${this._status}`);
        }
    }

    private assertNotClosed(): void {
        if (this._status === TransactionStatus.CLOSED) {
            throw new Error(`can't perform this operation on a transaction that has been already closed`);
        }
    }

    private doRun() {
        let processedReactions: WithMetadataArray<SmEventCallback<any>, string> = [];
        let currentReaction: WithMetadata<SmEventCallback<any>, string> = null;
        try {
            this.assertIdle();

            if (this.request.onStart) {
                this._status = TransactionStatus.STARTING;
                this.request.onStart.value();
            }
            this._status = TransactionStatus.RUNNING;

            let reactions = this.request.reactionsProducer();
            reactions.forEach(reaction => {
                currentReaction = reaction;
                reaction.value();
                processedReactions.push(reaction);
            });
            currentReaction = undefined;


            let chainRequest = undefined;
            if (this.request.doChain) {
                this._status = TransactionStatus.POST_RUNNING;
                chainRequest = this.request.doChain.value();
                if (chainRequest == null) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error(`Error chaining, no chain provided on ${this.request.doChain.metadata} if you want to just have a callback at the end of the transaction, use onDone instead`);
                }
            }


            this._status = TransactionStatus.CLOSING;


            this._forkedTransitions.forEach(it => {
                this._delegatedTransition = it;
                it.doRun();
            });


            this._status = TransactionStatus.CHAINING;

            if (chainRequest) {
                this.doChain(chainRequest)
            }

            if (this.request.onDone) {
                this.request.onDone.value();
            }
            this.close();
        } catch (e) {
            if (e instanceof TransactionError) throw e;


            let pointer: Transaction = this;
            console.error('Error processing transaction');
            console.error(e.message);
            console.error('--------');
            while (pointer) {
                console.error(`${Strings.padEnd(pointer._status, 12)} ${pointer.getId()}`);

                if (pointer._status === TransactionStatus.POST_RUNNING) {
                    console.error(`         ERROR ON THE POST RUNNING (onDone - ${pointer.request.doChain.metadata})`);
                }
                if (pointer._status === TransactionStatus.CLOSING) {
                    console.error(`         ERROR PROCESSING CHILD FORKED TRANSACTIONS`);
                }
                if (currentReaction && this === pointer) {
                    console.error(`         CURRENT REACTION KO: ${currentReaction.metadata}`);
                }

                console.error(`         REACTIONS PROCESSED OK [${processedReactions.length}] ${processedReactions.map(it => it.metadata).join(',')}`);

                pointer = pointer.parent;
            }
            console.error('--------');

            console.error('ORIGINAL STACK TRACE');
            console.error(e.stack);

            throw new TransactionError(e.message);
        }
    }
}
