declare type WebRequestWithCallback = 'onBeforeRequest' | 'onBeforeSendHeaders' | 'onHeadersReceived';
declare type WebRequestWithoutCallback = 'onSendHeaders' | 'onResponseStarted' | 'onBeforeRedirect' | 'onCompleted' | 'onErrorOccurred';
export declare type WebRequestMethod = WebRequestWithCallback | WebRequestWithoutCallback;
export declare type URLPattern = string;
export interface IFilter {
    urls: string[];
}
export interface IListener {
    id: string;
    urls: string[];
    action: Function;
    context: IContext;
}
export interface IContext {
    priority?: number;
    origin?: string;
    order: number;
}
export interface IApplier {
    apply: Function;
    context: IContext;
}
export interface IAliasParameters {
    unbind: boolean;
    filter: IFilter;
    action: Function | null;
    context: Object;
}
export declare type IListenerCollection = Map<IListener['id'], IListener>;
export interface IBetterWebRequest {
    addListener(method: WebRequestMethod, filter: IFilter, action: Function, context: Partial<IContext>): IListener;
    removeListener(method: WebRequestMethod, id: IListener['id']): void;
    clearListeners(method: WebRequestMethod): void;
    setResolver(requestMethod: WebRequestMethod, resolver: Function): void;
    matchListeners(url: string, listeners: IListenerCollection): IListener[];
    getListeners(): Map<WebRequestMethod, IListenerCollection>;
    getListenersFor(method: WebRequestMethod): IListenerCollection | undefined;
    getFilters(): Map<WebRequestMethod, Set<URLPattern>>;
    getFiltersFor(method: WebRequestMethod): Set<URLPattern> | undefined;
    hasCallback(method: WebRequestMethod): Boolean;
}
export {};
