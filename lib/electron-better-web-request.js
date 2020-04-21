"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const v4_1 = tslib_1.__importDefault(require("uuid/v4"));
const url_match_patterns_1 = tslib_1.__importDefault(require("./url-match-patterns"));
const defaultResolver = (listeners) => {
    const sorted = listeners.sort((a, b) => b.context.order - a.context.order);
    const last = sorted[0];
    return last.apply();
};
const methodsWithCallback = [
    'onBeforeRequest',
    'onBeforeSendHeaders',
    'onHeadersReceived',
];
const aliasMethods = [
    'onBeforeRequest',
    'onBeforeSendHeaders',
    'onHeadersReceived',
    'onSendHeaders',
    'onResponseStarted',
    'onBeforeRedirect',
    'onCompleted',
    'onErrorOccurred',
];
class BetterWebRequest {
    constructor(webRequest) {
        this.orderIndex = 0;
        this.webRequest = webRequest;
        this.listeners = new Map();
        this.filters = new Map();
        this.resolvers = new Map();
    }
    get nextIndex() {
        return this.orderIndex += 1;
    }
    getListeners() {
        return this.listeners;
    }
    getListenersFor(method) {
        return this.listeners.get(method);
    }
    getFilters() {
        return this.filters;
    }
    getFiltersFor(method) {
        return this.filters.get(method);
    }
    hasCallback(method) {
        return methodsWithCallback.includes(method);
    }
    // Handling alias for drop in replacement
    alias(method, parameters) {
        const args = this.parseArguments(parameters);
        return this.identifyAction(method, args);
    }
    addListener(method, filter, action, outerContext = {}) {
        const { urls } = filter;
        const id = v4_1.default();
        const innerContext = { order: this.nextIndex };
        const context = Object.assign({}, outerContext, innerContext);
        const listener = {
            id,
            urls,
            action,
            context,
        };
        // Add listener to method map
        if (!this.listeners.has(method)) {
            this.listeners.set(method, new Map());
        }
        this.listeners.get(method).set(id, listener);
        // Add filters to the method map
        if (!this.filters.has(method)) {
            this.filters.set(method, new Set());
        }
        const currentFilters = this.filters.get(method);
        for (const url of urls) {
            currentFilters.add(url);
        }
        // Remake the new hook
        this.webRequest[method]({ urls: [...currentFilters] }, this.listenerFactory(method));
        return listener;
    }
    removeListener(method, id) {
        const listeners = this.listeners.get(method);
        if (!listeners || !listeners.has(id)) {
            return;
        }
        if (listeners.size === 1) {
            this.clearListeners(method);
        }
        else {
            listeners.delete(id);
            const newFilters = this.mergeFilters(listeners);
            this.filters.set(method, newFilters);
            // Rebind the new hook
            this.webRequest[method]([...newFilters], this.listenerFactory(method));
        }
    }
    clearListeners(method) {
        const listeners = this.listeners.get(method);
        const filters = this.filters.get(method);
        if (listeners)
            listeners.clear();
        if (filters)
            filters.clear();
        this.webRequest[method](null);
    }
    setResolver(method, resolver) {
        if (!this.hasCallback(method)) {
            console.warn(`Event method "${method}" has no callback and does not use a resolver`);
            return;
        }
        if (this.resolvers.has(method)) {
            console.warn(`Overriding resolver on "${method}" method event`);
        }
        this.resolvers.set(method, resolver);
    }
    // Find a subset of listeners that match a given url
    matchListeners(url, listeners) {
        const arrayListeners = Array.from(listeners.values());
        return arrayListeners.filter(element => element.urls.some(value => url_match_patterns_1.default(value, url)));
    }
    // Workflow triggered when a web request arrive
    // Use the original listener signature needed by electron.webrequest.onXXXX()
    listenerFactory(method) {
        return (details, callback) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.listeners.has(method)) {
                this.webRequest[method](null);
                return;
            }
            const listeners = this.listeners.get(method);
            if (!listeners) {
                if (callback)
                    callback(Object.assign({}, details, { cancel: false }));
                return;
            }
            const matchedListeners = this.matchListeners(details.url, listeners);
            if (matchedListeners.length === 0) {
                if (callback)
                    callback(Object.assign({}, details, { cancel: false }));
                return;
            }
            let resolve = this.resolvers.get(method);
            if (!resolve) {
                resolve = defaultResolver;
            }
            const requestsProcesses = this.processRequests(details, matchedListeners);
            if (this.hasCallback(method) && callback) {
                const modified = yield resolve(requestsProcesses);
                callback(modified);
            }
            else {
                requestsProcesses.map(listener => listener.apply());
            }
        });
    }
    // Create all the executions of listeners on the web request (independently)
    // Wrap them so they can be triggered only when needed
    processRequests(details, requestListeners) {
        const appliers = [];
        for (const listener of requestListeners) {
            const apply = this.makeApplier(details, listener.action);
            appliers.push({
                apply,
                context: listener.context,
            });
        }
        return appliers;
    }
    // Factory : make a function that will return a Promise wrapping the execution of the listener
    // Allow to trigger the application only when needed + promisify the execution of this listener
    makeApplier(details, listener) {
        return () => new Promise((resolve, reject) => {
            try {
                listener(details, resolve);
            }
            catch (err) {
                reject(err);
            }
        });
    }
    mergeFilters(listeners) {
        const arrayListeners = Array.from(listeners.values());
        return arrayListeners.reduce((accumulator, value) => {
            for (const url of value.urls)
                accumulator.add(url);
            return accumulator;
        }, new Set());
    }
    parseArguments(parameters) {
        const args = {
            unbind: false,
            filter: { urls: ['<all_urls>'] },
            action: null,
            context: {},
        };
        switch (parameters.length) {
            case 0:
                args.unbind = true;
                break;
            case 1:
                if (typeof parameters[0] === 'function') {
                    args.action = parameters[0];
                    break;
                }
                throw new Error('Wrong function signature : No function listener given');
            case 2:
                if (typeof parameters[0] === 'object' && typeof parameters[1] === 'function') {
                    args.filter = parameters[0];
                    args.action = parameters[1];
                    break;
                }
                if (typeof parameters[0] === 'function') {
                    args.action = parameters[0];
                    args.context = parameters[1];
                    break;
                }
                throw new Error('Wrong function signature : argument 1 should be an object filters or the function listener');
            case 3:
                if (typeof parameters[0] === 'object' && typeof parameters[1] === 'function') {
                    args.filter = parameters[0];
                    args.action = parameters[1];
                    args.context = parameters[2];
                    break;
                }
                throw new Error('Wrong function signature : should be arg 1 -> filter object, arg 2 -> function listener, arg 3 -> context');
            default:
                throw new Error('Wrong function signature : Too many arguments');
        }
        return args;
    }
    identifyAction(method, args) {
        const { unbind, filter, action, context } = args;
        if (unbind) {
            return this.clearListeners(method);
        }
        if (!action) {
            throw new Error(`Cannot bind with ${method} : a listener is missing.`);
        }
        return this.addListener(method, filter, action, context);
    }
}
exports.BetterWebRequest = BetterWebRequest;
// Proxy handler that add support for all alias methods by redirecting to BetterWebRequest.alias()
const aliasHandler = {
    get: (target, property) => {
        if (aliasMethods.includes(property)) {
            return (...parameters) => {
                target.alias(property, parameters);
            };
        }
        return target[property];
    },
};
exports.default = (session) => {
    return new Proxy(new BetterWebRequest(session.webRequest), aliasHandler);
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxlY3Ryb24tYmV0dGVyLXdlYi1yZXF1ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2VsZWN0cm9uLWJldHRlci13ZWItcmVxdWVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx5REFBMkI7QUFFM0Isc0ZBQXlDO0FBYXpDLE1BQU0sZUFBZSxHQUFHLENBQUMsU0FBcUIsRUFBRSxFQUFFO0lBQ2hELE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNFLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN2QixPQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUN0QixDQUFDLENBQUM7QUFFRixNQUFNLG1CQUFtQixHQUFHO0lBQzFCLGlCQUFpQjtJQUNqQixxQkFBcUI7SUFDckIsbUJBQW1CO0NBQ3BCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRztJQUNuQixpQkFBaUI7SUFDakIscUJBQXFCO0lBQ3JCLG1CQUFtQjtJQUNuQixlQUFlO0lBQ2YsbUJBQW1CO0lBQ25CLGtCQUFrQjtJQUNsQixhQUFhO0lBQ2IsaUJBQWlCO0NBQ2xCLENBQUM7QUFFRixNQUFhLGdCQUFnQjtJQVEzQixZQUFZLFVBQWU7UUFDekIsSUFBSSxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUM7UUFDcEIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFDN0IsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7SUFD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ZWN0cm9uJztcbmltcG9ydCB1dWlkIGZyb20gJ3V1aWQvdjQnO1xuXG5pbXBvcnQgbWF0Y2ggZnJvbSAnLi91cmwtbWF0Y2gtcGF0dGVybnMnO1xuaW1wb3J0IHtcbiAgSUJldHRlcldlYlJlcXVlc3QsXG4gIFdlYlJlcXVlc3RNZXRob2QsXG4gIFVSTFBhdHRlcm4sXG4gIElGaWx0ZXIsXG4gIElMaXN0ZW5lcixcbiAgSUNvbnRleHQsXG4gIElBcHBsaWVyLFxuICBJTGlzdGVuZXJDb2xsZWN0aW9uLFxuICBJQWxpYXNQYXJhbWV0ZXJzLFxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgZGVmYXVsdFJlc29sdmVyID0gKGxpc3RlbmVyczogSUFwcGxpZXJbXSkgPT4ge1xuICBjb25zdCBzb3J0ZWQgPSBsaXN0ZW5lcnMuc29ydCgoYSwgYikgPT4gYi5jb250ZXh0Lm9yZGVyIC0gYS5jb250ZXh0Lm9yZGVyKTtcbiAgY29uc3QgbGFzdCA9IHNvcnRlZFswXTtcbiAgcmV0dXJuIGxhc3QuYXBwbHkoKTtcbn07XG5cbmNvbnN0IG1ldGhvZHNXaXRoQ2FsbGJhY2sgPSBbXG4gICdvbkJlZm9yZVJlcXVlc3QnLFxuICAnb25CZWZvcmVTZW5kSGVhZGVycycsXG4gICdvbkhlYWRlcnNSZWNlaXZlZCcsXG5dO1xuXG5jb25zdCBhbGlhc01ldGhvZHMgPSBbXG4gICdvbkJlZm9yZVJlcXVlc3QnLFxuICAnb25CZWZvcmVTZW5kSGVhZGVycycsXG4gICdvbkhlYWRlcnNSZWNlaXZlZCcsXG4gICdvblNlbmRIZWFkZXJzJyxcbiAgJ29uUmVzcG9uc2VTdGFydGVkJyxcbiAgJ29uQmVmb3JlUmVkaXJlY3QnLFxuICAnb25Db21wbGV0ZWQnLFxuICAnb25FcnJvck9jY3VycmVkJyxcbl07XG5cbmV4cG9ydCBjbGFzcyBCZXR0ZXJXZWJSZXF1ZXN0IGltcGxlbWVudHMgSUJldHRlcldlYlJlcXVlc3Qge1xuICBwcml2YXRlIHdlYlJlcXVlc3Q6IGFueTtcblxuICBwcml2YXRlIG9yZGVySW5kZXg6IG51bWJlcjtcbiAgcHJpdmF0ZSBsaXN0ZW5lcnM6IE1hcDxXZWJSZXF1ZXN0TWV0aG9kLCBJTGlzdGVuZXJDb2xsZWN0aW9uPjtcbiAgcHJpdmF0ZSBmaWx0ZXJzOiBNYXA8V2ViUmVxdWVzdE1ldGhvZCwgU2V0PFVSTFBhdHRlcm4+PjtcbiAgcHJpdmF0ZSByZXNvbHZlcnM6IE1hcDxXZWJSZXF1ZXN0TWV0aG9kLCBGdW5jdGlvbj47XG5cbiAgY29uc3RydWN0b3Iod2ViUmVxdWVzdDogYW55KSB7XG4gICAgdGhpcy5vcmRlckluZGV4ID0gMDtcbiAgICB0aGlzLndlYlJlcXVlc3QgPSB3ZWJSZXF1ZXN0O1xuICAgIHRoaXMubGlzdGVuZXJzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuZmlsdGVycyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLnJlc29sdmVycyA9IG5ldyBNYXAoKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IG5leHRJbmRleCgpIHtcbiAgICByZXR1cm4gdGhpcy5vcmRlckluZGV4ICs9IDE7XG4gIH1cblxuICBnZXRMaXN0ZW5lcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMubGlzdGVuZXJzO1xuICB9XG5cbiAgZ2V0TGlzdGVuZXJzRm9yKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCkge1xuICAgIHJldHVybiB0aGlzLmxpc3RlbmVycy5nZXQobWV0aG9kKTtcbiAgfVxuXG4gIGdldEZpbHRlcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsdGVycztcbiAgfVxuXG4gIGdldEZpbHRlcnNGb3IobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kKSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsdGVycy5nZXQobWV0aG9kKTtcbiAgfVxuXG4gIGhhc0NhbGxiYWNrKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBtZXRob2RzV2l0aENhbGxiYWNrLmluY2x1ZGVzKG1ldGhvZCk7XG4gIH1cblxuICAvLyBIYW5kbGluZyBhbGlhcyBmb3IgZHJvcCBpbiByZXBsYWNlbWVudFxuICBhbGlhcyhtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QsIHBhcmFtZXRlcnM6IGFueSkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLnBhcnNlQXJndW1lbnRzKHBhcmFtZXRlcnMpO1xuICAgIHJldHVybiB0aGlzLmlkZW50aWZ5QWN0aW9uKG1ldGhvZCwgYXJncyk7XG4gIH1cblxuICBhZGRMaXN0ZW5lcihtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QsIGZpbHRlcjogSUZpbHRlciwgYWN0aW9uOiBGdW5jdGlvbiwgb3V0ZXJDb250ZXh0OiBQYXJ0aWFsPElDb250ZXh0PiA9IHt9KSB7XG4gICAgY29uc3QgeyB1cmxzIH0gPSBmaWx0ZXI7XG4gICAgY29uc3QgaWQgPSB1dWlkKCk7XG4gICAgY29uc3QgaW5uZXJDb250ZXh0ID0geyBvcmRlcjogdGhpcy5uZXh0SW5kZXggfTtcbiAgICBjb25zdCBjb250ZXh0ID0geyAuLi5vdXRlckNvbnRleHQsIC4uLmlubmVyQ29udGV4dCB9O1xuICAgIGNvbnN0IGxpc3RlbmVyID0ge1xuICAgICAgaWQsXG4gICAgICB1cmxzLFxuICAgICAgYWN0aW9uLFxuICAgICAgY29udGV4dCxcbiAgICB9O1xuXG4gICAgLy8gQWRkIGxpc3RlbmVyIHRvIG1ldGhvZCBtYXBcbiAgICBpZiAoIXRoaXMubGlzdGVuZXJzLmhhcyhtZXRob2QpKSB7XG4gICAgICB0aGlzLmxpc3RlbmVycy5zZXQobWV0aG9kLCBuZXcgTWFwKCkpO1xuICAgIH1cblxuICAgIHRoaXMubGlzdGVuZXJzLmdldChtZXRob2QpIS5zZXQoaWQsIGxpc3RlbmVyKTtcblxuICAgIC8vIEFkZCBmaWx0ZXJzIHRvIHRoZSBtZXRob2QgbWFwXG4gICAgaWYgKCF0aGlzLmZpbHRlcnMuaGFzKG1ldGhvZCkpIHtcbiAgICAgIHRoaXMuZmlsdGVycy5zZXQobWV0aG9kLCBuZXcgU2V0KCkpO1xuICAgIH1cblxuICAgIGNvbnN0IGN1cnJlbnRGaWx0ZXJzID0gdGhpcy5maWx0ZXJzLmdldChtZXRob2QpITtcbiAgICBmb3IgKGNvbnN0IHVybCBvZiB1cmxzKSB7XG4gICAgICBjdXJyZW50RmlsdGVycy5hZGQodXJsKTtcbiAgICB9XG5cbiAgICAvLyBSZW1ha2UgdGhlIG5ldyBob29rXG4gICAgdGhpcy53ZWJSZXF1ZXN0W21ldGhvZF0oeyB1cmxzOiBbLi4uY3VycmVudEZpbHRlcnNdIH0sIHRoaXMubGlzdGVuZXJGYWN0b3J5KG1ldGhvZCkpO1xuXG4gICAgcmV0dXJuIGxpc3RlbmVyO1xuICB9XG5cbiAgcmVtb3ZlTGlzdGVuZXIobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kLCBpZDogSUxpc3RlbmVyWydpZCddKSB7XG4gICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5saXN0ZW5lcnMuZ2V0KG1ldGhvZCk7XG5cbiAgICBpZiAoIWxpc3RlbmVycyB8fCAhbGlzdGVuZXJzLmhhcyhpZCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGlzdGVuZXJzLnNpemUgPT09IDEpIHtcbiAgICAgIHRoaXMuY2xlYXJMaXN0ZW5lcnMobWV0aG9kKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdGVuZXJzLmRlbGV0ZShpZCk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbHRlcnMgPSB0aGlzLm1lcmdlRmlsdGVycyhsaXN0ZW5lcnMpO1xuICAgICAgdGhpcy5maWx0ZXJzLnNldChtZXRob2QsIG5ld0ZpbHRlcnMpO1xuXG4gICAgICAvLyBSZWJpbmQgdGhlIG5ldyBob29rXG4gICAgICB0aGlzLndlYlJlcXVlc3RbbWV0aG9kXShbLi4ubmV3RmlsdGVyc10sIHRoaXMubGlzdGVuZXJGYWN0b3J5KG1ldGhvZCkpO1xuICAgIH1cbiAgfVxuXG4gIGNsZWFyTGlzdGVuZXJzKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCkge1xuICAgIGNvbnN0IGxpc3RlbmVycyA9IHRoaXMubGlzdGVuZXJzLmdldChtZXRob2QpO1xuICAgIGNvbnN0IGZpbHRlcnMgPSB0aGlzLmZpbHRlcnMuZ2V0KG1ldGhvZCk7XG5cbiAgICBpZiAobGlzdGVuZXJzKSBsaXN0ZW5lcnMuY2xlYXIoKTtcbiAgICBpZiAoZmlsdGVycykgZmlsdGVycy5jbGVhcigpO1xuXG4gICAgdGhpcy53ZWJSZXF1ZXN0W21ldGhvZF0obnVsbCk7XG4gIH1cblxuICBzZXRSZXNvbHZlcihtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QsIHJlc29sdmVyOiBGdW5jdGlvbikge1xuICAgIGlmICghdGhpcy5oYXNDYWxsYmFjayhtZXRob2QpKSB7XG4gICAgICBjb25zb2xlLndhcm4oYEV2ZW50IG1ldGhvZCBcIiR7bWV0aG9kfVwiIGhhcyBubyBjYWxsYmFjayBhbmQgZG9lcyBub3QgdXNlIGEgcmVzb2x2ZXJgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5yZXNvbHZlcnMuaGFzKG1ldGhvZCkpIHtcbiAgICAgIGNvbnNvbGUud2FybihgT3ZlcnJpZGluZyByZXNvbHZlciBvbiBcIiR7bWV0aG9kfVwiIG1ldGhvZCBldmVudGApO1xuICAgIH1cblxuICAgIHRoaXMucmVzb2x2ZXJzLnNldChtZXRob2QsIHJlc29sdmVyKTtcbiAgfVxuXG4gIC8vIEZpbmQgYSBzdWJzZXQgb2YgbGlzdGVuZXJzIHRoYXQgbWF0Y2ggYSBnaXZlbiB1cmxcbiAgbWF0Y2hMaXN0ZW5lcnModXJsOiBzdHJpbmcsIGxpc3RlbmVyczogSUxpc3RlbmVyQ29sbGVjdGlvbik6IElMaXN0ZW5lcltdIHtcbiAgICBjb25zdCBhcnJheUxpc3RlbmVycyA9IEFycmF5LmZyb20obGlzdGVuZXJzLnZhbHVlcygpKTtcblxuICAgIHJldHVybiBhcnJheUxpc3RlbmVycy5maWx0ZXIoXG4gICAgICBlbGVtZW50ID0+IGVsZW1lbnQudXJscy5zb21lKHZhbHVlID0+IG1hdGNoKHZhbHVlLCB1cmwpKVxuICAgICk7XG4gIH1cblxuICAvLyBXb3JrZmxvdyB0cmlnZ2VyZWQgd2hlbiBhIHdlYiByZXF1ZXN0IGFycml2ZVxuICAvLyBVc2UgdGhlIG9yaWdpbmFsIGxpc3RlbmVyIHNpZ25hdHVyZSBuZWVkZWQgYnkgZWxlY3Ryb24ud2VicmVxdWVzdC5vblhYWFgoKVxuICBwcml2YXRlIGxpc3RlbmVyRmFjdG9yeShtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QpIHtcbiAgICByZXR1cm4gYXN5bmMgKGRldGFpbHM6IGFueSwgY2FsbGJhY2s/OiBGdW5jdGlvbikgPT4ge1xuICAgICAgaWYgKCF0aGlzLmxpc3RlbmVycy5oYXMobWV0aG9kKSkge1xuICAgICAgICB0aGlzLndlYlJlcXVlc3RbbWV0aG9kXShudWxsKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsaXN0ZW5lcnMgPSB0aGlzLmxpc3RlbmVycy5nZXQobWV0aG9kKTtcblxuICAgICAgaWYgKCFsaXN0ZW5lcnMpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjayh7IC4uLmRldGFpbHMsIGNhbmNlbDogZmFsc2UgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWF0Y2hlZExpc3RlbmVycyA9IHRoaXMubWF0Y2hMaXN0ZW5lcnMoZGV0YWlscy51cmwsIGxpc3RlbmVycyk7XG5cbiAgICAgIGlmIChtYXRjaGVkTGlzdGVuZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrKHsgLi4uZGV0YWlscywgY2FuY2VsOiBmYWxzZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBsZXQgcmVzb2x2ZSA9IHRoaXMucmVzb2x2ZXJzLmdldChtZXRob2QpO1xuXG4gICAgICBpZiAoIXJlc29sdmUpIHtcbiAgICAgICAgcmVzb2x2ZSA9IGRlZmF1bHRSZXNvbHZlcjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVxdWVzdHNQcm9jZXNzZXMgPSB0aGlzLnByb2Nlc3NSZXF1ZXN0cyhkZXRhaWxzLCBtYXRjaGVkTGlzdGVuZXJzKTtcblxuICAgICAgaWYgKHRoaXMuaGFzQ2FsbGJhY2sobWV0aG9kKSAmJiBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBtb2RpZmllZCA9IGF3YWl0IHJlc29sdmUocmVxdWVzdHNQcm9jZXNzZXMpO1xuICAgICAgICBjYWxsYmFjayhtb2RpZmllZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXF1ZXN0c1Byb2Nlc3Nlcy5tYXAobGlzdGVuZXIgPT4gbGlzdGVuZXIuYXBwbHkoKSk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhbGwgdGhlIGV4ZWN1dGlvbnMgb2YgbGlzdGVuZXJzIG9uIHRoZSB3ZWIgcmVxdWVzdCAoaW5kZXBlbmRlbnRseSlcbiAgLy8gV3JhcCB0aGVtIHNvIHRoZXkgY2FuIGJlIHRyaWdnZXJlZCBvbmx5IHdoZW4gbmVlZGVkXG4gIHByaXZhdGUgcHJvY2Vzc1JlcXVlc3RzKGRldGFpbHM6IGFueSwgcmVxdWVzdExpc3RlbmVyczogSUxpc3RlbmVyW10pOiBJQXBwbGllcltdIHtcbiAgICBjb25zdCBhcHBsaWVyczogSUFwcGxpZXJbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiByZXF1ZXN0TGlzdGVuZXJzKSB7XG4gICAgICBjb25zdCBhcHBseSA9IHRoaXMubWFrZUFwcGxpZXIoZGV0YWlscywgbGlzdGVuZXIuYWN0aW9uKTtcblxuICAgICAgYXBwbGllcnMucHVzaCh7XG4gICAgICAgIGFwcGx5LFxuICAgICAgICBjb250ZXh0OiBsaXN0ZW5lci5jb250ZXh0LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFwcGxpZXJzO1xuICB9XG5cbiAgLy8gRmFjdG9yeSA6IG1ha2UgYSBmdW5jdGlvbiB0aGF0IHdpbGwgcmV0dXJuIGEgUHJvbWlzZSB3cmFwcGluZyB0aGUgZXhlY3V0aW9uIG9mIHRoZSBsaXN0ZW5lclxuICAvLyBBbGxvdyB0byB0cmlnZ2VyIHRoZSBhcHBsaWNhdGlvbiBvbmx5IHdoZW4gbmVlZGVkICsgcHJvbWlzaWZ5IHRoZSBleGVjdXRpb24gb2YgdGhpcyBsaXN0ZW5lclxuICBwcml2YXRlIG1ha2VBcHBsaWVyKGRldGFpbHM6IGFueSwgbGlzdGVuZXI6IEZ1bmN0aW9uKTogRnVuY3Rpb24ge1xuICAgIHJldHVybiAoKSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBsaXN0ZW5lcihkZXRhaWxzLCByZXNvbHZlKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgbWVyZ2VGaWx0ZXJzKGxpc3RlbmVyczogSUxpc3RlbmVyQ29sbGVjdGlvbikge1xuICAgIGNvbnN0IGFycmF5TGlzdGVuZXJzID0gQXJyYXkuZnJvbShsaXN0ZW5lcnMudmFsdWVzKCkpO1xuXG4gICAgcmV0dXJuIGFycmF5TGlzdGVuZXJzLnJlZHVjZShcbiAgICAgIChhY2N1bXVsYXRvciwgdmFsdWUpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCB1cmwgb2YgdmFsdWUudXJscykgYWNjdW11bGF0b3IuYWRkKHVybCk7XG4gICAgICAgIHJldHVybiBhY2N1bXVsYXRvcjtcbiAgICAgIH0sXG4gICAgICBuZXcgU2V0KClcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBwYXJzZUFyZ3VtZW50cyhwYXJhbWV0ZXJzOiBhbnkpOiBJQWxpYXNQYXJhbWV0ZXJzIHtcbiAgICBjb25zdCBhcmdzID0ge1xuICAgICAgdW5iaW5kOiBmYWxzZSxcbiAgICAgIGZpbHRlcjogeyB1cmxzOiBbJzxhbGxfdXJscz4nXSB9LFxuICAgICAgYWN0aW9uOiBudWxsLFxuICAgICAgY29udGV4dDoge30sXG4gICAgfTtcblxuICAgIHN3aXRjaCAocGFyYW1ldGVycy5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMDpcbiAgICAgICAgYXJncy51bmJpbmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAxOlxuICAgICAgICBpZiAodHlwZW9mIHBhcmFtZXRlcnNbMF0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBhcmdzLmFjdGlvbiA9IHBhcmFtZXRlcnNbMF07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1dyb25nIGZ1bmN0aW9uIHNpZ25hdHVyZSA6IE5vIGZ1bmN0aW9uIGxpc3RlbmVyIGdpdmVuJyk7XG5cbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaWYgKHR5cGVvZiBwYXJhbWV0ZXJzWzBdID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyYW1ldGVyc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGFyZ3MuZmlsdGVyID0gcGFyYW1ldGVyc1swXTtcbiAgICAgICAgICBhcmdzLmFjdGlvbiA9IHBhcmFtZXRlcnNbMV07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIHBhcmFtZXRlcnNbMF0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBhcmdzLmFjdGlvbiA9IHBhcmFtZXRlcnNbMF07XG4gICAgICAgICAgYXJncy5jb250ZXh0ID0gcGFyYW1ldGVyc1sxXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignV3JvbmcgZnVuY3Rpb24gc2lnbmF0dXJlIDogYXJndW1lbnQgMSBzaG91bGQgYmUgYW4gb2JqZWN0IGZpbHRlcnMgb3IgdGhlIGZ1bmN0aW9uIGxpc3RlbmVyJyk7XG5cbiAgICAgIGNhc2UgMzpcbiAgICAgICAgaWYgKHR5cGVvZiBwYXJhbWV0ZXJzWzBdID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyYW1ldGVyc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGFyZ3MuZmlsdGVyID0gcGFyYW1ldGVyc1swXTtcbiAgICAgICAgICBhcmdzLmFjdGlvbiA9IHBhcmFtZXRlcnNbMV07XG4gICAgICAgICAgYXJncy5jb250ZXh0ID0gcGFyYW1ldGVyc1syXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignV3JvbmcgZnVuY3Rpb24gc2lnbmF0dXJlIDogc2hvdWxkIGJlIGFyZyAxIC0+IGZpbHRlciBvYmplY3QsIGFyZyAyIC0+IGZ1bmN0aW9uIGxpc3RlbmVyLCBhcmcgMyAtPiBjb250ZXh0Jyk7XG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignV3JvbmcgZnVuY3Rpb24gc2lnbmF0dXJlIDogVG9vIG1hbnkgYXJndW1lbnRzJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGlkZW50aWZ5QWN0aW9uKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCwgYXJnczogSUFsaWFzUGFyYW1ldGVycykge1xuICAgIGNvbnN0IHsgdW5iaW5kLCBmaWx0ZXIsIGFjdGlvbiwgY29udGV4dCB9ID0gYXJncztcblxuICAgIGlmICh1bmJpbmQpIHtcbiAgICAgIHJldHVybiB0aGlzLmNsZWFyTGlzdGVuZXJzKG1ldGhvZCk7XG4gICAgfVxuXG4gICAgaWYgKCFhY3Rpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGJpbmQgd2l0aCAke21ldGhvZH0gOiBhIGxpc3RlbmVyIGlzIG1pc3NpbmcuYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWRkTGlzdGVuZXIobWV0aG9kLCBmaWx0ZXIsIGFjdGlvbiwgY29udGV4dCk7XG4gIH1cbn1cblxuLy8gUHJveHkgaGFuZGxlciB0aGF0IGFkZCBzdXBwb3J0IGZvciBhbGwgYWxpYXMgbWV0aG9kcyBieSByZWRpcmVjdGluZyB0byBCZXR0ZXJXZWJSZXF1ZXN0LmFsaWFzKClcbmNvbnN0IGFsaWFzSGFuZGxlciA9IHtcbiAgZ2V0OiAodGFyZ2V0OiBCZXR0ZXJXZWJSZXF1ZXN0LCBwcm9wZXJ0eTogYW55KSA9PiB7XG4gICAgaWYgKGFsaWFzTWV0aG9kcy5pbmNsdWRlcyhwcm9wZXJ0eSkpIHtcbiAgICAgIHJldHVybiAoLi4ucGFyYW1ldGVyczogYW55KSA9PiB7XG4gICAgICAgIHRhcmdldC5hbGlhcyhwcm9wZXJ0eSwgcGFyYW1ldGVycyk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB0YXJnZXRbcHJvcGVydHldO1xuICB9LFxufTtcblxuZXhwb3J0IGRlZmF1bHQgKHNlc3Npb246IFNlc3Npb24pID0+IHtcbiAgcmV0dXJuIG5ldyBQcm94eShcbiAgICBuZXcgQmV0dGVyV2ViUmVxdWVzdChzZXNzaW9uLndlYlJlcXVlc3QpLFxuICAgIGFsaWFzSGFuZGxlclxuICApO1xufTtcbiJdfQ==