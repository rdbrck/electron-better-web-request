import { Session } from 'electron';
import { IBetterWebRequest, WebRequestMethod, IFilter, IListener, IContext, IListenerCollection } from './types';
export declare class BetterWebRequest implements IBetterWebRequest {
    private webRequest;
    private orderIndex;
    private listeners;
    private filters;
    private resolvers;
    constructor(webRequest: any);
    private readonly nextIndex;
    getListeners(): Map<WebRequestMethod, Map<string, IListener>>;
    getListenersFor(method: WebRequestMethod): Map<string, IListener> | undefined;
    getFilters(): Map<WebRequestMethod, Set<string>>;
    getFiltersFor(method: WebRequestMethod): Set<string> | undefined;
    hasCallback(method: WebRequestMethod): boolean;
    alias(method: WebRequestMethod, parameters: any): void | {
        id: string;
        urls: string[];
        action: Function;
        context: {
            order: number;
            priority?: number | undefined;
            origin?: string | undefined;
        };
    };
    addListener(method: WebRequestMethod, filter: IFilter, action: Function, outerContext?: Partial<IContext>): {
        id: string;
        urls: string[];
        action: Function;
        context: {
            order: number;
            priority?: number | undefined;
            origin?: string | undefined;
        };
    };
    removeListener(method: WebRequestMethod, id: IListener['id']): void;
    clearListeners(method: WebRequestMethod): void;
    setResolver(method: WebRequestMethod, resolver: Function): void;
    matchListeners(url: string, listeners: IListenerCollection): IListener[];
    private listenerFactory;
    private processRequests;
    private makeApplier;
    private mergeFilters;
    private parseArguments;
    private identifyAction;
}
declare const _default: (session: Session) => BetterWebRequest;
export default _default;
