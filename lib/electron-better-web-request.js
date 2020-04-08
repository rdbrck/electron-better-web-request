"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const url_match_patterns_1 = tslib_1.__importDefault(require("url-match-patterns"));
const v4_1 = tslib_1.__importDefault(require("uuid/v4"));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxlY3Ryb24tYmV0dGVyLXdlYi1yZXF1ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2VsZWN0cm9uLWJldHRlci13ZWItcmVxdWVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxvRkFBdUM7QUFDdkMseURBQTJCO0FBYzNCLE1BQU0sZUFBZSxHQUFHLENBQUMsU0FBcUIsRUFBRSxFQUFFO0lBQ2hELE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNFLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN2QixPQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUN0QixDQUFDLENBQUM7QUFFRixNQUFNLG1CQUFtQixHQUFHO0lBQzFCLGlCQUFpQjtJQUNqQixxQkFBcUI7SUFDckIsbUJBQW1CO0NBQ3BCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRztJQUNuQixpQkFBaUI7SUFDakIscUJBQXFCO0lBQ3JCLG1CQUFtQjtJQUNuQixlQUFlO0lBQ2YsbUJBQW1CO0lBQ25CLGtCQUFrQjtJQUNsQixhQUFhO0lBQ2IsaUJBQWlCO0NBQ2xCLENBQUM7QUFFRixNQUFhLGdCQUFnQjtJQVEzQixZQUFZLFVBQWU7UUFDekIsSUFBSSxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUM7UUFDcEIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFDN0IsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7SUFD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ZWN0cm9uJztcbmltcG9ydCBtYXRjaCBmcm9tICd1cmwtbWF0Y2gtcGF0dGVybnMnO1xuaW1wb3J0IHV1aWQgZnJvbSAndXVpZC92NCc7XG5cbmltcG9ydCB7XG4gIElCZXR0ZXJXZWJSZXF1ZXN0LFxuICBXZWJSZXF1ZXN0TWV0aG9kLFxuICBVUkxQYXR0ZXJuLFxuICBJRmlsdGVyLFxuICBJTGlzdGVuZXIsXG4gIElDb250ZXh0LFxuICBJQXBwbGllcixcbiAgSUxpc3RlbmVyQ29sbGVjdGlvbixcbiAgSUFsaWFzUGFyYW1ldGVycyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IGRlZmF1bHRSZXNvbHZlciA9IChsaXN0ZW5lcnM6IElBcHBsaWVyW10pID0+IHtcbiAgY29uc3Qgc29ydGVkID0gbGlzdGVuZXJzLnNvcnQoKGEsIGIpID0+IGIuY29udGV4dC5vcmRlciAtIGEuY29udGV4dC5vcmRlcik7XG4gIGNvbnN0IGxhc3QgPSBzb3J0ZWRbMF07XG4gIHJldHVybiBsYXN0LmFwcGx5KCk7XG59O1xuXG5jb25zdCBtZXRob2RzV2l0aENhbGxiYWNrID0gW1xuICAnb25CZWZvcmVSZXF1ZXN0JyxcbiAgJ29uQmVmb3JlU2VuZEhlYWRlcnMnLFxuICAnb25IZWFkZXJzUmVjZWl2ZWQnLFxuXTtcblxuY29uc3QgYWxpYXNNZXRob2RzID0gW1xuICAnb25CZWZvcmVSZXF1ZXN0JyxcbiAgJ29uQmVmb3JlU2VuZEhlYWRlcnMnLFxuICAnb25IZWFkZXJzUmVjZWl2ZWQnLFxuICAnb25TZW5kSGVhZGVycycsXG4gICdvblJlc3BvbnNlU3RhcnRlZCcsXG4gICdvbkJlZm9yZVJlZGlyZWN0JyxcbiAgJ29uQ29tcGxldGVkJyxcbiAgJ29uRXJyb3JPY2N1cnJlZCcsXG5dO1xuXG5leHBvcnQgY2xhc3MgQmV0dGVyV2ViUmVxdWVzdCBpbXBsZW1lbnRzIElCZXR0ZXJXZWJSZXF1ZXN0IHtcbiAgcHJpdmF0ZSB3ZWJSZXF1ZXN0OiBhbnk7XG5cbiAgcHJpdmF0ZSBvcmRlckluZGV4OiBudW1iZXI7XG4gIHByaXZhdGUgbGlzdGVuZXJzOiBNYXA8V2ViUmVxdWVzdE1ldGhvZCwgSUxpc3RlbmVyQ29sbGVjdGlvbj47XG4gIHByaXZhdGUgZmlsdGVyczogTWFwPFdlYlJlcXVlc3RNZXRob2QsIFNldDxVUkxQYXR0ZXJuPj47XG4gIHByaXZhdGUgcmVzb2x2ZXJzOiBNYXA8V2ViUmVxdWVzdE1ldGhvZCwgRnVuY3Rpb24+O1xuXG4gIGNvbnN0cnVjdG9yKHdlYlJlcXVlc3Q6IGFueSkge1xuICAgIHRoaXMub3JkZXJJbmRleCA9IDA7XG4gICAgdGhpcy53ZWJSZXF1ZXN0ID0gd2ViUmVxdWVzdDtcbiAgICB0aGlzLmxpc3RlbmVycyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmZpbHRlcnMgPSBuZXcgTWFwKCk7XG4gICAgdGhpcy5yZXNvbHZlcnMgPSBuZXcgTWFwKCk7XG4gIH1cblxuICBwcml2YXRlIGdldCBuZXh0SW5kZXgoKSB7XG4gICAgcmV0dXJuIHRoaXMub3JkZXJJbmRleCArPSAxO1xuICB9XG5cbiAgZ2V0TGlzdGVuZXJzKCkge1xuICAgIHJldHVybiB0aGlzLmxpc3RlbmVycztcbiAgfVxuXG4gIGdldExpc3RlbmVyc0ZvcihtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QpIHtcbiAgICByZXR1cm4gdGhpcy5saXN0ZW5lcnMuZ2V0KG1ldGhvZCk7XG4gIH1cblxuICBnZXRGaWx0ZXJzKCkge1xuICAgIHJldHVybiB0aGlzLmZpbHRlcnM7XG4gIH1cblxuICBnZXRGaWx0ZXJzRm9yKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCkge1xuICAgIHJldHVybiB0aGlzLmZpbHRlcnMuZ2V0KG1ldGhvZCk7XG4gIH1cblxuICBoYXNDYWxsYmFjayhtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QpOiBib29sZWFuIHtcbiAgICByZXR1cm4gbWV0aG9kc1dpdGhDYWxsYmFjay5pbmNsdWRlcyhtZXRob2QpO1xuICB9XG5cbiAgLy8gSGFuZGxpbmcgYWxpYXMgZm9yIGRyb3AgaW4gcmVwbGFjZW1lbnRcbiAgYWxpYXMobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kLCBwYXJhbWV0ZXJzOiBhbnkpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5wYXJzZUFyZ3VtZW50cyhwYXJhbWV0ZXJzKTtcbiAgICByZXR1cm4gdGhpcy5pZGVudGlmeUFjdGlvbihtZXRob2QsIGFyZ3MpO1xuICB9XG5cbiAgYWRkTGlzdGVuZXIobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kLCBmaWx0ZXI6IElGaWx0ZXIsIGFjdGlvbjogRnVuY3Rpb24sIG91dGVyQ29udGV4dDogUGFydGlhbDxJQ29udGV4dD4gPSB7fSkge1xuICAgIGNvbnN0IHsgdXJscyB9ID0gZmlsdGVyO1xuICAgIGNvbnN0IGlkID0gdXVpZCgpO1xuICAgIGNvbnN0IGlubmVyQ29udGV4dCA9IHsgb3JkZXI6IHRoaXMubmV4dEluZGV4IH07XG4gICAgY29uc3QgY29udGV4dCA9IHsgLi4ub3V0ZXJDb250ZXh0LCAuLi5pbm5lckNvbnRleHQgfTtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHtcbiAgICAgIGlkLFxuICAgICAgdXJscyxcbiAgICAgIGFjdGlvbixcbiAgICAgIGNvbnRleHQsXG4gICAgfTtcblxuICAgIC8vIEFkZCBsaXN0ZW5lciB0byBtZXRob2QgbWFwXG4gICAgaWYgKCF0aGlzLmxpc3RlbmVycy5oYXMobWV0aG9kKSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnMuc2V0KG1ldGhvZCwgbmV3IE1hcCgpKTtcbiAgICB9XG5cbiAgICB0aGlzLmxpc3RlbmVycy5nZXQobWV0aG9kKSEuc2V0KGlkLCBsaXN0ZW5lcik7XG5cbiAgICAvLyBBZGQgZmlsdGVycyB0byB0aGUgbWV0aG9kIG1hcFxuICAgIGlmICghdGhpcy5maWx0ZXJzLmhhcyhtZXRob2QpKSB7XG4gICAgICB0aGlzLmZpbHRlcnMuc2V0KG1ldGhvZCwgbmV3IFNldCgpKTtcbiAgICB9XG5cbiAgICBjb25zdCBjdXJyZW50RmlsdGVycyA9IHRoaXMuZmlsdGVycy5nZXQobWV0aG9kKSE7XG4gICAgZm9yIChjb25zdCB1cmwgb2YgdXJscykge1xuICAgICAgY3VycmVudEZpbHRlcnMuYWRkKHVybCk7XG4gICAgfVxuXG4gICAgLy8gUmVtYWtlIHRoZSBuZXcgaG9va1xuICAgIHRoaXMud2ViUmVxdWVzdFttZXRob2RdKHsgdXJsczogWy4uLmN1cnJlbnRGaWx0ZXJzXSB9LCB0aGlzLmxpc3RlbmVyRmFjdG9yeShtZXRob2QpKTtcblxuICAgIHJldHVybiBsaXN0ZW5lcjtcbiAgfVxuXG4gIHJlbW92ZUxpc3RlbmVyKG1ldGhvZDogV2ViUmVxdWVzdE1ldGhvZCwgaWQ6IElMaXN0ZW5lclsnaWQnXSkge1xuICAgIGNvbnN0IGxpc3RlbmVycyA9IHRoaXMubGlzdGVuZXJzLmdldChtZXRob2QpO1xuXG4gICAgaWYgKCFsaXN0ZW5lcnMgfHwgIWxpc3RlbmVycy5oYXMoaWQpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxpc3RlbmVycy5zaXplID09PSAxKSB7XG4gICAgICB0aGlzLmNsZWFyTGlzdGVuZXJzKG1ldGhvZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUoaWQpO1xuXG4gICAgICBjb25zdCBuZXdGaWx0ZXJzID0gdGhpcy5tZXJnZUZpbHRlcnMobGlzdGVuZXJzKTtcbiAgICAgIHRoaXMuZmlsdGVycy5zZXQobWV0aG9kLCBuZXdGaWx0ZXJzKTtcblxuICAgICAgLy8gUmViaW5kIHRoZSBuZXcgaG9va1xuICAgICAgdGhpcy53ZWJSZXF1ZXN0W21ldGhvZF0oWy4uLm5ld0ZpbHRlcnNdLCB0aGlzLmxpc3RlbmVyRmFjdG9yeShtZXRob2QpKTtcbiAgICB9XG4gIH1cblxuICBjbGVhckxpc3RlbmVycyhtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QpIHtcbiAgICBjb25zdCBsaXN0ZW5lcnMgPSB0aGlzLmxpc3RlbmVycy5nZXQobWV0aG9kKTtcbiAgICBjb25zdCBmaWx0ZXJzID0gdGhpcy5maWx0ZXJzLmdldChtZXRob2QpO1xuXG4gICAgaWYgKGxpc3RlbmVycykgbGlzdGVuZXJzLmNsZWFyKCk7XG4gICAgaWYgKGZpbHRlcnMpIGZpbHRlcnMuY2xlYXIoKTtcblxuICAgIHRoaXMud2ViUmVxdWVzdFttZXRob2RdKG51bGwpO1xuICB9XG5cbiAgc2V0UmVzb2x2ZXIobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kLCByZXNvbHZlcjogRnVuY3Rpb24pIHtcbiAgICBpZiAoIXRoaXMuaGFzQ2FsbGJhY2sobWV0aG9kKSkge1xuICAgICAgY29uc29sZS53YXJuKGBFdmVudCBtZXRob2QgXCIke21ldGhvZH1cIiBoYXMgbm8gY2FsbGJhY2sgYW5kIGRvZXMgbm90IHVzZSBhIHJlc29sdmVyYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVzb2x2ZXJzLmhhcyhtZXRob2QpKSB7XG4gICAgICBjb25zb2xlLndhcm4oYE92ZXJyaWRpbmcgcmVzb2x2ZXIgb24gXCIke21ldGhvZH1cIiBtZXRob2QgZXZlbnRgKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlc29sdmVycy5zZXQobWV0aG9kLCByZXNvbHZlcik7XG4gIH1cblxuICAvLyBGaW5kIGEgc3Vic2V0IG9mIGxpc3RlbmVycyB0aGF0IG1hdGNoIGEgZ2l2ZW4gdXJsXG4gIG1hdGNoTGlzdGVuZXJzKHVybDogc3RyaW5nLCBsaXN0ZW5lcnM6IElMaXN0ZW5lckNvbGxlY3Rpb24pOiBJTGlzdGVuZXJbXSB7XG4gICAgY29uc3QgYXJyYXlMaXN0ZW5lcnMgPSBBcnJheS5mcm9tKGxpc3RlbmVycy52YWx1ZXMoKSk7XG5cbiAgICByZXR1cm4gYXJyYXlMaXN0ZW5lcnMuZmlsdGVyKFxuICAgICAgZWxlbWVudCA9PiBlbGVtZW50LnVybHMuc29tZSh2YWx1ZSA9PiBtYXRjaCh2YWx1ZSwgdXJsKSlcbiAgICApO1xuICB9XG5cbiAgLy8gV29ya2Zsb3cgdHJpZ2dlcmVkIHdoZW4gYSB3ZWIgcmVxdWVzdCBhcnJpdmVcbiAgLy8gVXNlIHRoZSBvcmlnaW5hbCBsaXN0ZW5lciBzaWduYXR1cmUgbmVlZGVkIGJ5IGVsZWN0cm9uLndlYnJlcXVlc3Qub25YWFhYKClcbiAgcHJpdmF0ZSBsaXN0ZW5lckZhY3RvcnkobWV0aG9kOiBXZWJSZXF1ZXN0TWV0aG9kKSB7XG4gICAgcmV0dXJuIGFzeW5jIChkZXRhaWxzOiBhbnksIGNhbGxiYWNrPzogRnVuY3Rpb24pID0+IHtcbiAgICAgIGlmICghdGhpcy5saXN0ZW5lcnMuaGFzKG1ldGhvZCkpIHtcbiAgICAgICAgdGhpcy53ZWJSZXF1ZXN0W21ldGhvZF0obnVsbCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5saXN0ZW5lcnMuZ2V0KG1ldGhvZCk7XG5cbiAgICAgIGlmICghbGlzdGVuZXJzKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2soeyAuLi5kZXRhaWxzLCBjYW5jZWw6IGZhbHNlIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hdGNoZWRMaXN0ZW5lcnMgPSB0aGlzLm1hdGNoTGlzdGVuZXJzKGRldGFpbHMudXJsLCBsaXN0ZW5lcnMpO1xuXG4gICAgICBpZiAobWF0Y2hlZExpc3RlbmVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjayh7IC4uLmRldGFpbHMsIGNhbmNlbDogZmFsc2UgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgbGV0IHJlc29sdmUgPSB0aGlzLnJlc29sdmVycy5nZXQobWV0aG9kKTtcblxuICAgICAgaWYgKCFyZXNvbHZlKSB7XG4gICAgICAgIHJlc29sdmUgPSBkZWZhdWx0UmVzb2x2ZXI7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlcXVlc3RzUHJvY2Vzc2VzID0gdGhpcy5wcm9jZXNzUmVxdWVzdHMoZGV0YWlscywgbWF0Y2hlZExpc3RlbmVycyk7XG5cbiAgICAgIGlmICh0aGlzLmhhc0NhbGxiYWNrKG1ldGhvZCkgJiYgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgbW9kaWZpZWQgPSBhd2FpdCByZXNvbHZlKHJlcXVlc3RzUHJvY2Vzc2VzKTtcbiAgICAgICAgY2FsbGJhY2sobW9kaWZpZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVxdWVzdHNQcm9jZXNzZXMubWFwKGxpc3RlbmVyID0+IGxpc3RlbmVyLmFwcGx5KCkpO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBDcmVhdGUgYWxsIHRoZSBleGVjdXRpb25zIG9mIGxpc3RlbmVycyBvbiB0aGUgd2ViIHJlcXVlc3QgKGluZGVwZW5kZW50bHkpXG4gIC8vIFdyYXAgdGhlbSBzbyB0aGV5IGNhbiBiZSB0cmlnZ2VyZWQgb25seSB3aGVuIG5lZWRlZFxuICBwcml2YXRlIHByb2Nlc3NSZXF1ZXN0cyhkZXRhaWxzOiBhbnksIHJlcXVlc3RMaXN0ZW5lcnM6IElMaXN0ZW5lcltdKTogSUFwcGxpZXJbXSB7XG4gICAgY29uc3QgYXBwbGllcnM6IElBcHBsaWVyW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgcmVxdWVzdExpc3RlbmVycykge1xuICAgICAgY29uc3QgYXBwbHkgPSB0aGlzLm1ha2VBcHBsaWVyKGRldGFpbHMsIGxpc3RlbmVyLmFjdGlvbik7XG5cbiAgICAgIGFwcGxpZXJzLnB1c2goe1xuICAgICAgICBhcHBseSxcbiAgICAgICAgY29udGV4dDogbGlzdGVuZXIuY29udGV4dCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBhcHBsaWVycztcbiAgfVxuXG4gIC8vIEZhY3RvcnkgOiBtYWtlIGEgZnVuY3Rpb24gdGhhdCB3aWxsIHJldHVybiBhIFByb21pc2Ugd3JhcHBpbmcgdGhlIGV4ZWN1dGlvbiBvZiB0aGUgbGlzdGVuZXJcbiAgLy8gQWxsb3cgdG8gdHJpZ2dlciB0aGUgYXBwbGljYXRpb24gb25seSB3aGVuIG5lZWRlZCArIHByb21pc2lmeSB0aGUgZXhlY3V0aW9uIG9mIHRoaXMgbGlzdGVuZXJcbiAgcHJpdmF0ZSBtYWtlQXBwbGllcihkZXRhaWxzOiBhbnksIGxpc3RlbmVyOiBGdW5jdGlvbik6IEZ1bmN0aW9uIHtcbiAgICByZXR1cm4gKCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIoZGV0YWlscywgcmVzb2x2ZSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIG1lcmdlRmlsdGVycyhsaXN0ZW5lcnM6IElMaXN0ZW5lckNvbGxlY3Rpb24pIHtcbiAgICBjb25zdCBhcnJheUxpc3RlbmVycyA9IEFycmF5LmZyb20obGlzdGVuZXJzLnZhbHVlcygpKTtcblxuICAgIHJldHVybiBhcnJheUxpc3RlbmVycy5yZWR1Y2UoXG4gICAgICAoYWNjdW11bGF0b3IsIHZhbHVlKSA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgdXJsIG9mIHZhbHVlLnVybHMpIGFjY3VtdWxhdG9yLmFkZCh1cmwpO1xuICAgICAgICByZXR1cm4gYWNjdW11bGF0b3I7XG4gICAgICB9LFxuICAgICAgbmV3IFNldCgpXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcGFyc2VBcmd1bWVudHMocGFyYW1ldGVyczogYW55KTogSUFsaWFzUGFyYW1ldGVycyB7XG4gICAgY29uc3QgYXJncyA9IHtcbiAgICAgIHVuYmluZDogZmFsc2UsXG4gICAgICBmaWx0ZXI6IHsgdXJsczogWyc8YWxsX3VybHM+J10gfSxcbiAgICAgIGFjdGlvbjogbnVsbCxcbiAgICAgIGNvbnRleHQ6IHt9LFxuICAgIH07XG5cbiAgICBzd2l0Y2ggKHBhcmFtZXRlcnMubGVuZ3RoKSB7XG4gICAgICBjYXNlIDA6XG4gICAgICAgIGFyZ3MudW5iaW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaWYgKHR5cGVvZiBwYXJhbWV0ZXJzWzBdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgYXJncy5hY3Rpb24gPSBwYXJhbWV0ZXJzWzBdO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdXcm9uZyBmdW5jdGlvbiBzaWduYXR1cmUgOiBObyBmdW5jdGlvbiBsaXN0ZW5lciBnaXZlbicpO1xuXG4gICAgICBjYXNlIDI6XG4gICAgICAgIGlmICh0eXBlb2YgcGFyYW1ldGVyc1swXSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcmFtZXRlcnNbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBhcmdzLmZpbHRlciA9IHBhcmFtZXRlcnNbMF07XG4gICAgICAgICAgYXJncy5hY3Rpb24gPSBwYXJhbWV0ZXJzWzFdO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiBwYXJhbWV0ZXJzWzBdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgYXJncy5hY3Rpb24gPSBwYXJhbWV0ZXJzWzBdO1xuICAgICAgICAgIGFyZ3MuY29udGV4dCA9IHBhcmFtZXRlcnNbMV07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1dyb25nIGZ1bmN0aW9uIHNpZ25hdHVyZSA6IGFyZ3VtZW50IDEgc2hvdWxkIGJlIGFuIG9iamVjdCBmaWx0ZXJzIG9yIHRoZSBmdW5jdGlvbiBsaXN0ZW5lcicpO1xuXG4gICAgICBjYXNlIDM6XG4gICAgICAgIGlmICh0eXBlb2YgcGFyYW1ldGVyc1swXSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcmFtZXRlcnNbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBhcmdzLmZpbHRlciA9IHBhcmFtZXRlcnNbMF07XG4gICAgICAgICAgYXJncy5hY3Rpb24gPSBwYXJhbWV0ZXJzWzFdO1xuICAgICAgICAgIGFyZ3MuY29udGV4dCA9IHBhcmFtZXRlcnNbMl07XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1dyb25nIGZ1bmN0aW9uIHNpZ25hdHVyZSA6IHNob3VsZCBiZSBhcmcgMSAtPiBmaWx0ZXIgb2JqZWN0LCBhcmcgMiAtPiBmdW5jdGlvbiBsaXN0ZW5lciwgYXJnIDMgLT4gY29udGV4dCcpO1xuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1dyb25nIGZ1bmN0aW9uIHNpZ25hdHVyZSA6IFRvbyBtYW55IGFyZ3VtZW50cycpO1xuICAgIH1cblxuICAgIHJldHVybiBhcmdzO1xuICB9XG5cbiAgcHJpdmF0ZSBpZGVudGlmeUFjdGlvbihtZXRob2Q6IFdlYlJlcXVlc3RNZXRob2QsIGFyZ3M6IElBbGlhc1BhcmFtZXRlcnMpIHtcbiAgICBjb25zdCB7IHVuYmluZCwgZmlsdGVyLCBhY3Rpb24sIGNvbnRleHQgfSA9IGFyZ3M7XG5cbiAgICBpZiAodW5iaW5kKSB7XG4gICAgICByZXR1cm4gdGhpcy5jbGVhckxpc3RlbmVycyhtZXRob2QpO1xuICAgIH1cblxuICAgIGlmICghYWN0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBiaW5kIHdpdGggJHttZXRob2R9IDogYSBsaXN0ZW5lciBpcyBtaXNzaW5nLmApO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFkZExpc3RlbmVyKG1ldGhvZCwgZmlsdGVyLCBhY3Rpb24sIGNvbnRleHQpO1xuICB9XG59XG5cbi8vIFByb3h5IGhhbmRsZXIgdGhhdCBhZGQgc3VwcG9ydCBmb3IgYWxsIGFsaWFzIG1ldGhvZHMgYnkgcmVkaXJlY3RpbmcgdG8gQmV0dGVyV2ViUmVxdWVzdC5hbGlhcygpXG5jb25zdCBhbGlhc0hhbmRsZXIgPSB7XG4gIGdldDogKHRhcmdldDogQmV0dGVyV2ViUmVxdWVzdCwgcHJvcGVydHk6IGFueSkgPT4ge1xuICAgIGlmIChhbGlhc01ldGhvZHMuaW5jbHVkZXMocHJvcGVydHkpKSB7XG4gICAgICByZXR1cm4gKC4uLnBhcmFtZXRlcnM6IGFueSkgPT4ge1xuICAgICAgICB0YXJnZXQuYWxpYXMocHJvcGVydHksIHBhcmFtZXRlcnMpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFyZ2V0W3Byb3BlcnR5XTtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IChzZXNzaW9uOiBTZXNzaW9uKSA9PiB7XG4gIHJldHVybiBuZXcgUHJveHkoXG4gICAgbmV3IEJldHRlcldlYlJlcXVlc3Qoc2Vzc2lvbi53ZWJSZXF1ZXN0KSxcbiAgICBhbGlhc0hhbmRsZXJcbiAgKTtcbn07XG4iXX0=